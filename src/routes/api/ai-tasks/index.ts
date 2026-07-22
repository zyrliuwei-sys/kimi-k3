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
        });
      } catch (e: any) {
        if (String(e?.message || '').includes('Insufficient credits')) {
          return respErr('Insufficient credits', { status: 402 });
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
