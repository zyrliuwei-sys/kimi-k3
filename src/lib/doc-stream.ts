/**
 * Client-side SSE reader for the /api/doc-library/ask stream.
 *
 * Mirrors `lib/chat-stream.ts` but adapts the `sources` event so the
 * Document Library chat tab can render citation chips and the "click to jump
 * to PDF page" affordance.
 *
 * Wire format (server → client):
 *   { t:'delta',   text }
 *   { t:'sources', sources: [{ docId, filename, page, quote }] }
 *   { t:'done' }
 *   { t:'error',   message: 'login_required' | 'payment_required' | '…' }
 */

export interface DocSource {
  docId: string;
  filename: string;
  page?: number;
  quote: string;
}

export interface DocAskHandlers {
  onDelta?: (text: string) => void;
  onSources?: (sources: DocSource[]) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface DocAskBody {
  collectionId: string;
  question: string;
}

export async function streamDocAsk(
  body: DocAskBody,
  handlers: DocAskHandlers & { signal?: AbortSignal }
): Promise<void> {
  const { onDelta, onSources, onDone, onError, signal } = handlers;

  let res: Response;
  try {
    res = await fetch('/api/doc-library/ask', {
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

  if (res.status === 401) {
    onError?.('login_required');
    return;
  }
  if (res.status === 402) {
    onError?.('payment_required');
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    const msg = data?.message || `Request failed (${res.status})`;
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
        dispatchDocFrame(frame, { onDelta, onSources, onDone, onError });
      }
    }
    if (buffer.trim()) {
      dispatchDocFrame(buffer, { onDelta, onSources, onDone, onError });
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

function dispatchDocFrame(frame: string, handlers: DocAskHandlers): void {
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
      case 'sources':
        if (Array.isArray(evt.sources)) {
          handlers.onSources?.(evt.sources as DocSource[]);
        }
        break;
      case 'error':
        if (typeof evt.message === 'string') handlers.onError?.(evt.message);
        break;
      case 'done':
        handlers.onDone?.();
        break;
    }
  }
}
