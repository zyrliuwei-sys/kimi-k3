import { createFileRoute } from '@tanstack/react-router';

import { AIMediaType, getAIManager } from '@/core/ai';
import { getAuth } from '@/core/auth';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import {
  allowedVideoHosts,
  buildRehostSaveFiles,
  DEFAULT_CREDIT_COST,
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  isAllowedVideoUrl,
} from './-shared';

/**
 * POST /api/ai-tasks — start a Web & Motion video replicate job.
 *
 * Flow: auth → SSRF-guard the source videoUrl → createTask (deduct credits)
 * → fal.generate → store the remote task id. On any failure after the credit
 * was taken, the task is marked FAILED so updateTask() auto-refunds it.
 */
async function POST({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const body = await request.json().catch(() => ({}));
    const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl : '';
    if (!videoUrl) return respErr('videoUrl is required', { status: 400 });

    const configs = await getAllConfigs();
    if (!configs.fal_api_key) {
      return respErr('AI provider (Fal) is not configured', { status: 400 });
    }

    if (!isAllowedVideoUrl(videoUrl, allowedVideoHosts(configs))) {
      return respErr('Video URL is not from an allowed origin', {
        status: 400,
      });
    }

    const model = configs.video_replicate_model || DEFAULT_MODEL;
    const costCredits =
      Number(configs.video_replicate_credit_cost) || DEFAULT_CREDIT_COST;

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
      });
    } catch (e: any) {
      if (String(e?.message || '').includes('Insufficient credits')) {
        return respErr('Insufficient credits', { status: 402 });
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
  } catch (error: any) {
    return respErr(error.message || 'Failed to create AI task');
  }
}

export const Route = createFileRoute('/api/ai-tasks/')({
  server: {
    handlers: { POST },
  },
});
