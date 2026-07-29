import {
  AIMediaType,
  EvolinkImageProvider,
  listEvolinkImageModels,
  pickImageProvider,
} from '@/core/ai';
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
  // `n` is the image count (1-4). Clamp to [1, 4] so a hostile client
  // can't drive up the credit cost with `n: 999`.
  const nRaw = Number(body?.n);
  const n = Number.isFinite(nRaw)
    ? Math.min(4, Math.max(1, Math.floor(nRaw)))
    : 1;
  // `size` is the aspect ratio encoded as "WIDTHxHEIGHT" (e.g. "16x9").
  // Empty / missing = let the provider pick its default. Otherwise
  // validate against a small allowlist so a client can't send an
  // arbitrary size string to the provider.
  const sizeRaw = typeof body?.size === 'string' ? body.size.trim() : '';
  const ALLOWED_SIZES = new Set([
    '1024x1024',
    '1536x1024', // 3:2
    '1024x1536', // 2:3
    '1792x1024', // 16:9 landscape
    '1024x1792', // 9:16 portrait
    '1280x960', // 4:3
    '960x1280', // 3:4
    '2048x1024', // 2:1
    '1024x2048', // 1:2
    '1280x576', // 20:9
    '576x1280', // 9:20
  ]);
  const size = ALLOWED_SIZES.has(sizeRaw) ? sizeRaw : '';

  const configs = await getAllConfigs();
  const pick = await pickImageProvider(configs);
  if (!pick) {
    return respErr(
      'Image provider is not configured. Set evolink_api_key in admin settings.',
      { status: 400 }
    );
  }

  // Allowlist a client-supplied model against what this key actually
  // serves. Without this, any caller could bill an arbitrary model id
  // (including an expensive non-image one) through this endpoint. The
  // listing is cached for an hour, so this costs nothing per request.
  //
  // Single-model rollout: only `gpt-image-2` is exposed right now, so
  // the submit endpoint enforces the same single-model wall the menu
  // shows. A client that hand-crafts any other model id gets silently
  // rerouted to the default.
  const ONLY_MODEL = 'gpt-image-2';
  const allowlist = [ONLY_MODEL];
  let model = pick.defaultModel;
  if (requestedModel && requestedModel !== pick.defaultModel) {
    const allowed = await listEvolinkImageModels(
      new EvolinkImageProvider({
        apiKey: configs.evolink_api_key,
        baseUrl: configs.evolink_base_url,
      }),
      `${configs.evolink_api_key}|${configs.evolink_base_url || ''}`,
      allowlist
    );
    // Empty list = the gateway listing failed. Fall back to the default
    // rather than trusting the client or hard-failing the request.
    if (allowed.includes(requestedModel)) model = requestedModel;
  }
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

  // 2. Kick off the remote generation. The EvolinkImageProvider only
  //    implements `submit()` — the generic `AIProvider.generate()` shape
  //    in `pickImageProvider`'s return type is just an interface contract
  //    that doesn't match this concrete provider, so we call submit()
  //    directly. The image URL comes back later via /api/ai-tasks/$id
  //    which polls queryStatus().
  try {
    // pick.provider is cast to AIProvider; the underlying instance is
    // an EvolinkImageProvider which exposes `submit` (not `generate`).
    // Call submit directly so we don't trip the
    // "pick.provider.generate is not a function" runtime error.
    const evolinkInstance = pick.provider as unknown as EvolinkImageProvider;
    const result = await evolinkInstance.submit({
      prompt,
      model,
      n,
      size: size || undefined,
      // reference images aren't part of the OpenAI-style
      // images/generations endpoint, so img2img is intentionally not
      // wired through this path — clients use the /image-to-image
      // endpoints for that.
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
    // Map provider-side failures to the right HTTP status so the user
    // sees an actionable message instead of a generic 500. Without
    // this, an out-of-credit account surfaces as "Internal Server Error"
    // — confusing because the app credits are fine, the upstream key
    // is the one that's exhausted.
    const raw = String(e?.message || e?.statusText || '');
    const upstream = e?.status ?? e?.response?.status;
    if (
      upstream === 402 ||
      /insufficient[_ ]?quota|insufficient[_ ]?credits|out of credits|quota exceeded/i.test(
        raw
      )
    ) {
      return await fail(
        'Upstream image provider is out of credits. The admin needs to top up the provider account before users can generate images.',
        { status: 402 }
      );
    }
    if (upstream === 429 || /rate[_ ]?limit|too many requests/i.test(raw)) {
      return await fail('Upstream rate limit hit — please retry in a moment.', {
        status: 429,
      });
    }
    if (
      upstream === 400 ||
      /invalid[_ ]?request|invalid[_ ]?model|model[_ ]?not[_ ]?found|model[_ ]?does[_ ]?exist/i.test(
        raw
      )
    ) {
      return await fail(
        `Upstream rejected the model id (${model}). Check the configured default and allowlist.`,
        { status: 400 }
      );
    }
    return await fail(e?.message || 'Failed to start image generation', {
      status: 500,
    });
  }
}
