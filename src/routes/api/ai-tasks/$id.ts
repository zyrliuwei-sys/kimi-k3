import { createFileRoute } from '@tanstack/react-router';

import {
  AIMediaType,
  EvolinkVideoProvider,
  getAIManager,
  pickImageProvider,
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

/**
 * GET /api/ai-tasks/:id — poll any AI generation task.
 *
 * Covers both:
 *   - Web & Motion video replicate (Fal)
 *   - Playground image generation (Evolink / Fal / Gemini / Kie)
 *
 * Terminal tasks return their cached result. In-flight tasks query the
 * upstream provider once, persist the outcome (SUCCESS stores the result
 * URL; FAILED auto-refunds the credit via updateTask), and return the
 * current status. The caller is expected to poll again if they see
 * `PROCESSING`.
 *
 * Dispatch on `task.provider`:
 *   - 'evolink-image' → EvolinkImageProvider.queryStatus() (provider-specific)
 *   - everything else → generic AIProvider via Fal (existing video path)
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

    // Terminal → return cached result.
    if (
      task.status === AITaskStatus.SUCCESS ||
      task.status === AITaskStatus.FAILED ||
      task.status === AITaskStatus.CANCELED
    ) {
      const cached = parseTaskResult(task.taskResult);
      return respData({
        status: task.status,
        ...videoFileUrls(task.id, cached),
        imageUrls: cached?.imageUrls,
        // Back-compat: some callers still expect the singular key.
        imageUrl: cached?.imageUrls?.[0] || cached?.imageUrl,
      });
    }

    const stored = parseTaskResult(task.taskResult);
    const remoteTaskId = stored?.remoteTaskId;
    if (!remoteTaskId) {
      return respData({ status: task.status });
    }

    const configs = await getAllConfigs();

    // ── Evolink image gen: provider-specific queryStatus() ────────────
    if (task.provider === 'evolink-image') {
      if (!configs.evolink_api_key) {
        return respData({ status: task.status });
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
        await updateTask({
          taskId: task.id,
          status: AITaskStatus.SUCCESS,
          taskResult: {
            remoteTaskId,
            imageUrls,
            provider: task.provider,
          },
        });
        return respData({
          status: AITaskStatus.SUCCESS,
          imageUrls,
          imageUrl: imageUrls[0],
        });
      }
      if (polled.status === 'failed') {
        await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
        return respData({ status: AITaskStatus.FAILED });
      }
      return respData({ status: AITaskStatus.PROCESSING });
    }

    // ── Seedance 2.0 text-to-video via EvoLink ─────────────────────────
    if (task.provider === 'evolink-video') {
      if (!configs.evolink_api_key) {
        return respData({ status: task.status });
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
        return respData({
          status: AITaskStatus.SUCCESS,
          ...videoFileUrls(task.id, taskResult),
        });
      }

      if (polled.status === 'failed') {
        await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
        return respData({ status: AITaskStatus.FAILED });
      }

      return respData({
        status: AITaskStatus.PROCESSING,
        progress: polled.progress,
      });
    }

    // ── Everything else: route through the Fal manager (existing flow) ─
    if (!configs.fal_api_key) return respData({ status: task.status });

    const saveFiles = await buildRehostSaveFiles();
    const manager = getAIManager(configs, { saveFiles });
    const fal = manager?.getProvider('fal');
    if (!fal) return respData({ status: task.status });

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
        return respData({
          status: AITaskStatus.SUCCESS,
          imageUrls,
          imageUrl: imageUrls[0],
        });
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
      return respData({
        status: AITaskStatus.SUCCESS,
        ...videoFileUrls(task.id, taskResult),
      });
    }

    if (result.taskStatus === AITaskStatus.FAILED) {
      await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
      return respData({ status: AITaskStatus.FAILED });
    }

    return respData({ status: AITaskStatus.PROCESSING });
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
