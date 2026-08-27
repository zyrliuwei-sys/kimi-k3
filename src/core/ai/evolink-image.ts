/**
 * Evolink image-generation provider.
 *
 * Evolink (https://evolink.ai) is an OpenAI-compatible gateway. The same
 * `POST {baseUrl}/images/generations` endpoint can return either:
 *
 *   - **Sync** (HTTP 200) — fast models (e.g. gpt-image-2) return the
 *     final image URLs inline: `{ created, data: [{ url, b64_json }] }`.
 *     No polling needed — the caller has the image in one round-trip.
 *   - **Async** (HTTP 202) — slow / large models return a task id
 *     (`{ id, status: "processing", task_info: { estimated_time } }`)
 *     and the caller must poll `GET /v1/images/generations/{id}` (or
 *     another candidate path — see CANDIDATE_POLL_PATHS below) for the
 *     final URLs.
 *
 * We support both. The submit result is tagged with `mode` so the caller
 * knows whether to poll or just render the result.
 */

import { extractImageUrls } from './image-urls';

/**
 * Pull a completion-time estimate (seconds) out of an Evolink async submit
 * response. The gateway has reshuffled this field across past versions —
 * `task_info.estimated_time` is the canonical home but we've also seen it
 * on the root as `estimated_time` / `eta_seconds`. Returns undefined when
 * nothing matches so the UI can fall back to its heuristic countdown.
 */
function extractEstimatedSeconds(data: any): number | undefined {
  const candidates = [
    data?.task_info?.estimated_time,
    data?.estimated_time,
    data?.eta_seconds,
    data?.task_info?.eta_seconds,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0 && n < 600) return n;
  }
  return undefined;
}

export interface EvolinkImageConfigs {
  apiKey: string;
  baseUrl?: string; // default https://api.evolink.ai/v1
  model?: string; // default set by caller (admin `evolink_image_model`)
}

export interface EvolinkImageResult {
  urls: string[];
  model: string;
}

const DEFAULT_BASE = 'https://api.evolink.ai/v1';
// Cap upstream calls so a slow / hung gateway can't tie up a request
// indefinitely. 30s is generous for image gen; sync gpt-image-2 lands in
// 5-15s, async poll requests are usually <2s.
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Wraps a fetch with an AbortController-based timeout. Rejects with a
 * descriptive error so the caller's catch branch can surface "gateway
 * timed out" instead of a silent hang.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class EvolinkImageProvider {
  readonly name = 'evolink-image';
  constructor(private readonly configs: EvolinkImageConfigs) {}

  private get baseUrl(): string {
    return (this.configs.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  }

  private get apiKey(): string {
    if (!this.configs.apiKey) throw new Error('apiKey is required');
    return this.configs.apiKey;
  }

  /**
   * `GET /v1/models` — OpenAI-compatible list endpoint. Different API
   * keys (different plans / groups) expose different models, so we
   * discover at runtime instead of hard-coding. Cached for 1 hour to
   * avoid hammering the endpoint.
   */
  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl}/models`;
    const resp = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!resp.ok) {
      throw new Error(
        `Evolink listModels failed: ${resp.status} ${resp.statusText}`
      );
    }
    const data: any = await resp.json().catch(() => ({}));
    const arr: any[] = Array.isArray(data?.data) ? data.data : [];
    return arr
      .map((m) => m?.id || m?.name || m?.model)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
  }

  /**
   * Submit an image generation task.
   *
   * Returns `{ mode: 'sync', imageUrls, ... }` when the gateway answered
   * inline (HTTP 200), or `{ mode: 'async', taskId, ... }` when it
   * handed back a polling id (HTTP 202). Sync callers can render the
   * result immediately; async callers must poll via `queryStatus()`.
   */
  async submit(args: {
    prompt: string;
    model: string;
    /** GPT Image 2 render resolution. Nano Banana uses `quality` instead. */
    resolution?: '1K' | '2K' | '4K';
    /**
     * GPT Image 2 accepts low/medium/high; Nano Banana 2 uses 1K/2K/4K.
     * The API route selects the valid value for the automatic model route.
     */
    quality?: 'low' | 'medium' | 'high' | '1K' | '2K' | '4K';
    size?: string;
    n?: number;
    // Reference image URLs. Nano Banana 2 wants them as `image_urls`
    // (array, max 14); older image models accept a single `image` string.
    referenceUrls?: string[];
  }): Promise<
    | {
        mode: 'sync';
        taskId: string; // synthetic — the caller's DB row id
        imageUrls: string[];
        model: string;
        raw: any;
      }
    | {
        mode: 'async';
        taskId: string; // remote polling id
        model: string;
        /** Gateway-provided estimate of completion time in seconds. May be
         *  undefined if the gateway didn't supply it (some models). */
        estimatedSeconds?: number;
        raw: any;
      }
  > {
    if (!args.prompt) throw new Error('prompt is required');
    if (!args.model) throw new Error('model is required');

    const url = `${this.baseUrl}/images/generations`;
    const lowerModel = args.model.toLowerCase();
    // Nano Banana 2 (gemini-*-flash-image-preview, nano-banana-*) is
    // its own generation API surface: it speaks `image_urls` arrays for
    // references and aspect-ratio strings for size, while the rest of
    // the gateway (gpt-image-2 etc.) stays on the OpenAI-style `image`
    // string + pixel `size` shape.
    const isNanoBanana =
      lowerModel.includes('gemini') || lowerModel.includes('nano-banana');
    const body: any = {
      model: args.model,
      prompt: args.prompt,
    };
    // `n` isn't part of the Nano Banana 2 spec — leave it off so the
    // gateway doesn't reject the request.
    if (!isNanoBanana) {
      body.n = args.n ?? 1;
    }
    if (args.size) body.size = args.size;
    if (isNanoBanana) {
      if (args.quality) body.quality = args.quality;
    } else {
      if (args.resolution) body.resolution = args.resolution;
      if (args.quality) body.quality = args.quality;
    }
    if (args.referenceUrls?.length) {
      if (isNanoBanana) {
        body.image_urls = args.referenceUrls;
      } else {
        body.image = args.referenceUrls[0];
      }
    }

    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(
        `Evolink submit failed: ${resp.status} ${resp.statusText}${txt ? ` — ${txt}` : ''}`
      );
    }

    const data: any = await resp.json().catch(() => {});
    console.log(
      '[evolink-image] submit response:',
      JSON.stringify(data).slice(0, 1500)
    );

    // Sync path (HTTP 200): response carries the image URLs inline.
    // gpt-image-2 and most modern models use this — no polling needed.
    const imageUrls = extractImageUrls(data);
    if (imageUrls.length) {
      // Some sync responses include an `id` too (e.g. `"task-..."`) but
      // it's just an opaque task id, not a polling handle. Treat it as
      // canonical for log correlation; caller uses the DB row id.
      const remoteId =
        typeof data?.id === 'string' && data.id
          ? data.id
          : `sync-${Date.now()}`;
      return {
        mode: 'sync',
        taskId: remoteId,
        imageUrls,
        model: data?.model || args.model,
        raw: data,
      };
    }

    // Async path (HTTP 202): only the task id is in the response. The
    // actual URLs come later via `queryStatus()`. The gateway also hands
    // back an estimated completion time in `task_info.estimated_time`
    // (seconds) — surfaced to the UI so the user sees a real countdown
    // instead of a generic "Generating…" spinner.
    if (data?.id) {
      const estimatedSeconds = extractEstimatedSeconds(data);
      return {
        mode: 'async',
        taskId: data.id,
        model: data?.model || args.model,
        estimatedSeconds,
        raw: data,
      };
    }

    throw new Error(
      'Evolink submit did not return image URLs or task id: ' +
        JSON.stringify(data).slice(0, 500)
    );
  }

  /**
   * Candidate poll paths. The gateway has shuffled these around in past
   * releases (the previous single hard-coded path silently 404'd on
   * newer versions). We probe them in order on the first call, cache
   * the first one that 200s, and use that on subsequent polls. A 404
   * on the cached path drops the cache so we re-probe next time.
   *
   * Order matters for first-poll latency — providers that return
   * `task-unified-...` ids (Nano Banana 2 / unified gateway) live on
   * `/v1/tasks`, so it goes FIRST to skip four wasted 404s on every
   * poll when the path-discovery cache is cold (we instantiate a
   * fresh provider per request).
   */
  static readonly CANDIDATE_POLL_PATHS = [
    '/v1/tasks', // unified tasks endpoint (Nano Banana 2 etc.)
    '/tasks', // pre-v1 unified tasks
    '/v1/images/generations', // current canonical
    '/images/generations', // pre-v1 fallback
    '/v1/image/generations', // alt singular
  ];

  /**
   * Pick the best poll path for a given task id WITHOUT probing.
   * Saves 4 wasted HTTP round-trips on the first poll — the provider
   * instance is recreated per request, so the cache is cold every time.
   */
  static pickPollPathForTaskId(taskId: string): string {
    if (taskId.startsWith('task-')) return '/v1/tasks';
    return EvolinkImageProvider.CANDIDATE_POLL_PATHS[0];
  }

  /**
   * Module-level cache of the working poll path per baseUrl.
   *
   * Previously this lived as `private discoveredPollPath` on the provider
   * instance — but the provider is `new`'d on every request (in `-image.ts`
   * and `$id.ts`), so the cache was cold on every poll and the
   * `pickPollPathForTaskId` hint had to shoulder the load. Hoisting it
   * here means once any request in the process discovers the right path,
   * every subsequent request starts with it cached and skips the fallback
   * sweep entirely. Capped per baseUrl so a stale entry can't linger if
   * the gateway shuffles paths.
   */
  private static readonly DISCOVERED_TTL_MS = 10 * 60 * 1000; // 10 min
  private static readonly discoveredCache = new Map<
    string,
    { path: string; expires: number }
  >();

  private get discoveredPollPath(): string | null {
    const entry = EvolinkImageProvider.discoveredCache.get(this.baseUrl);
    if (entry && entry.expires > Date.now()) return entry.path;
    return null;
  }

  private set discoveredPollPath(path: string | null) {
    if (path === null) {
      EvolinkImageProvider.discoveredCache.delete(this.baseUrl);
      return;
    }
    EvolinkImageProvider.discoveredCache.set(this.baseUrl, {
      path,
      expires: Date.now() + EvolinkImageProvider.DISCOVERED_TTL_MS,
    });
  }

  /**
   * Poll a previously-submitted task. Returns:
   *  - `{ status: 'processing' }` if not done yet
   *  - `{ status: 'success', urls }` once the image is ready
   *  - `{ status: 'failed', message }` on failure
   */
  async queryStatus(args: {
    taskId: string;
    model: string;
  }): Promise<
    | { status: 'processing' }
    | { status: 'success'; urls: string[]; model: string; raw: any }
    | { status: 'failed'; message: string; raw: any }
  > {
    // Skip the candidate sweep when the task id's prefix already tells us
    // which path serves it. The provider is recreated per request, so
    // the discovered-path cache is cold every poll — without this hint
    // we'd waste 4 HTTP round-trips on every poll hitting 404s.
    const paths = this.discoveredPollPath
      ? [this.discoveredPollPath]
      : (() => {
          const hint = EvolinkImageProvider.pickPollPathForTaskId(args.taskId);
          // Try the hinted path first, then the rest as a safety net.
          return [
            hint,
            ...EvolinkImageProvider.CANDIDATE_POLL_PATHS.filter(
              (p) => p !== hint
            ),
          ];
        })();

    for (const path of paths) {
      const url = `${this.baseUrl}${path}/${args.taskId}`;
      let resp: Response;
      try {
        resp = await fetchWithTimeout(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
      } catch (e: any) {
        console.log(`[evolink-image] ${path} fetch error:`, e?.message);
        // Network blip on the cached path — try the others on the next
        // tick so we don't get stuck forever.
        if (this.discoveredPollPath === path) this.discoveredPollPath = null;
        continue;
      }

      if (!resp.ok) {
        console.log(`[evolink-image] ${path} → HTTP ${resp.status}`);
        if (resp.status === 404 && this.discoveredPollPath === path) {
          // Cached path went away — re-probe next time.
          this.discoveredPollPath = null;
        }
        continue;
      }

      const data: any = await resp.json().catch(() => ({}));
      // First successful path wins; cache it for future polls.
      if (!this.discoveredPollPath) this.discoveredPollPath = path;
      console.log(
        `[evolink-image] ${path} → status="${data?.status ?? data?.state ?? '?'}" keys=${Object.keys(data || {}).join(',')} raw=${JSON.stringify(data).slice(0, 1500)}`
      );

      // Map various Evolink-style status strings to our enum. Also
      // tolerate `state` and other field names just in case.
      const statusRaw =
        data?.status ??
        data?.state ??
        data?.task_status ??
        data?.taskState ??
        data?.phase ??
        '';
      const status: string = String(statusRaw).toLowerCase();
      const failedHints = [
        'failed',
        'error',
        'canceled',
        'cancelled',
        'failure',
      ];
      if (failedHints.includes(status)) {
        return {
          status: 'failed' as const,
          message: data?.error?.message || data?.message || 'Image task failed',
          raw: data,
        };
      }

      const urls = extractImageUrls(data);
      if (urls.length) {
        return {
          status: 'success' as const,
          urls,
          model: data?.model || args.model,
          raw: data,
        };
      }

      // status is "processing" / "pending" / unknown — fall through to
      // the final return below; we'll poll again next tick.
      return { status: 'processing' as const };
    }

    // No candidate answered (or all 404'd). Caller treats this as
    // "still processing" and will retry.
    return { status: 'processing' as const };
  }
}

// ── Model discovery cache ───────────────────────────────────────────────
// Lets the playground work even when `evolink_image_model` is unset and
// the user's tier doesn't expose `flux-schnell`. The provider lists its
// own models at `GET /v1/models` and we pick the first one that looks
// like an image model.

interface DiscoveryCacheEntry {
  expires: number;
  model: string | null;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

// Substring hints used to tell image models apart from the text/audio
// models the same gateway serves. Order matters: IMAGE_HINTS is checked
// first so `gpt-image-2` isn't swallowed by the `gpt` text hint.
const IMAGE_HINTS = [
  'image',
  'img',
  'gpt-image',
  'dall-e',
  'sdxl',
  'sd-',
  'sd3',
  'flux',
  'imagen',
  'kandinsky',
  'midjourney',
  'firefly',
  'nano-banana',
  'seedream',
  'qwen-image',
  'grok-imagine',
];

// Checked BEFORE the image hints: the gateway serves many `*-image-to-video`
// ids (kling, seedance, wan, grok-imagine) whose names contain "image" but
// which are video endpoints. Without this pass they'd leak into the image
// menu and fail at submit time.
const VIDEO_HINTS = ['video', 't2v', 'i2v'];

const TEXT_ONLY_HINTS = [
  'gpt',
  'claude',
  'kimi',
  'chat',
  'embed',
  'whisper',
  'tts',
  'audio',
  'music',
  'transcribe',
  'realtime',
];

/**
 * Narrow a raw `/v1/models` listing down to the image-capable ids.
 *
 * Used two ways: to populate the composer's model menu, and as the
 * server-side allowlist for a client-supplied `model` (so a caller can't
 * bill an arbitrary model id through the image endpoint).
 */
export function filterEvolinkImageModels(models: string[]): string[] {
  // Drop video endpoints first — many are named `*-image-to-video`, so the
  // "image" hint below would otherwise match them.
  const notVideo = models.filter(
    (mo) => !VIDEO_HINTS.some((h) => mo.toLowerCase().includes(h))
  );
  const strong = notVideo.filter((mo) =>
    IMAGE_HINTS.some((h) => mo.toLowerCase().includes(h))
  );
  if (strong.length) return strong;
  // No obvious image ids — fall back to "everything that isn't clearly
  // text/audio" so a gateway with opaque names still yields a menu.
  return notVideo.filter(
    (mo) => !TEXT_ONLY_HINTS.some((h) => mo.toLowerCase().includes(h))
  );
}

interface ListCacheEntry {
  expires: number;
  models: string[];
}
const listCache = new Map<string, ListCacheEntry>();

/**
 * Cached image-model listing for the composer menu. Each call would
 * otherwise hit the gateway's `/v1/models`, so results are cached per API
 * key for an hour (same TTL as the single-model discovery above).
 *
 * `allowlist` — when provided, the listing is intersected with this set
 * so admins can pick exactly which image models appear in the menu
 * (everything else Evolink exposes stays hidden). Order in the allowlist
 * is preserved. Pass `undefined`/empty to keep the legacy behaviour of
 * returning every image-capable id.
 */
export async function listEvolinkImageModels(
  provider: EvolinkImageProvider,
  cacheKey: string,
  allowlist?: string[]
): Promise<string[]> {
  const now = Date.now();
  const cached = listCache.get(cacheKey);
  if (cached && cached.expires > now) return cached.models;

  let models: string[] = [];
  try {
    models = filterEvolinkImageModels(await provider.listModels());
  } catch (e: any) {
    console.warn('[evolink-image] listModels failed:', e?.message);
    return [];
  }

  // Apply the admin allowlist. We validate the ids against the live
  // listing so a typo in the admin config doesn't silently produce an
  // empty menu.
  if (allowlist && allowlist.length > 0) {
    const allowSet = new Set(allowlist);
    const kept = allowlist.filter((id) => models.includes(id));
    const dropped = allowlist.filter((id) => !models.includes(id));
    if (dropped.length) {
      console.warn(
        `[evolink-image] allowlist ids not in gateway listing: ${dropped.join(', ')}`
      );
    }
    models = kept.length ? kept : models;
  }

  listCache.set(cacheKey, { expires: now + DISCOVERY_TTL_MS, models });
  return models;
}

/**
 * Pick an image-capable model from the user's available models.
 *
 * Heuristic: prefer names that obviously mean image generation. Falls
 * back to the first model that *doesn't* look like text/embed/audio.
 * Caches the pick per API key for an hour.
 */
export async function pickEvolinkImageModel(
  provider: EvolinkImageProvider,
  explicitModel?: string
): Promise<string> {
  if (explicitModel) return explicitModel;
  const cacheKey = `${provider['configs'].apiKey}|${provider['baseUrl']}`;
  const cached = discoveryCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expires > now && cached.model) return cached.model;

  let models: string[] = [];
  try {
    models = await provider.listModels();
  } catch (e: any) {
    console.warn(
      '[evolink-image] listModels failed, falling back to default:',
      e?.message
    );
  }

  // Prefer names that clearly mean image generation (shared hint lists).
  const pick = filterEvolinkImageModels(models)[0] || models[0];

  discoveryCache.set(cacheKey, {
    expires: now + DISCOVERY_TTL_MS,
    model: pick || null,
  });
  if (pick) console.log(`[evolink-image] discovered model: ${pick}`);
  return pick || '';
}

// Re-export the legacy `generate()` for any caller that still expects
// the synchronous shape. It just submits and returns the task id wrapped
// in the same `{ urls, model }` shape so the old endpoint dispatch doesn't
// blow up.
export type _LegacyEvolinkResult = EvolinkImageResult;
export type _LegacyEvolinkGenerateArgs = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
};
