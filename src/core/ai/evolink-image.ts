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
    const p = this.discoveredPollPath ?? `/images/generations/${args.taskId}`;
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

  // Prefer names that clearly mean image generation.
  const imageHints = [
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
  ];
  const textOnlyHints = [
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

  const pick =
    models.find((m) => imageHints.some((h) => m.toLowerCase().includes(h))) ||
    models.find(
      (m) => !textOnlyHints.some((h) => m.toLowerCase().includes(h))
    ) ||
    models[0];

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
