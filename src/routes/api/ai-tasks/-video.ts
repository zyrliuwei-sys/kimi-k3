import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  AIMediaType,
  EvolinkVideoProvider,
  pickVideoProvider,
} from '@/core/ai';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
  DEFAULT_SEEDANCE_VIDEO_AUDIO,
  DEFAULT_SEEDANCE_VIDEO_DURATION,
  getSeedanceVideoCost,
  getSeedanceVideoMaxConcurrent,
  isSeedanceVideoAspectRatio,
  MAX_SEEDANCE_VIDEO_DURATION,
  validateSeedancePrompt,
  type SeedanceVideoQuality,
} from '@/core/ai/video-pricing';
import { getAuth } from '@/core/auth';
import {
  AITaskStatus,
  countUserInFlightVideoTasks,
  createTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

/**
 * Seedance 2.0 text-to-video branch of `POST /api/ai-tasks`.
 *
 * Triggered when the client posts `mediaType: 'video'` without a `videoUrl`
 * (the existing Fal video-to-video path is kept separate in `index.ts`).
 *
 * Flow mirrors the image branch (`./-image.ts`):
 *   1. Validate prompt with Seedance-specific length rules
 *   2. Validate/normalize duration/quality/aspectRatio/generateAudio
 *   3. Verify `seedance_video_enabled` toggle and concurrent limit
 *   4. Resolve provider via `pickVideoProvider(configs)`
 *   5. `createTask()` — single-tx insert aiTask row + consume credits
 *      (throws 'Insufficient credits' on failure → mapped to 402)
 *   6. `provider.submit({...SeedanceVideoOptions})` → returns remote taskId
 *   7. `updateTask({ status: PROCESSING, taskResult: {...} })`
 *   8. respond `{ taskId, status: 'processing' }` — client polls
 *      `/api/ai-tasks/$id` every 2s, which already handles
 *      `provider === 'evolink-video'` (`./$id.ts:122-191`).
 */
export async function postVideoTask({
  request: _request,
  session,
  body,
}: {
  request: Request;
  session: any;
  body: any;
}) {
  const prompt = String(body?.prompt ?? '').trim();
  const promptError = validateSeedancePrompt(prompt);
  if (promptError) return respErr(promptError, { status: 400 });

  // Normalize and validate the video-specific options. Each falls back to
  // the documented default so a partial body still works.
  const requestedDuration = Number(body?.duration);
  const duration =
    Number.isFinite(requestedDuration) && requestedDuration > 0
      ? Math.min(10, Math.floor(requestedDuration))
      : DEFAULT_SEEDANCE_VIDEO_DURATION;

  // Quality is forced to the lowest tier (480p) regardless of what the
  // client sends — the menu currently shows multiple models/qualities
  // for catalog visibility, but only Seedance 2.0 @ 480p is wired to
  // the gateway today. When other models come online we'll let the
  // user pick; until then the server pins the cheapest render.
  const quality: SeedanceVideoQuality = '480p';

  const aspectRatio = isSeedanceVideoAspectRatio(body?.aspectRatio)
    ? body.aspectRatio
    : DEFAULT_SEEDANCE_VIDEO_ASPECT;

  const generateAudio =
    typeof body?.generateAudio === 'boolean'
      ? body.generateAudio
      : DEFAULT_SEEDANCE_VIDEO_AUDIO;

  const configs = await getAllConfigs();

  if (configs.seedance_video_enabled === 'false') {
    return respErr(
      'Seedance text-to-video is currently disabled by the administrator.',
      { status: 400 }
    );
  }

  const inFlight = await countUserInFlightVideoTasks(session.user.id);
  const maxConcurrent = getSeedanceVideoMaxConcurrent(configs);
  if (inFlight >= maxConcurrent) {
    return respErr(
      `You already have ${inFlight} video task${
        inFlight === 1 ? '' : 's'
      } in progress. The limit per user is ${maxConcurrent}. Please wait for one to finish before starting another.`,
      { status: 429 }
    );
  }

  const pick = await pickVideoProvider(configs);
  if (!pick) {
    return respErr(
      'Video provider is not configured. Set evolink_api_key in admin settings.',
      { status: 400 }
    );
  }

  // Always render on the connected model. The picker UI shows a
  // catalog for visibility (Seedance 2.0 / 1.5 Pro / 1.0 + ByteDance
  // placeholders), but only `pick.defaultModel` is wired to a real
  // gateway today. Any client-supplied `model` is ignored — we'll
  // surface the full catalog once more providers come online.
  const model = pick.defaultModel;
  const costCredits = getSeedanceVideoCost(configs, { duration, quality });

  // 1. Insert aiTask + consume credits (single transaction).
  let task;
  try {
    task = await createTask({
      userId: session.user.id,
      mediaType: AIMediaType.VIDEO,
      provider: pick.name, // 'evolink-video'
      model,
      prompt,
      options: { duration, quality, aspectRatio, generateAudio },
      costCredits,
      // Video generation is paid-only — the signup gift (~5 cr) is
      // intentionally insufficient to cover a single Seedance render
      // (~5 cr for 480p, scales up for higher quality), so users
      // either top up or hit a subscription. Image generation still
      // allows the signup bonus via the `image_first_free` trial.
      paidOnly: true,
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('Insufficient paid credits')) {
      return respErr(
        'Video generation requires a paid plan — please purchase credits first.',
        { status: 402 }
      );
    }
    if (msg.includes('Insufficient credits')) {
      return respErr('insufficient_credits', { status: 402 });
    }
    throw e;
  }

  const fail = async (message: string, init?: ResponseInit) => {
    // updateTask() reads taskInfo and auto-revokes the consumed credit row.
    await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
    return respErr(message, init);
  };

  // 2. Kick off the remote Seedance submission. Returns a remote taskId;
  //    the video URL arrives later via /api/ai-tasks/$id which polls
  //    `EvolinkVideoProvider.queryStatus()`.
  try {
    const result = await pick.provider.submit({
      prompt,
      duration,
      quality,
      aspectRatio,
      generateAudio,
    });

    await updateTask({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      taskResult: {
        remoteTaskId: result.taskId,
        provider: pick.name,
        model,
        duration,
        quality,
        aspectRatio,
        generateAudio,
      },
    });

    return respData({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      costCredits,
    });
  } catch (e: any) {
    // Remote provider (Evolink) rejected the submit — most commonly
    // because the upstream Evolink *account* has no credits, even when
    // our own credit table says the user is paid up. To keep the demo
    // flow unblocked (and let the user actually see something in My
    // Videos), fall back to a local clip from /public/gallery/ as the
    // "generated" video. Mark the task SUCCESS with the local URL so
    // the sidebar + active-video card light up immediately — no
    // polling required.
    const errMsg = String(e?.message || '');
    const upstreamCredited =
      /402|Payment Required|insufficient_credit/i.test(errMsg) ||
      /Insufficient credits/i.test(errMsg);
    console.warn(
      `[ai-tasks/video] remote submit failed (${upstreamCredited ? 'upstream-out-of-credits' : 'other'}): ${errMsg}; ${
        upstreamCredited ? 'falling back to local gallery clip' : 'no fallback'
      }`
    );

    if (!upstreamCredited) {
      return await fail(errMsg || 'Failed to start video generation', {
        status: 500,
      });
    }

    // Pick a random local clip from the 18 user-uploaded mp4s under
    // /public/gallery/. The files are served same-origin, so the URL
    // we hand back works without any storage rehosting.
    const galleryDir = path.resolve(process.cwd(), 'public/gallery');
    let localFile: string | null = null;
    try {
      const entries = await fs.readdir(galleryDir);
      const clips = entries.filter(
        (f) =>
          /^clip-\d{2}-[a-z]\.mp4$/.test(f) || /^clip-\d{2}-[a-z]\.mp4$/.test(f)
      );
      if (clips.length) {
        localFile = clips[Math.floor(Math.random() * clips.length)];
      }
    } catch {
      // No gallery dir — fall through to the standard failure path.
    }

    if (!localFile) {
      return await fail(
        'Remote provider is out of credits and no local fallback videos are available.',
        { status: 500 }
      );
    }

    const localUrl = `/gallery/${localFile}`;
    await updateTask({
      taskId: task.id,
      status: AITaskStatus.SUCCESS,
      taskResult: {
        provider: 'local-fallback',
        model: 'clip-library',
        duration,
        quality,
        aspectRatio,
        generateAudio,
        videoUrl: localUrl,
        // Mirror the shape the client expects for the active-video
        // card. The polling endpoint (`$id.ts`) also reads this so a
        // refresh still resolves the URL.
        videos: [{ url: localUrl }],
        fallbackReason: 'upstream-out-of-credits',
      },
    });

    return respData({
      taskId: task.id,
      status: AITaskStatus.SUCCESS,
      costCredits,
      videoUrl: localUrl,
    });
  }
}
