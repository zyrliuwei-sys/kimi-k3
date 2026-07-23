/**
 * Client-side reader for the streaming `/api/playground/chat` endpoint.
 *
 * This is the ONE intentional exception to "no raw fetch in components — use
 * @/lib/api-client": api-client is JSON-only and cannot consume an SSE stream.
 * Wrapped here so the two chat components share one parser instead of each
 * re-implementing ReadableStream frame splitting.
 *
 * Contract with the endpoint:
 *   - `text/event-stream` response → typed JSON frames on `data:` lines:
 *       { t:'delta', text } | { t:'gate', status } | { t:'error', message } | { t:'done', model?, provider? }
 *   - anything else (rate-limit 429 / `respErr` envelope / network) → parsed as
 *     a JSON error envelope and thrown, matching how api-client surfaces errors.
 */
export interface ChatStreamHandlers {
  onDelta?: (text: string) => void;
  onGate?: (status: 'login_required' | 'payment_required') => void;
  onDone?: (info: { model?: string; provider?: string }) => void;
  onError?: (message: string) => void;
}

export interface ChatStreamBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  attachments?: {
    type: 'image' | 'video' | 'document';
    url: string;
    filename?: string;
  }[];
}

export async function streamChat(
  body: ChatStreamBody,
  handlers: ChatStreamHandlers & { signal?: AbortSignal }
): Promise<void> {
  const { onDelta, onGate, onDone, onError, signal } = handlers;

  let res: Response;
  try {
    res = await fetch('/api/playground/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
    const msg = e?.message || 'Network request failed';
    onError?.(msg);
    throw new Error(msg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Non-streaming error envelope (respErr `{code,message}` or 429 `{message}`)
    const data = await res.json().catch(() => ({}));
    const msg =
      data?.message ||
      (data?.error
        ? `Request failed: ${data.error}`
        : `Request failed (${res.status})`);
    onError?.(msg);
    throw new Error(msg);
  }

  if (!res.body) {
    const msg = 'Streaming unsupported: empty response body';
    onError?.(msg);
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatchFrame(frame, { onDelta, onGate, onDone, onError });
      }
    }
    if (buffer.trim()) {
      dispatchFrame(buffer, { onDelta, onGate, onDone, onError });
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
    const msg = e?.message || 'Stream interrupted';
    onError?.(msg);
    throw new Error(msg);
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(frame: string, handlers: ChatStreamHandlers): void {
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    switch (evt?.t) {
      case 'delta':
        if (typeof evt.text === 'string' && evt.text)
          handlers.onDelta?.(evt.text);
        break;
      case 'gate':
        if (
          evt.status === 'login_required' ||
          evt.status === 'payment_required'
        ) {
          handlers.onGate?.(evt.status);
        }
        break;
      case 'error':
        if (typeof evt.message === 'string') handlers.onError?.(evt.message);
        break;
      case 'done':
        handlers.onDone?.({ model: evt.model, provider: evt.provider });
        break;
    }
  }
}
