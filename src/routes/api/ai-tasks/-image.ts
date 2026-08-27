import {
  AIMediaType,
  EvolinkImageProvider,
  getGptLowPrice,
  IMAGE_MODELS,
  IMAGE_PRICING,
  IMAGE_RESOLUTIONS,
  pickImageProvider,
} from '@/core/ai';
import { ASPECT_RATIOS } from '@/core/ai/aspect-ratios';
import {
  AITaskStatus,
  countUserActiveTasks,
  createTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';
import { isFreeTrialShape, readImageFirstFree } from '@/lib/image-billing';
import { respData, respErr } from '@/lib/resp';

import { buildRehostSaveFiles } from './-shared';

/**
 * Product pricing is intentionally resolved on the server. The client can
 * select a resolution tier, but it cannot submit arbitrary upstream values.
 *
 * GPT Image 2 uses the economical Low route. Its server-side estimate is
 * based on resolution and aspect ratio, then multiplied by the product
 * markup and rounded up. Nano Banana 2 keeps its resolution tiers.
 */
type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
type ImageModelChoice = (typeof IMAGE_MODELS)[number];

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
 * Reference images (img2img): up to ten image URLs may be sent in one
 * request. The provider decides how many it can use for the selected model.
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
  const referenceUrls = Array.isArray(body?.referenceUrls)
    ? body.referenceUrls
        .filter(
          (url: unknown): url is string =>
            typeof url === 'string' && url.length > 0
        )
        .slice(0, 10)
    : referenceUrl
      ? [referenceUrl]
      : [];
  // Every request produces exactly one image. The server owns this value so
  // callers cannot turn a paid request into an unpriced batch.
  const n = 1;
  const requestedModel = String(body?.model ?? 'gpt-image-2');
  if (!IMAGE_MODELS.includes(requestedModel as ImageModelChoice)) {
    return respErr('Unsupported image model.', {
      status: 400,
    });
  }
  const model = requestedModel as ImageModelChoice;
  const requestedResolution = String(body?.resolution ?? '1K');
  if (!IMAGE_RESOLUTIONS.includes(requestedResolution as ImageResolution)) {
    return respErr('Unsupported image resolution.', { status: 400 });
  }
  const selectedResolution = requestedResolution as ImageResolution;
  let resolution = selectedResolution;
  const qualityFor = (value: ImageResolution) =>
    model === 'nano-banana-2' ? value : 'low';

  // Both selected upstream routes accept aspect-ratio strings. Falling back
  // to 1:1 instead of an upstream "auto" default makes the fixed model
  // presets deterministic even for callers outside the composer.
  const rawSize =
    typeof body?.size === 'string' && body.size ? body.size : '1:1';
  if (!ASPECT_RATIOS.some((ratio) => ratio.value === rawSize)) {
    return respErr(
      'Unsupported aspect ratio. Choose a ratio from the image generator menu.',
      { status: 400 }
    );
  }

  const selectedResolutionCost =
    model === 'gpt-image-2'
      ? getGptLowPrice(selectedResolution, rawSize)
      : IMAGE_PRICING[model][selectedResolution];

  const configs = await getAllConfigs();
  const pick = await pickImageProvider(configs);
  if (!pick) {
    return respErr(
      'Image provider is not configured. Set evolink_api_key in admin settings.',
      { status: 400 }
    );
  }

  const standardCost = selectedResolutionCost;

  // First-image-free trial (`image_first_free`, default on). The signup
  // bonus is 5 credits and one image costs ~10, so without this a brand-new
  // account would hit the paywall on its very first click. Free only for the
  // cheap shape (no reference; see `isFreeTrialShape`) and only until the
  // the user's first non-failed image task exists. The free trial produces
  // one image at 1K, even when the client selected 2K or 4K. Every later
  // request remains a paid, single-image generation.
  //
  // Race note: two concurrent submits can both read zero prior tasks and
  // both go free. The window is one request round-trip and the blast radius
  // is a single extra image (~$0.03), so this isn't worth a lock.
  let costCredits = standardCost;
  let pricingReason: 'first_free' | 'standard' = 'standard';
  const isFirstFreeTrial =
    readImageFirstFree(configs) &&
    isFreeTrialShape({
      n,
      size: rawSize,
      hasReference: !!referenceUrl,
    }) &&
    (await countUserActiveTasks(session.user.id, AIMediaType.IMAGE)) === 0;
  if (isFirstFreeTrial) {
    costCredits = 0;
    pricingReason = 'first_free';
    resolution = '1K';
  }
  const quality = qualityFor(resolution);

  // 1. Insert aiTask + consume credits (single transaction).
  let task;
  try {
    task = await createTask({
      userId: session.user.id,
      mediaType: AIMediaType.IMAGE,
      provider: pick.name, // 'evolink-image'
      model,
      prompt,
      options: {
        model,
        n,
        resolution,
        aspectRatio: rawSize,
        pricing: {
          version: 'image-model-resolution-v2-low-observed',
          credits: costCredits,
        },
        ...(referenceUrl ? { image: referenceUrl } : {}),
      },
      costCredits,
      // The signup bonus is separate from the two-generation image trial. Subsequent
      // generations must use paid credits, which causes the client to open
      // the checkout/pricing dialog when none are available.
      paidOnly: pricingReason !== 'first_free',
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('Insufficient paid credits')) {
      return respErr('payment_required', { status: 402 });
    }
    if (msg.includes('Insufficient credits')) {
      return respErr('payment_required', { status: 402 });
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
      // The model renders a compatible 3:2 / 2:3 source canvas first. Tell
      // it about the user's eventual frame so key content stays safe when
      // the client renders that exact crop.
      prompt: rawSize
        ? `${prompt}\n\nFinal frame: ${rawSize}. Keep the important subject and details inside the central safe area for this composition.`
        : prompt,
      model,
      n,
      size: rawSize,
      resolution,
      quality,
      // Nano Banana 2 supports `image_urls` (array) for img2img +
      // editing; older models take a single `image` string. The
      // provider picks the right shape per model — see evolink-image
      // submit() body construction.
      referenceUrls: referenceUrls.length ? referenceUrls : undefined,
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
      // Enforce the requested output count even if a gateway response
      // contains extra URLs despite `n=1`.
      const providerUrls = result.imageUrls.slice(0, n);
      const taskResult = {
        remoteTaskId: result.taskId,
        imageUrls: providerUrls,
        provider: pick.name,
        model,
        n,
        resolution,
      };
      await updateTask({
        taskId: task.id,
        status: AITaskStatus.SUCCESS,
        taskResult,
      });

      // Fire-and-forget R2 rehost. The user already has the image in
      // their browser; this just upgrades the URL behind the scenes.
      if (providerUrls.length) {
        void (async () => {
          try {
            const saveFiles = await buildRehostSaveFiles();
            if (!saveFiles) return;
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
        // What this generation actually cost, and why. `first_free` means
        // the trial was spent on this call — the client can use it to tell
        // the user the next one is paid. Mirrors -video.ts / website-audit.
        costCredits,
        standardCost,
        reason: pricingReason,
        model,
        n,
        resolution,
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
        n,
        resolution,
        // Persist the gateway estimate alongside the remote id so the
        // polling endpoint can re-surface it on every poll and the UI
        // shows a real "Generating… ~12s" countdown instead of just
        // spinning. Optional — undefined for models that don't supply
        // an estimate.
        ...(result.mode === 'async' && result.estimatedSeconds
          ? { estimatedSeconds: result.estimatedSeconds }
          : {}),
      },
    });

    return respData({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      costCredits,
      standardCost,
      reason: pricingReason,
      model,
      n,
      resolution,
      // Surface the estimate to the client immediately so the UI can
      // show a real countdown from the very first frame after submit.
      ...(result.mode === 'async' && result.estimatedSeconds
        ? { estimatedSeconds: result.estimatedSeconds }
        : {}),
    });
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
      const detail = raw
        .replace(/^Evolink submit failed:\s*/i, '')
        .slice(0, 240);
      return await fail(
        detail
          ? `EvoLink rejected the image request: ${detail}`
          : `EvoLink rejected the selected model (${model}). Check model access.`,
        { status: 400 }
      );
    }
    return await fail(e?.message || 'Failed to start image generation', {
      status: 500,
    });
  }
}
