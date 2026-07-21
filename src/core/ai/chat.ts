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
  signal?: AbortSignal;
}

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
    signal,
  } = params;

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
    signal,
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
}

/**
 * Streaming chat completion. Yields incremental text deltas as the model
 * generates them (SSE `stream: true`); the caller concatenates. Throws on a
 * non-2xx response (same error shape as the one-shot variant) or if the stream
 * aborts via `signal`.
 */
export async function* openaiChatCompletionStream(
  params: ChatCompletionParams
): AsyncGenerator<string, void, unknown> {
  const { apiKey, baseUrl, model, messages, temperature = 1, signal } = params;

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
    signal,
  });

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
        const delta = parseFrame(frame);
        if (delta) yield delta;
      }
    }
    // Flush any trailing frame.
    if (buffer.trim()) {
      const delta = parseFrame(buffer);
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse one SSE frame, returning any text delta it carries (or ''). */
function parseFrame(frame: string): string {
  // A frame may contain comment/keepalive lines and multiple `data:` lines;
  // OpenAI sends one JSON object per `data:` line. Concatenate text deltas.
  let out = '';
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const piece: string | undefined = json?.choices?.[0]?.delta?.content;
      if (piece) out += piece;
    } catch {
      // Ignore malformed keepalive / partial chunks — SSE is line-oriented and
      // resilient to the occasional non-JSON event.
    }
  }
  return out;
}
