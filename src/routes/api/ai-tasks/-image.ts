import { AIMediaType, pickImageProvider } from '@/core/ai';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

/**
 * Default per-image credit cost. Admins can override via
 * `image_credit_cost` in the `config` table; falls back to this.
 *
 * Mirrors the gpt-image-2 / SDXL / Flux range — tune in `config` once
 * provider economics settle.
 */
export const DEFAULT_IMAGE_CREDIT_COST = 5;

/**
 * Image generation branch of `POST /api/ai-tasks`.
 *
 * Flow (mirrors the video path's createTask → updateTask pattern so the
 * existing `updateTask()` auto-refund on FAILED just works):
 *   1. validate `prompt` (required, ≤2000 chars)
 *   2. resolve provider via `pickImageProvider(configs)` (evolink-image)
 *   3. `createTask()` — single-tx insert aiTask row + consume credits
 *      (throws 'Insufficient credits' on failure → mapped to 402)
 *   4. `provider.generate({...async: true})` → returns a remote taskId
 *   5. `updateTask({ status: PROCESSING, taskResult: {...} })`
 *   6. respond `{ taskId, status: 'processing' }` — client polls
 *      `/api/ai-tasks/$id` every 2s.
 *
 * Reference image (img2img): when the client provides `referenceUrl`,
 * we pass it through `options.image` — the evolink-image provider maps
 * it to the underlying model's `image` field. When absent, plain txt2img.
 */
export async function postImageTask({
  request: _request,
  session,
  body,
}: {
  request: Request;
  session: any;
  body: any;
}) {
  const prompt = String(body?.prompt ?? '').trim();
  if (!prompt) return respErr('prompt is required', { status: 400 });
  if (prompt.length > 2000) {
    return respErr('prompt is too long (max 2000 chars)', { status: 400 });
  }

  const referenceUrl =
    typeof body?.referenceUrl === 'string' && body.referenceUrl
      ? body.referenceUrl
      : undefined;
  const requestedModel =
    typeof body?.model === 'string' && body.model ? body.model : undefined;

  const configs = await getAllConfigs();
  const pick = await pickImageProvider(configs);
  if (!pick) {
    return respErr(
      'Image provider is not configured. Set evolink_api_key in admin settings.',
      { status: 400 }
    );
  }

  const model = requestedModel || pick.defaultModel;
  const costCredits =
    Number(configs.image_credit_cost) || DEFAULT_IMAGE_CREDIT_COST;

  // 1. Insert aiTask + consume credits (single transaction).
  let task;
  try {
    task = await createTask({
      userId: session.user.id,
      mediaType: AIMediaType.IMAGE,
      provider: pick.name, // 'evolink-image'
      model,
      prompt,
      options: referenceUrl ? { image: referenceUrl } : undefined,
      costCredits,
      paidOnly: false, // signup bonus may be spent on images
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('Insufficient paid credits')) {
      return respErr(
        'Image generation requires a paid plan — please purchase credits first.',
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

  // 2. Kick off the remote generation. async=true means the provider
  //    submits and returns a remote taskId; the image URL comes back
  //    later via /api/ai-tasks/$id which polls the provider.
  try {
    const result = await pick.provider.generate({
      params: {
        mediaType: AIMediaType.IMAGE,
        prompt,
        model,
        options: referenceUrl ? { image: referenceUrl } : undefined,
        async: true,
      },
    });

    await updateTask({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      taskResult: {
        remoteTaskId: result.taskId,
        provider: pick.name,
        referenceUrl,
        model,
      },
    });

    return respData({ taskId: task.id, status: AITaskStatus.PROCESSING });
  } catch (e: any) {
    return await fail(e?.message || 'Failed to start image generation', {
      status: 500,
    });
  }
}
