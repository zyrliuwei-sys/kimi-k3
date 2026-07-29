import { createFileRoute } from '@tanstack/react-router';

import { AIMediaType, getAIManager } from '@/core/ai';
import { getAuth } from '@/core/auth';
import {
  AITaskStatus,
  createTask,
  getTasks,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import { postImageTask } from './-image';
import {
  allowedVideoHosts,
  buildRehostSaveFiles,
  DEFAULT_CREDIT_COST,
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  isAllowedVideoUrl,
} from './-shared';
import { postVideoTask } from './-video';

/**
 * `POST /api/ai-tasks` — start an AI generation task.
 *
 * Dispatches by `mediaType`:
 *   - `'video'` → fal Web & Motion replicate (existing pipeline)
 *   - `'image'` → evolink-image (txt2img + img2img)
 *
 * Both branches use `createTask()` from `src/modules/ai-tasks/service` so the
 * row + credit deduction happen in a single transaction; `updateTask()`
 * auto-refunds on FAILED.
 *
 * `GET /api/ai-tasks?mediaType=<type>&limit=<n>` lists the current user's
 * tasks for the playground sidebar session list.
 */
async function POST({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const body = await request.json().catch(() => ({}));
    const mediaType =
      typeof body?.mediaType === 'string' ? body.mediaType.toLowerCase() : '';

    if (mediaType === AIMediaType.IMAGE) {
      return postImageTask({ request, session, body });
    }
    if (mediaType === AIMediaType.VIDEO) {
      // Seedance text-to-video (no source videoUrl) → new handler in ./ -video
      if (!body?.videoUrl) return postVideoTask({ request, session, body });
      // Fal Web & Motion video-to-video (existing pipeline) → inline below
      return postFalVideoTask({ request, session, body });
    }
    return respErr('Unsupported mediaType', { status: 400 });
  } catch (error: any) {
    return respErr(error.message || 'Failed to create AI task');
  }
}

/**
 * `GET /api/ai-tasks?mediaType=image&limit=50` — sidebar session list.
 *
 * Auth required (sidebar is only populated when signed in).
 * `thumbnailUrl` is parsed from the persisted `taskResult` JSON so the
 * sidebar can render a chip without re-querying each task.
 */
async function GET({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const url = new URL(request.url);
    const mediaType = url.searchParams.get('mediaType') || undefined;
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Math.min(
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50,
      100
    );

    const tasks = await getTasks({
      userId: session.user.id,
      mediaType,
      page: 1,
      limit,
    });

    return respData({
      tasks: tasks.map((t: any) => ({
        id: t.id,
        mediaType: t.mediaType,
        prompt: t.prompt,
        status: t.status,
        model: t.model,
        provider: t.provider,
        createdAt: t.createdAt,
        thumbnailUrl: parseThumbnail(t),
      })),
    });
  } catch (error: any) {
    return respErr(error.message || 'Failed to list AI tasks');
  }
}

function parseThumbnail(t: any): string | undefined {
  try {
    const raw = t.taskResult;
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r) return undefined;
    if (Array.isArray(r.imageUrls) && r.imageUrls[0]) return r.imageUrls[0];
    if (Array.isArray(r.images) && r.images[0]) {
      const first = r.images[0];
      return typeof first === 'string' ? first : first?.url;
    }
    if (typeof r.imageUrl === 'string') return r.imageUrl;
    if (typeof r.url === 'string') return r.url;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Video pipeline (Web & Motion via Fal) — lifted verbatim from the original
 * file. Behavior unchanged.
 */
async function postFalVideoTask({
  request: _request,
  session,
  body,
}: {
  request: Request;
  session: any;
  body: any;
}) {
  const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl : '';
  if (!videoUrl) return respErr('videoUrl is required', { status: 400 });

  const configs = await getAllConfigs();

  const model = configs.video_replicate_model || DEFAULT_MODEL;
  const costCredits =
    Number(configs.video_replicate_credit_cost) || DEFAULT_CREDIT_COST;

  // Fal needs an API key AND a source URL from an allowed host (it fetches
  // the video server-side, so the origin is SSRF-guarded). Without either we
  // can't run the AI pipeline, so fall back to an exact-replica passthrough
  // ("原样复刻"): serve the uploaded video back as-is for one-click download.
  // When Fal is configured, the real video → video pipeline runs below.
  const falReady =
    !!configs.fal_api_key &&
    isAllowedVideoUrl(videoUrl, allowedVideoHosts(configs));

  if (!falReady) {
    let replica;
    try {
      replica = await createTask({
        userId: session.user.id,
        mediaType: AIMediaType.VIDEO,
        provider: 'replica',
        model: 'passthrough',
        prompt: DEFAULT_PROMPT,
        costCredits,
        // Video is premium — only paid credits may be used.
        paidOnly: true,
      });
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (
        msg.includes('Insufficient paid credits') ||
        msg.includes('Insufficient credits')
      ) {
        return respErr(
          'Video generation requires a paid plan or top-up — please purchase credits first.',
          { status: 402 }
        );
      }
      throw e;
    }
    await updateTask({
      taskId: replica.id,
      status: AITaskStatus.SUCCESS,
      taskResult: {
        videoUrl,
        inputVideoUrl: videoUrl,
        mode: 'passthrough',
      },
    });
    return respData({
      taskId: replica.id,
      status: AITaskStatus.SUCCESS,
      videoUrl,
    });
  }

  // 1. Record the task + deduct credits (throws 'Insufficient credits').
  let task;
  try {
    task = await createTask({
      userId: session.user.id,
      mediaType: AIMediaType.VIDEO,
      provider: 'fal',
      model,
      prompt: DEFAULT_PROMPT,
      costCredits,
      // Video is premium — only paid credits may be used.
      paidOnly: true,
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (
      msg.includes('Insufficient paid credits') ||
      msg.includes('Insufficient credits')
    ) {
      return respErr(
        'Video generation requires a paid plan or top-up — please purchase credits first.',
        { status: 402 }
      );
    }
    throw e;
  }

  const fail = async (message: string, init?: ResponseInit) => {
    await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
    return respErr(message, init);
  };

  // 2. Kick off Fal generation (outputs rehosted to R2 when storage is up).
  const saveFiles = await buildRehostSaveFiles();
  const manager = getAIManager(configs, { saveFiles });
  const fal = manager?.getProvider('fal');
  if (!fal) {
    return await fail('AI provider (Fal) is not configured', { status: 400 });
  }

  try {
    const result = await fal.generate({
      params: {
        mediaType: AIMediaType.VIDEO,
        model,
        prompt: DEFAULT_PROMPT,
        options: { video_input: [videoUrl] },
      },
    });

    await updateTask({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      taskResult: {
        remoteTaskId: result.taskId,
        inputVideoUrl: videoUrl,
      },
    });

    return respData({ taskId: task.id, status: AITaskStatus.PROCESSING });
  } catch (e: any) {
    return await fail(e?.message || 'Failed to start video generation');
  }
}

export const Route = createFileRoute('/api/ai-tasks/')({
  server: {
    handlers: { POST, GET },
  },
});
