import { createFileRoute } from '@tanstack/react-router';

import { AIMediaType, EvolinkVideoProvider, getAIManager } from '@/core/ai';
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
  return {
    task: {
      id: task.id,
      status: task.status,
      model: task.model,
      provider: task.provider,
      prompt: task.prompt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      // taskResult already carries the image URLs / video URL; expose it
      // raw so the client can pick the keys it knows about.
      taskResult: cached,
      // Also lift the most common accessors to the top level for the
      // preview page, which historically read `taskResult.imageUrls`.
      imageUrls: cached?.imageUrls,
      imageUrl: cached?.imageUrls?.[0] || cached?.imageUrl,
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
        const imageUrls: string[] = (polled as any).urls || [];
        // Rehost successful images to R2 so the URLs don't expire on us.
        // Same pattern as video: best-effort, fall back to provider URL
        // if storage isn't configured or the upload fails.
        let finalUrls = imageUrls;
        const saveFiles = await buildRehostSaveFiles();
        if (saveFiles && imageUrls.length) {
          try {
            const saved = await saveFiles(
              imageUrls.map((url, i) => ({
                url,
                key: `evolink/image/${task.id}-${i}.png`,
                contentType: 'image/png',
                type: 'image',
              }))
            );
            finalUrls = saved
              .map((s, i) => s.url || imageUrls[i])
              .filter(Boolean);
          } catch (err: any) {
            console.warn(
              '[evolink-image] rehost failed, using provider URL:',
              err?.message
            );
          }
        }
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.SUCCESS,
          taskResult: {
            remoteTaskId,
            imageUrls: finalUrls,
            provider: task.provider,
          },
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
