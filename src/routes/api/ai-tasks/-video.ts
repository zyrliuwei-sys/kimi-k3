import {
  AIMediaType,
  EvolinkVideoProvider,
  pickVideoProvider,
} from '@/core/ai';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
  DEFAULT_SEEDANCE_VIDEO_AUDIO,
  DEFAULT_SEEDANCE_VIDEO_DURATION,
  DEFAULT_SEEDANCE_VIDEO_QUALITY,
  getSeedanceVideoCost,
  getSeedanceVideoMaxConcurrent,
  isSeedanceVideoAspectRatio,
  isSeedanceVideoQuality,
  validateSeedancePrompt,
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

  const quality = isSeedanceVideoQuality(body?.quality)
    ? body.quality
    : DEFAULT_SEEDANCE_VIDEO_QUALITY;

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

  // Reject client-supplied model ids that aren't on the admin allowlist
  // (same wall the menu enforces). The default is always allowed.
  const allowedModels = (configs.evolink_video_models_allowlist || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  const requestedModel =
    typeof body?.model === 'string' && body.model ? body.model : undefined;
  const model =
    !requestedModel || requestedModel === pick.defaultModel
      ? pick.defaultModel
      : allowedModels.length === 0
        ? // Legacy behaviour: any model the provider accepts.
          requestedModel
        : allowedModels.includes(requestedModel)
          ? requestedModel
          : // Not on the allowlist — silently fall back to the default
            // rather than 400-ing a client that's just slightly behind on
            // the menu. We log so admins can spot bad ids in config.
            (console.warn(
              `[ai-tasks/video] model "${requestedModel}" not in allowlist, falling back to ${pick.defaultModel}`
            ),
            pick.defaultModel);
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
      paidOnly: false, // signup bonus may be spent on videos
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
    return await fail(e?.message || 'Failed to start video generation', {
      status: 500,
    });
  }
}
