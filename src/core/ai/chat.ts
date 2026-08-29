/**
 * Minimal OpenAI-compatible chat-completion client.
 *
 * Server-only. Works with any endpoint that implements the
 * `/v1/chat/completions` shape (OpenAI, Moonshot/Kimi, Together, OpenRouter,
 * vLLM, …). The chat service resolves credentials from DB config + env, then
 * hands them here as plain values so this module stays free of config/db deps.
 *
 * Supports both a one-shot (`openaiChatCompletion`) and a streaming
 * (`openaiChatCompletionStream`) variant. `content` may be a plain string or an
 * array of typed parts — the array form enables multimodal turns (e.g. sending
 * an image to a vision-capable model via `image_url`).
 *
 * The streaming variant asks the provider to emit a final usage frame
 * (`stream_options.include_usage`). Providers that ignore the flag just never
 * send `usage` — callers must treat the absence as "estimate only, no
 * refund possible" rather than an error.
 */

/** A single piece of multimodal message content (OpenAI chat-completions shape). */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
    };

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatCompletionParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatTurn[];
  temperature?: number;
  /** Omit sampling parameters for routes that reject them. */
  includeTemperature?: boolean;
  /** Server-enforced output ceiling used by premium routes. */
  maxCompletionTokens?: number;
  /** GPT-5 uses `max_completion_tokens`; Claude-compatible routes accept the
   * conventional `max_tokens` parameter. */
  maxCompletionTokenField?: 'max_tokens' | 'max_completion_tokens';
  signal?: AbortSignal;
}

/** Token-usage totals, sent as a terminal frame by the streaming variant when
 *  the provider supports `stream_options.include_usage`. */
export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Cache-hit tokens included in prompt_tokens when EvoLink reports them. */
  cached_tokens?: number;
  /** Cache-write tokens included in prompt_tokens when EvoLink reports them. */
  cache_write_tokens?: number;
}

/** One yield from the streaming generator. Either an incremental text delta
 *  (concatenated across multiple `data:` lines in the same SSE frame) or a
 *  single terminal usage frame — never both in the same yield. */
export type ChatCompletionChunk = string | { usage: ChatCompletionUsage };

export async function openaiChatCompletion(
  params: ChatCompletionParams
): Promise<string> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    // Kimi K3 (and several reasoning models) only accept temperature = 1;
    // 1 is also the OpenAI default, so it's a safe default for any provider.
    temperature = 1,
    includeTemperature = true,
    maxCompletionTokens,
    maxCompletionTokenField = 'max_tokens',
    signal,
  } = params;

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (includeTemperature) body.temperature = temperature;
  if (maxCompletionTokens) body[maxCompletionTokenField] = maxCompletionTokens;

  // Hard cap mirroring the streaming variant. Without it a hung gateway
  // leaves the one-shot completion pending forever — the file-studio
  // generator is the main caller, and a stalled request there never
  // produces a response, wedging the client's generation mutation (send
  // button + model picker disabled) until a manual reload.
  const controller = new AbortController();
  const upstreamTimer = setTimeout(() => controller.abort(), 120_000);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Chat request failed (${res.status}): ${detail.slice(0, 300)}`
      );
    }

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from model');
    return content;
  } catch (e: any) {
    if (e?.name === 'AbortError' && !signal?.aborted) {
      throw new Error(
        'Upstream chat provider timed out after 120s — please retry.'
      );
    }
    throw e;
  } finally {
    clearTimeout(upstreamTimer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Streaming chat completion. Yields incremental text deltas as the model
 * generates them (SSE `stream: true`); the caller concatenates. When the
 * provider honors `stream_options.include_usage`, a final `{ usage }` chunk
 * is yielded after the last text delta. Throws on a non-2xx response (same
 * error shape as the one-shot variant) or if the stream aborts via `signal`.
 */
export async function* openaiChatCompletionStream(
  params: ChatCompletionParams
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 1,
    includeTemperature = true,
    maxCompletionTokens,
    maxCompletionTokenField = 'max_tokens',
    signal,
  } = params;

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  // Hard upstream cap. Without it, a hung gateway leaves the SSE stream
  // open indefinitely — the client never receives a `done` / `error`
  // frame and the playground's "thinking…" UI freezes. 90s covers any
  // realistic chat completion (even the slowest Kimi K3 reasoning pass)
  // while still failing fast enough for the user to retry.
  const controller = new AbortController();
  const upstreamTimer = setTimeout(() => controller.abort(), 90_000);
  // Forward the caller's signal so client-side cancel still works.
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  let res: Response;
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      // Ask the provider to emit a final frame with `usage`. Not all
      // OpenAI-compatible gateways honor this — when missing, the parser
      // just never yields a usage chunk and the caller's pre-flight
      // reservation stands.
      stream_options: { include_usage: true },
    };
    if (includeTemperature) body.temperature = temperature;
    if (maxCompletionTokens) {
      body[maxCompletionTokenField] = maxCompletionTokens;
    }

    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(upstreamTimer);
    signal?.removeEventListener('abort', onCallerAbort);
    if (e?.name === 'AbortError' && !signal?.aborted) {
      throw new Error(
        'Upstream chat provider timed out after 90s — please retry.'
      );
    }
    throw e;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Chat request failed (${res.status}): ${detail.slice(0, 300)}`
    );
  }
  if (!res.body) throw new Error('Streaming unsupported: no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; process each complete frame.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const chunk of parseFrame(frame)) yield chunk;
      }
    }
    // Flush any trailing frame.
    if (buffer.trim()) {
      for (const chunk of parseFrame(buffer)) yield chunk;
    }
  } finally {
    clearTimeout(upstreamTimer);
    signal?.removeEventListener('abort', onCallerAbort);
    reader.releaseLock();
  }
}

/** Parse one SSE frame. A frame may contain comment/keepalive lines and
 *  multiple `data:` lines; OpenAI sends one JSON object per `data:` line. The
 *  text delta and the usage object (when present) are emitted as separate
 *  chunks so the caller's text concatenation loop stays simple. */
function parseFrame(frame: string): ChatCompletionChunk[] {
  let text = '';
  let usage: ChatCompletionUsage | undefined;
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const piece: string | undefined = json?.choices?.[0]?.delta?.content;
      if (piece) text += piece;
      if (json?.usage) {
        const promptDetails =
          json.usage.prompt_tokens_details ??
          json.usage.input_tokens_details ??
          {};
        usage = {
          prompt_tokens: Number(json.usage.prompt_tokens) || 0,
          completion_tokens: Number(json.usage.completion_tokens) || 0,
          total_tokens: Number(json.usage.total_tokens) || 0,
          cached_tokens:
            Number(
              promptDetails.cached_tokens ?? promptDetails.cache_read_tokens
            ) || 0,
          cache_write_tokens:
            Number(
              promptDetails.cache_write_tokens ??
                promptDetails.cache_creation_tokens
            ) || 0,
        };
      }
    } catch {
      // Ignore malformed keepalive / partial chunks — SSE is line-oriented and
      // resilient to the occasional non-JSON event.
    }
  }
  const out: ChatCompletionChunk[] = [];
  if (text) out.push(text);
  if (usage) out.push({ usage });
  return out;
}
