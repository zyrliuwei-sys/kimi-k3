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
      tasks: tasks.map((t: any) => {
        const media = parseTaskMedia(t);
        return {
          id: t.id,
          mediaType: t.mediaType,
          prompt: t.prompt,
          status: t.status,
          model: t.model,
          provider: t.provider,
          createdAt: t.createdAt,
          // imageUrls carries every URL the task produced (N=1..4) so
          // the My Images view can render each submission as one row
          // with all of its images side-by-side, instead of dropping
          // every image past the first one.
          imageUrls: media.imageUrls,
          // videoUrls mirrors imageUrls for Seedance tasks. Each tile
          // in My Videos reads from this array — without it the grid
          // would always render the loading spinner because the list
          // endpoint stripped `taskResult` and never exposed the URL.
          videoUrls: media.videoUrls,
          // First-frame JPEG at /uploads/video-posters/<id>.jpg. The
          // video tile renders this as <img>, mirroring how the image
          // gallery renders each row — no <video> autoplay policy
          // risk in <button>-wrapped containers. Click → active-video
          // panel plays the real <video src=videoUrls[0]>.
          posterUrl: media.posterUrl,
          // Per-task option blob (duration / quality / aspect for video;
          // seed / reference for image). Surfaced so My Videos can label
          // each tile with the duration it was generated at without
          // forcing the client to re-parse `taskResult`.
          options: parseOptions(t.options),
          // Keep `thumbnailUrl` for the sidebar — that surface only
          // needs the first frame.
          thumbnailUrl: media.thumbnailUrl,
        };
      }),
    });
  } catch (error: any) {
    return respErr(error.message || 'Failed to list AI tasks');
  }
}

/**
 * Rewrite a raw video URL to the authenticated proxy on our own origin so
 * the browser doesn't try to load it cross-origin (and trip `media-src`).
 *
 * The proxy (`/api/ai-tasks/:id/file`) is the same endpoint the detail
 * endpoint surfaces via `videoFileUrls()` — it pulls bytes from R2 when
 * rehosted and falls back to fetching `files.evolink.ai` server-side,
 * always streaming them back from this origin with `Range` support.
 *
 * Same-origin URLs (e.g. the local `/gallery/*.mp4` fallback or anything
 * else written as a path) are returned verbatim — no need to round-trip
 * through a proxy that just adds latency.
 */
function proxyVideoUrl(taskId: string, url: string): string {
  if (typeof url !== 'string') return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return `/api/ai-tasks/${encodeURIComponent(taskId)}/file`;
}

/**
 * Extract every media URL a task produced plus the first one as the
 * thumbnail fallback.
 *
 *   `imageUrls[]`  → all frames returned by the image provider (N=1..4).
 *                    Surfaced to the My Images view so a single batch
 *                    with multiple generations renders as one row.
 *   `videoUrls[]`  → all videos returned by the video provider. Seedance
 *                    normally produces 1 URL (stored as `videoUrl`) but
 *                    multi-clip batches surface an array under `videos`.
 *                    Surfaced to the My Videos view the same way as
 *                    `imageUrls` so each row renders side-by-side tiles.
 *                    External URLs (e.g. `files.evolink.ai/...mp4`) are
 *                    rewritten through our `/api/ai-tasks/:id/file`
 *                    proxy so playback stays same-origin; same-origin
 *                    paths (the local `/gallery/*.mp4` fallback) pass
 *                    through unchanged.
 *   `posterUrl`    → first-frame JPEG at `/uploads/video-posters/<id>.jpg`,
 *                    written when the video finished so the tile
 *                    preview is a plain `<img>` (no autoplay policy
 *                    pain, mirrors the image gallery 1:1).
 *   `thumbnailUrl` → the legacy single-frame field. The sidebar uses
 *                    it as a small chip preview; unchanged in shape.
 *                    Prefers `posterUrl` over `videoUrls[0]` for video
 *                    tasks so the sidebar chip stays a real image.
 */
function parseTaskMedia(t: any): {
  imageUrls: string[];
  videoUrls: string[];
  thumbnailUrl?: string;
  posterUrl?: string;
} {
  try {
    const raw = t.taskResult;
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r) return { imageUrls: [], videoUrls: [] };

    const imageUrls: string[] = collectUrls(r, [['imageUrls'], ['images']]);
    if (!imageUrls.length && typeof r.imageUrl === 'string' && r.imageUrl) {
      imageUrls.push(r.imageUrl);
    } else if (!imageUrls.length && typeof r.url === 'string' && r.url) {
      // Some providers fold the lone image URL into a generic `url` key.
      // Surface it as an image URL so My Images doesn't drop the row.
      imageUrls.push(r.url);
    }

    const rawVideoUrls: string[] = collectUrls(r, [['videos'], ['video_urls']]);
    if (!rawVideoUrls.length && typeof r.videoUrl === 'string' && r.videoUrl) {
      rawVideoUrls.push(r.videoUrl);
    }
    const videoUrls = rawVideoUrls.map((u) => proxyVideoUrl(t.id, u));

    const posterUrl =
      typeof r.posterUrl === 'string' && r.posterUrl ? r.posterUrl : undefined;
    const thumbnailUrl = imageUrls[0] || posterUrl || videoUrls[0];
    return { imageUrls, videoUrls, thumbnailUrl, posterUrl };
  } catch {
    return { imageUrls: [], videoUrls: [] };
  }
}

/**
 * Walk a list of candidate object paths on `r`, collecting every
 * URL-shaped entry into a flat array. Used by `parseTaskMedia` so the
 * image / video branches share one normalized traversal.
 */
function collectUrls(r: any, paths: string[][]): string[] {
  for (const path of paths) {
    let candidate: any = r;
    for (const segment of path) candidate = candidate?.[segment];
    if (Array.isArray(candidate)) {
      return candidate
        .map((item: any) =>
          typeof item === 'string' ? item : item?.url || item?.videoUrl
        )
        .filter((u: any): u is string => typeof u === 'string' && !!u);
    }
  }
  return [];
}

/**
 * Parse the persisted `options` column into a JSON object. Falls back
 * to `null` for legacy rows where the column was never written.
 */
function parseOptions(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw as Record<string, any>;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
