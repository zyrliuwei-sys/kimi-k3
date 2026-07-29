/**
 * Evolink image-generation provider.
 *
 * Evolink (https://evolink.ai) is an OpenAI-compatible gateway, so image
 * generation follows the standard `POST {baseUrl}/images/generations`
 * shape with `{ model, prompt, n, size }` and a sync response of
 * `{ created, data: [{ url, b64_json }] }`.
 *
 * But the gateway also supports an *async* task API:
 *   submit returns `{ id, status: "processing", task_info: { estimated_time: 200 } }`
 *   poll     `GET /v1/images/generations/{id}` returns the final image URLs
 *
 * We use the async path because fast/large models can take several
 * minutes; the playground polls the task from the browser rather than
 * holding a 4-minute HTTP request open.
 */

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
    const resp = await fetch(url, {
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
   * Submit a text-to-image task. Returns the task id; the actual image
   * arrives later via `queryStatus()`.
   *
   * Evolink's response shape (verified live):
   *   { id: "task-unified-…", status: "processing",
   *     task_info: { estimated_time: 200 }, progress: 1, … }
   */
  async submit(args: {
    prompt: string;
    model: string;
    size?: string;
    n?: number;
  }): Promise<{ taskId: string; model: string; raw: any }> {
    if (!args.prompt) throw new Error('prompt is required');
    if (!args.model) throw new Error('model is required');

    const url = `${this.baseUrl}/images/generations`;
    const body: any = {
      model: args.model,
      prompt: args.prompt,
      n: args.n ?? 1,
    };
    if (args.size) body.size = args.size;

    const resp = await fetch(url, {
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

    const data: any = await resp.json().catch(() => ({}));
    console.log(
      '[evolink-image] submit response:',
      JSON.stringify(data).slice(0, 1500)
    );
    if (!data?.id) {
      throw new Error(
        'Evolink submit did not return an id: ' +
          JSON.stringify(data).slice(0, 500)
      );
    }
    return { taskId: data.id, model: data.model || args.model, raw: data };
  }

  /**
   * Track which polling endpoint worked the first time we found a hit,
   * so subsequent polls go straight to the same path.
   */
  private discoveredPollPath: string | null = null;

  /**
   * Poll a previously-submitted task. Returns:
   *  - `{ status: 'pending' | 'processing' }` if not done yet
   *  - `{ status: 'success', urls }` once the image is ready
   *  - `{ status: 'failed', message }` on failure
   */
  async queryStatus(args: {
    taskId: string;
    model: string;
  }): Promise<
    | { status: 'pending' | 'processing' }
    | { status: 'success'; urls: string[]; model: string; raw: any }
    | { status: 'failed'; message: string; raw: any }
  > {
    // Single canonical path. Hardcoded after 60+ polls of "processing"
    // never resolved — the previous multi-path probe was almost
    // certainly missing the right URL on this version of Evolink.
    // The /v1/ prefix is required by the current Evolink gateway — the
    // path without it returns 403 (verified live). Earlier the code
    // omitted /v1/, which made every poll fail silently and made the
    // task look stuck in "processing" forever.
    const p =
      this.discoveredPollPath ?? `/v1/images/generations/${args.taskId}`;
    const url = `${this.baseUrl}${p}`;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (e: any) {
      console.log(`[evolink-image] ${p} fetch error:`, e?.message);
      return { status: 'processing' as const };
    }
    if (!resp.ok) {
      console.log(`[evolink-image] ${p} → HTTP ${resp.status}`);
      // If 404 on the cached path, drop the cache so the NEXT poll
      // re-discovers (in case the schema changed).
      if (resp.status === 404) this.discoveredPollPath = null;
      return { status: 'processing' as const };
    }

    const data: any = await resp.json().catch(() => ({}));
    if (!this.discoveredPollPath) this.discoveredPollPath = p;
    console.log(
      `[evolink-image] ${p} → status="${data?.status ?? data?.state ?? '?'}" keys=${Object.keys(data || {}).join(',')} raw=${JSON.stringify(data).slice(0, 1500)}`
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
    const successHints = [
      'success',
      'succeeded',
      'completed',
      'complete',
      'finished',
      'done',
      'succeed',
      'ready',
      'output_ready',
      'image_ready',
    ];
    const failedHints = ['failed', 'error', 'canceled', 'cancelled', 'failure'];
    if (failedHints.includes(status)) {
      return {
        status: 'failed' as const,
        message: data?.error?.message || data?.message || 'Image task failed',
        raw: data,
      };
    }
    const urls = this.extractUrls(data);
    if (urls.length) {
      return {
        status: 'success' as const,
        urls,
        model: data?.model || args.model,
        raw: data,
      };
    }
    if (successHints.includes(status)) {
      console.log(
        `[evolink-image] status=success but no urls yet, will retry next poll`
      );
    }
    return { status: 'processing' as const };
  }

  /**
   * Pull every image URL out of the provider response. Supports
   * multiple shapes (OpenAI's `data[]`, common variants `images[]`,
   * `result[]`, `output[]`, or a bare array). Each item may carry
   * the image as `url`, `image_url`, or `b64_json` — we translate
   * the last to a data: URL so the browser can render it directly.
   */
  private extractUrls(data: any): string[] {
    // Try the standard array-shaped fields first.
    const arrayCandidates: Array<any> = [
      data?.data,
      data?.images,
      data?.result,
      data?.result_data,
      data?.output,
      data?.outputs,
      data?.results,
      Array.isArray(data) ? data : null,
    ].filter(Array.isArray);
    for (const arr of arrayCandidates) {
      const urls: string[] = [];
      for (const item of arr as any[]) {
        if (typeof item === 'string' && item.length) {
          urls.push(item);
          continue;
        }
        const url =
          item?.url ||
          item?.image_url ||
          item?.imageUrl ||
          item?.output_url ||
          (item?.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : undefined);
        if (typeof url === 'string' && url.length) urls.push(url);
      }
      if (urls.length) return urls;
    }
    // Single-string fallbacks (some gateways return the URL directly
    // on the response root or under a nested key).
    const stringCandidates: Array<string | undefined> = [
      data?.url,
      data?.image_url,
      data?.imageUrl,
      data?.output_url,
      // OpenAI-style `data: [{ url }]` already covered above; some
      // gateways put a single URL in `data` as a string.
      typeof data?.data === 'string' ? data.data : undefined,
    ];
    for (const url of stringCandidates) {
      if (typeof url === 'string' && url.length) return [url];
    }
    return [];
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
