import {
  AIMediaType,
  EvolinkImageProvider,
  listEvolinkImageModels,
  pickImageProvider,
} from '@/core/ai';
import { normalizeRatioToSize } from '@/core/ai/aspect-ratios';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { respData, respErr } from '@/lib/resp';

import { buildRehostSaveFiles } from './-shared';

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
 * Flow:
 *   1. validate `prompt` (required, ≤2000 chars)
 *   2. resolve provider via `pickImageProvider(configs)` (evolink-image)
 *   3. `createTask()` — single-tx insert aiTask row + consume credits
 *      (throws 'Insufficient credits' on failure → mapped to 402)
 *   4. `provider.submit({...})` — returns either:
 *        a. `{ mode: 'sync', imageUrls }`  → the gateway answered the
 *           final image inline. We rehost, mark the task SUCCESS in the
 *           same request, and return SUCCESS to the caller (no polling).
 *        b. `{ mode: 'async', taskId }`   → the gateway handed back a
 *           polling id. We mark the task PROCESSING and return; the
 *           caller polls `/api/ai-tasks/$id` every 2s.
 *
 * Reference image (img2img): img2img is intentionally not wired — the
 * OpenAI-style `/images/generations` endpoint doesn't accept reference
 * inputs. The UI still lets users attach up to 10 reference images with
 * inline notes, but the server only consumes the first one's URL.
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
  // Client now sends the raw aspect ratio token (`"16:9"`, `"3:4"`, …).
  // Some upstream models want the ratio as-is (Nano Banana 2 / gemini),
  // others want pixel dimensions (`"1792x1024"`). We defer the
  // conversion to the model-aware submit call below — keep the raw
  // ratio here so we can decide later.
  const rawSize =
    typeof body?.size === 'string' && body.size ? body.size : undefined;

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
  // Exposed in the composer menu are: gpt-image-2 (OpenAI flagship on
  // Evolink) and gemini-3.1-flash-image-preview (Nano Banana 2). Both
  // are reached through the same /v1/images/generations endpoint but
  // have different request shapes — handled in evolink-image.submit().
  const ALLOWED_MODELS = ['gpt-image-2', 'gemini-3.1-flash-image-preview'];
  const allowlist = ALLOWED_MODELS;
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
  const lowerModel = model.toLowerCase();
  const isNanoBanana =
    lowerModel.includes('gemini') || lowerModel.includes('nano-banana');
  // Nano Banana 2 wants the ratio string as-is (`"16:9"`); other
  // models (gpt-image-2) want pixel dimensions (`"1792x1024"`).
  const size = isNanoBanana
    ? rawSize
    : rawSize
      ? normalizeRatioToSize(rawSize)
      : undefined;
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

  // 2. Kick off the remote generation. submit() returns either sync
  //    (imageUrls inline) or async (remote taskId to poll). Both paths
  //    land here; sync short-circuits to SUCCESS, async hands off to
  //    the polling endpoint.
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
      size,
      // Nano Banana 2 supports `image_urls` (array) for img2img +
      // editing; older models take a single `image` string. The
      // provider picks the right shape per model — see evolink-image
      // submit() body construction.
      referenceUrls: referenceUrl ? [referenceUrl] : undefined,
    });

    // ── Sync path ────────────────────────────────────────────────────
    // The gateway handed us the final image URLs inline (HTTP 200 +
    // { data: [...] }). Mark the task SUCCESS and respond immediately
    // with the provider URLs so the user sees the image right away
    // (sub-second response — no waiting on the 3-5s R2 upload).
    //
    // The R2 rehost still happens, but in the BACKGROUND after the
    // response is sent. Once it completes we patch the task row with
    // the permanent URLs and bust the cache, so any later refresh
    // sees the durable link instead of the (24h-TTL) provider URL.
    if (result.mode === 'sync') {
      const providerUrls = result.imageUrls;
      const taskResult = {
        remoteTaskId: result.taskId,
        imageUrls: providerUrls,
        provider: pick.name,
      };
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.SUCCESS,
        taskResult,
      });

      // Fire-and-forget R2 rehost. The user already has the image in
      // their browser; this just upgrades the URL behind the scenes.
      const saveFiles = await buildRehostSaveFiles();
      if (saveFiles && providerUrls.length) {
        void (async () => {
          try {
            const saved = await saveFiles(
              providerUrls.map((url, i) => ({
                url,
                key: `evolink/image/${task.id}-${i}.png`,
                contentType: 'image/png',
                type: 'image',
              }))
            );
            const finalUrls = saved
              .map((s, i) => s.url || providerUrls[i])
              .filter(Boolean);
            await updateTask({
              taskId: task.id,
              status: AITaskStatus.SUCCESS,
              taskResult: {
                ...taskResult,
                imageUrls: finalUrls,
              },
            });
          } catch (err: any) {
            console.warn(
              '[evolink-image] background rehost failed:',
              err?.message
            );
          }
        })();
      }

      return respData({
        taskId: task.id,
        status: AITaskStatus.SUCCESS,
        imageUrls: providerUrls,
        imageUrl: providerUrls[0],
        // Pass the task row we already have (model, prompt, etc.) so
        // the client can render the active image without a follow-up
        // GET — saves a DB round-trip on every sync generation.
        task: {
          ...task,
          taskResult,
        },
      });
    }

    // ── Async path ───────────────────────────────────────────────────
    // The gateway returned a polling id (HTTP 202 + { id }). Mark the
    // task PROCESSING; the client will poll /api/ai-tasks/$id and
    // /api/ai-tasks/$id will hit Evolink's queryStatus() until success.
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
