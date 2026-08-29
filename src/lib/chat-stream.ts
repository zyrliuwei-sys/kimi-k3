/**
 * Client-side readers for the streaming chat endpoints.
 *
 * These are the ONE intentional exception to "no raw fetch in components —
 * use @/lib/api-client": api-client is JSON-only and cannot consume an SSE
 * stream. Wrapped here so the chat components share one parser instead of
 * each re-implementing ReadableStream frame splitting.
 *
 * Contract with the endpoints:
 *   - `text/event-stream` response → typed JSON frames on `data:` lines:
 *       { t:'delta', text } | { t:'gate', status } | { t:'error', message } | { t:'done', model?, provider? }
 *     The compare endpoint (`/api/playground/compare`) adds a column index
 *     `c` to every frame and a terminal `{ t:'end' }`.
 *   - anything else (rate-limit 429 / `respErr` envelope / network) → parsed as
 *     a JSON error envelope and thrown, matching how api-client surfaces errors.
 */
export interface ChatStreamHandlers {
  onDelta?: (text: string) => void;
  onGate?: (
    status: 'login_required' | 'payment_required' | 'free_limit_reached'
  ) => void;
  onDone?: (info: {
    model?: string;
    provider?: string;
    userMessage?: { id: string; role: 'user'; content: string };
    assistantMessage?: { id: string; role: 'assistant'; content: string };
  }) => void;
  onError?: (message: string) => void;
}

export interface ChatStreamBody {
  /** When set, use the persistent multi-session chat endpoint. */
  chatId?: string | null;
  /** A server-validated EvoLink model id for this turn. */
  model?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  attachments?: {
    type: 'image' | 'video' | 'document';
    url: string;
    // Storage key from the upload response. Lets the server re-download
    // via a signed request — required for private R2 buckets.
    key?: string;
    filename?: string;
  }[];
}

export async function streamChat(
  body: ChatStreamBody,
  handlers: ChatStreamHandlers & { signal?: AbortSignal }
): Promise<void> {
  const { onDelta, onGate, onDone, onError, signal } = handlers;
  const isPersistentChat = !!body.chatId;
  const latestMessage = body.messages.at(-1)?.content ?? '';

  const res = await fetchSse(
    isPersistentChat
      ? `/api/chat/${encodeURIComponent(body.chatId!)}`
      : '/api/playground/chat',
    // The session endpoint reconstructs prior turns from its database,
    // while the public playground endpoint remains stateless and receives
    // the full browser-side transcript.
    // Persistent chats keep their message history server-side, but still
    // need the freshly uploaded attachment pointers so the route can turn
    // documents into temporary model context for this turn.
    isPersistentChat
      ? {
          content: latestMessage,
          model: body.model,
          attachments: body.attachments ?? [],
        }
      : body,
    { onError, signal }
  );

  try {
    await consumeSseFrames(res, (frame) =>
      dispatchFrame(frame, { onDelta, onGate, onDone, onError })
    );
  } catch (e) {
    // User-initiated abort — swallow, matching the original contract.
    if (e instanceof AbortedError) return;
    throw e;
  }
}

// ─── Side-by-side compare (`/api/playground/compare`) ────────────────────────

export interface CompareStreamBody {
  /** One entry per column; each column carries its OWN conversation history. */
  columns: {
    model: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }[];
}

export interface CompareStreamHandlers {
  /** `c` is the column index; undefined means the frame applies to all columns. */
  onDelta?: (c: number | undefined, text: string) => void;
  onGate?: (
    c: number | undefined,
    status: 'login_required' | 'payment_required' | 'free_limit_reached'
  ) => void;
  onError?: (c: number | undefined, message: string) => void;
  onDone?: (
    c: number | undefined,
    info: { model?: string; provider?: string }
  ) => void;
  /** All columns finished — the server closes the stream right after. */
  onEnd?: () => void;
  onErrorGlobal?: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamCompare(
  body: CompareStreamBody,
  handlers: CompareStreamHandlers
): Promise<void> {
  const { onDelta, onGate, onError, onDone, onEnd, onErrorGlobal, signal } =
    handlers;

  const res = await fetchSse('/api/playground/compare', body, {
    onError: onErrorGlobal,
    signal,
  });

  await consumeSseFrames(res, (frame) => {
    for (const evt of parseFrame(frame)) {
      const c = typeof evt.c === 'number' ? evt.c : undefined;
      switch (evt.t) {
        case 'delta':
          if (typeof evt.text === 'string' && evt.text) onDelta?.(c, evt.text);
          break;
        case 'gate':
          if (
            evt.status === 'login_required' ||
            evt.status === 'payment_required' ||
            evt.status === 'free_limit_reached'
          ) {
            onGate?.(c, evt.status);
          }
          break;
        case 'error':
          if (typeof evt.message === 'string') onError?.(c, evt.message);
          break;
        case 'done':
          onDone?.(c, { model: evt.model, provider: evt.provider });
          break;
        case 'end':
          onEnd?.();
          break;
      }
    }
  });
}

// ─── Shared SSE plumbing ─────────────────────────────────────────────────────

/** POST `body` and assert an event-stream response; throw on error envelopes. */
async function fetchSse(
  url: string,
  body: unknown,
  opts: { onError?: (message: string) => void; signal?: AbortSignal }
): Promise<Response> {
  // Client-side safety net: if the server takes >120s to send the first
  // byte (DB hang, auth hang, upstream gateway hang without our
  // upstream-timeout kicking in), abort and surface an error so the
  // "thinking…" UI doesn't freeze. The upstream provider also has its own
  // 90s timeout inside the server, so this only fires for the rarer case
  // where the server itself can't return at all.
  const firstByteTimer = setTimeout(() => {
    opts.onError?.('Request timed out — please try again.');
  }, 120_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    clearTimeout(firstByteTimer);
  } catch (e: any) {
    clearTimeout(firstByteTimer);
    if (e?.name === 'AbortError') throw new AbortedError();
    const msg = e?.message || 'Network request failed';
    opts.onError?.(msg);
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
    opts.onError?.(msg);
    throw new Error(msg);
  }
  return res;
}

/** Internal marker so callers can skip toast on user-initiated aborts. */
export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

/** Read an SSE body and hand every complete `\n\n`-separated frame to `onFrame`. */
async function consumeSseFrames(
  res: Response,
  onFrame: (frame: string) => void
): Promise<void> {
  if (!res.body) {
    throw new Error('Streaming unsupported: empty response body');
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
        onFrame(frame);
      }
    }
    if (buffer.trim()) {
      onFrame(buffer);
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
    const msg = e?.message || 'Stream interrupted';
    throw new Error(msg);
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(frame: string, handlers: ChatStreamHandlers): void {
  for (const evt of parseFrame(frame)) {
    switch (evt.t ?? evt.type) {
      case 'delta':
        if (typeof evt.text === 'string' && evt.text)
          handlers.onDelta?.(evt.text);
        break;
      case 'gate':
        if (
          evt.status === 'login_required' ||
          evt.status === 'payment_required' ||
          evt.status === 'free_limit_reached'
        ) {
          handlers.onGate?.(evt.status);
        }
        break;
      case 'error':
        if (typeof evt.message === 'string') handlers.onError?.(evt.message);
        break;
      case 'done':
        handlers.onDone?.({
          model: evt.model,
          provider: evt.provider,
          userMessage: evt.userMessage,
          assistantMessage: evt.assistantMessage,
        });
        break;
    }
  }
}

/** Parse one SSE frame (`data: {...}` lines) into its JSON payloads. */
function parseFrame(frame: string): any[] {
  const events: any[] = [];
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      if (evt && typeof evt === 'object') events.push(evt);
    } catch {
      // keepalive / partial chunk — ignore
    }
  }
  return events;
}
