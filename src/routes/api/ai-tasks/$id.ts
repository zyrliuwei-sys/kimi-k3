import { createFileRoute } from '@tanstack/react-router';

import { AIMediaType, getAIManager } from '@/core/ai';
import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask, updateTask } from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import { buildRehostSaveFiles, parseTaskResult } from './-shared';

/**
 * GET /api/ai-tasks/:id — poll a Web & Motion video replicate job.
 *
 * Terminal tasks return their cached result. In-flight tasks query Fal once,
 * persist the outcome (SUCCESS stores the rehosted video URL; FAILED auto-
 * refunds the credit via updateTask), and return the current status.
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
        videoUrl: cached?.videoUrl,
      });
    }

    const stored = parseTaskResult(task.taskResult);
    const remoteTaskId = stored?.remoteTaskId;
    if (!remoteTaskId) {
      return respData({ status: task.status });
    }

    const configs = await getAllConfigs();
    if (!configs.fal_api_key) return respData({ status: task.status });

    const saveFiles = await buildRehostSaveFiles();
    const manager = getAIManager(configs, { saveFiles });
    const fal = manager?.getProvider('fal');
    if (!fal) return respData({ status: task.status });

    const result = await fal.query({
      taskId: remoteTaskId,
      mediaType: AIMediaType.VIDEO,
      model: task.model,
    });

    if (result.taskStatus === AITaskStatus.SUCCESS) {
      const videoUrl = result.taskInfo?.videos?.[0]?.videoUrl;
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.SUCCESS,
        taskResult: {
          remoteTaskId,
          inputVideoUrl: stored?.inputVideoUrl,
          videoUrl,
        },
      });
      return respData({ status: AITaskStatus.SUCCESS, videoUrl });
    }

    if (result.taskStatus === AITaskStatus.FAILED) {
      await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
      return respData({ status: AITaskStatus.FAILED });
    }

    return respData({ status: AITaskStatus.PROCESSING });
  } catch (error: any) {
    // Don't let a transient Fal error kill the polling loop — surface it but
    // keep the task in flight so the next poll can retry.
    return respErr(error.message || 'Failed to poll task');
  }
}

export const Route = createFileRoute('/api/ai-tasks/$id')({
  server: {
    handlers: { GET },
  },
});
