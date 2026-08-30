import { createFileRoute } from '@tanstack/react-router';

import {
  AIMediaType,
  EvolinkVideoProvider,
  extractImageUrls,
  getAIManager,
} from '@/core/ai';
import { EvolinkImageProvider } from '@/core/ai/evolink-image';
import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask, updateTask } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import { buildRehostSaveFiles, parseTaskResult } from './-shared';

function videoFileUrls(taskId: string, result: Record<string, any>) {
  if (!result.videoUrl && !result.originalVideoUrl) return {};
  const base = `/api/ai-tasks/${encodeURIComponent(taskId)}/file`;
  return {
    videoUrl: base,
    downloadUrl: `${base}?download=1`,
  };
}

function imageFileUrls(taskId: string, result: Record<string, any>) {
  const rawUrls = extractImageUrls(result);
  const imageUrls = rawUrls
    .filter((url: unknown): url is string => typeof url === 'string' && !!url)
    .map((url: string, index: number) =>
      /^data:image\//i.test(url) || isPublicR2ImageUrl(url)
        ? url
        : `/api/ai-tasks/${encodeURIComponent(taskId)}/image?index=${index}`
    );
  // The primary URLs stay same-origin. Keep public HTTPS source URLs as an
  // owner-only fallback for the browser when an authenticated proxy request
  // transiently fails (for example while the DB connection is reconnecting).
  const imageFallbackUrls = rawUrls.map((url) =>
    /^https:\/\//i.test(url) ? url : ''
  );
  return { imageUrls, imageFallbackUrls, imageUrl: imageUrls[0] };
}

function isPublicR2ImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.r2.dev');
  } catch {
    return false;
  }
}

/**
 * Standard envelope for the polling endpoint. Every terminal/in-flight
 * response uses this shape so the client can read `task.taskResult.imageUrls`
 * uniformly (see api-playground.tsx taskQuery + image/$id.tsx preview).
 *
 * Sync submissions (gpt-image-2 etc.) are written to the DB as SUCCESS
 * by the submit handler and never poll again; async submissions flip to
 * SUCCESS here on the first poll that returns URLs.
 */
function taskEnvelope(task: any) {
  const cached = parseTaskResult(task.taskResult);
  const images = imageFileUrls(task.id, cached);
  return {
    task: {
      id: task.id,
      status: task.status,
      model: task.model,
      provider: task.provider,
      prompt: task.prompt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      // Expose image URLs through our authenticated proxy. Provider CDN hosts
      // are not assumed to be in CSP and can expire, while the original URLs
      // remain persisted privately in `taskResult` on the server.
      taskResult: {
        ...cached,
        imageUrls: images.imageUrls,
        imageFallbackUrls: images.imageFallbackUrls,
      },
      imageUrls: images.imageUrls,
      imageFallbackUrls: images.imageFallbackUrls,
      imageUrl: images.imageUrl,
      ...videoFileUrls(task.id, cached),
    },
  };
}

/**
 * GET /api/ai-tasks/:id — poll any AI generation task.
 *
 * Covers:
 *   - Playground image generation (Evolink, sync + async)
 *   - Web & Motion video replicate (Fal)
 *   - Seedance text-to-video via EvoLink
 *
 * Terminal tasks return their cached result. In-flight tasks query the
 * upstream provider once, persist the outcome (SUCCESS stores the result
 * URL — rehosted to R2 if storage is configured; FAILED auto-refunds the
 * credit via updateTask), and return the current status. The caller is
 * expected to poll again if they see `PROCESSING`.
 *
 * Dispatch on `task.provider`:
 *   - 'evolink-image' → EvolinkImageProvider.queryStatus()
 *   - 'evolink-video' → EvolinkVideoProvider.queryStatus() (Seedance)
 *   - everything else → generic AIProvider via Fal (video replicate)
 */
async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const task = await findTask(params.id);
    if (!task || task.userId !== session.user.id) {
      return respErr('Task not found', { status: 404 });
    }

    // Terminal → return cached result wrapped in the standard envelope.
    if (
      task.status === AITaskStatus.SUCCESS ||
      task.status === AITaskStatus.FAILED ||
      task.status === AITaskStatus.CANCELED
    ) {
      return respData(taskEnvelope(task));
    }

    const stored = parseTaskResult(task.taskResult);
    const remoteTaskId = stored?.remoteTaskId;
    if (!remoteTaskId) {
      return respData(taskEnvelope(task));
    }

    const configs = await getAllConfigs();

    // ── Evolink image gen: provider-specific queryStatus() ────────────
    if (task.provider === 'evolink-image') {
      if (!configs.evolink_api_key) {
        return respData(taskEnvelope(task));
      }
      const provider = new EvolinkImageProvider({
        apiKey: configs.evolink_api_key,
        baseUrl: configs.evolink_base_url,
      });
      const polled = await provider.queryStatus({
        taskId: remoteTaskId,
        model: task.model,
      });
      if (polled.status === 'success') {
        // The gateway can hand back its default batch even when the submit
        // asked for one — Nano Banana models don't accept an `n` parameter,
        // so the request cannot carry our intent. Enforce here the count the
        // task was billed for (`n` is persisted at submit; older tasks that
        // predate the field default to a single image). The sync submit path
        // applies the identical slice.
        const requestedCount = Number(stored?.n) > 0 ? Number(stored?.n) : 1;
        const imageUrls: string[] = ((polled as any).urls || []).slice(
          0,
          requestedCount
        );
        // Persist and return the provider URL immediately. Waiting for the
        // optional R2 copy here made a completed image sit on the spinner
        // for several extra seconds. The durable copy is upgraded below in
        // the background, exactly as the synchronous submit path does.
        const taskResult = {
          remoteTaskId,
          imageUrls,
          provider: task.provider,
        };
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.SUCCESS,
          taskResult,
        });

        void (async () => {
          const saveFiles = await buildRehostSaveFiles();
          if (!saveFiles || !imageUrls.length) return;
          try {
            const saved = await saveFiles(
              imageUrls.map((url, i) => ({
                url,
                key: `evolink/image/${task.id}-${i}.png`,
                contentType: 'image/png',
                type: 'image',
              }))
            );
            const finalUrls = saved
              .map((s, i) => s.url || imageUrls[i])
              .filter(Boolean);
            const imageStorageKeys = saved
              .map((s) => s.key)
              .filter((key): key is string => typeof key === 'string' && !!key);
            await updateTask({
              taskId: task.id,
              status: AITaskStatus.SUCCESS,
              taskResult: {
                ...taskResult,
                imageUrls: finalUrls,
                ...(imageStorageKeys.length ? { imageStorageKeys } : {}),
              },
            });
          } catch (err: any) {
            console.warn(
              '[evolink-image] background rehost failed, keeping provider URL:',
              err?.message
            );
          }
        })();

        return respData(
          taskEnvelope({
            ...task,
            status: AITaskStatus.SUCCESS,
            taskResult,
          })
        );
      }
      if (polled.status === 'failed') {
        // Persist the provider's terminal reason so My Images can show an
        // actionable failed state rather than an empty "generated" card.
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.FAILED,
          taskResult: {
            ...stored,
            error: { message: String(polled.message).slice(0, 800) },
          },
        });
        const refreshed = await findTask(task.id);
        return respData(taskEnvelope(refreshed || task));
      }
      return respData(taskEnvelope(task));
    }

    // ── Seedance 2.0 text-to-video via EvoLink ─────────────────────────
    if (task.provider === 'evolink-video') {
      if (!configs.evolink_api_key) {
        return respData(taskEnvelope(task));
      }

      const provider = new EvolinkVideoProvider({
        apiKey: configs.evolink_api_key,
        baseUrl: configs.evolink_base_url,
      });
      const polled = await provider.queryStatus(remoteTaskId);

      if (polled.status === 'success') {
        let videoUrl = polled.videoUrl;
        const storageKey = `evolink/video/${task.id}.mp4`;
        let videoStorageKey: string | undefined;
        const saveFiles = await buildRehostSaveFiles();
        if (saveFiles) {
          try {
            const saved = await saveFiles([
              {
                url: videoUrl,
                contentType: 'video/mp4',
                key: storageKey,
                type: 'video',
              },
            ]);
            const savedUrl = saved?.[0]?.url;
            if (savedUrl && savedUrl !== polled.videoUrl) {
              videoUrl = savedUrl;
              videoStorageKey = storageKey;
            }
          } catch (error: any) {
            // Keep the 24-hour EvoLink URL as a last-resort fallback. The
            // task is already complete and should not be refunded because a
            // secondary storage upload failed.
            console.warn(
              '[evolink-video] failed to rehost output:',
              error?.message
            );
          }
        }

        const taskResult = {
          ...stored,
          remoteTaskId,
          videoUrl,
          originalVideoUrl: polled.videoUrl,
          videoStorageKey,
        };
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.SUCCESS,
          taskResult,
        });
        const refreshed = await findTask(task.id);
        return respData(taskEnvelope(refreshed || task));
      }

      if (polled.status === 'failed') {
        await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
        const refreshed = await findTask(task.id);
        return respData(taskEnvelope(refreshed || task));
      }

      return respData(taskEnvelope(task));
    }

    // ── Everything else: route through the Fal manager (existing flow) ─
    if (!configs.fal_api_key) return respData(taskEnvelope(task));

    const saveFiles = await buildRehostSaveFiles();
    const manager = getAIManager(configs, { saveFiles });
    const fal = manager?.getProvider('fal');
    if (!fal) return respData(taskEnvelope(task));

    const result = await fal.query({
      taskId: remoteTaskId,
      mediaType: (task.mediaType as any) || AIMediaType.VIDEO,
      model: task.model,
    });

    if (result.taskStatus === AITaskStatus.SUCCESS) {
      if (task.mediaType === AIMediaType.IMAGE) {
        const imageUrls: string[] =
          result.taskInfo?.images?.map((i: any) => i.imageUrl || i.image_url) ||
          [];
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.SUCCESS,
          taskResult: { remoteTaskId, imageUrls },
        });
        const refreshed = await findTask(task.id);
        return respData(taskEnvelope(refreshed || task));
      }
      const videoUrl = result.taskInfo?.videos?.[0]?.videoUrl;
      const taskResult = {
        remoteTaskId,
        inputVideoUrl: stored?.inputVideoUrl,
        videoUrl,
      };
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.SUCCESS,
        taskResult,
      });
      const refreshed = await findTask(task.id);
      return respData(taskEnvelope(refreshed || task));
    }

    if (result.taskStatus === AITaskStatus.FAILED) {
      await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
      const refreshed = await findTask(task.id);
      return respData(taskEnvelope(refreshed || task));
    }

    return respData(taskEnvelope(task));
  } catch (error: any) {
    // Don't let a transient upstream error kill the polling loop —
    // surface it but keep the task in flight so the next poll can retry.
    return respErr(error.message || 'Failed to poll task');
  }
}

export const Route = createFileRoute('/api/ai-tasks/$id')({
  server: {
    handlers: { GET },
  },
});
