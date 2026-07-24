import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import {
  openaiChatCompletionStream,
  type ChatContentPart,
  type ChatTurn,
} from '@/core/ai/chat';
import { getAuth } from '@/core/auth';
import { getConfig } from '@/modules/config/service';
import { consumeMessage } from '@/modules/subscription-quota/service';
import { getCookieFromHeader } from '@/lib/cookie';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

/**
 * Stateless "API Playground" chat endpoint — **streaming** (SSE).
 *
 * Access tiers (in order):
 *   1. Anonymous visitor with no `kimi_free_chat_used` cookie → ONE free
 *      chat. On the way out we set the cookie so the next anonymous request
 *      trips the gate.
 *   2. Anonymous visitor with the cookie already set → `login_required`
 *      gate (must sign up / log in).
 *   3. Signed-in user with subscription quota or paid credits → allowed
 *      (`consumeMessage` debits).
 *   4. Signed-in user with neither → `payment_required` gate.
 *
 * Conversations are NOT persisted here — that's what /api/chat is for.
 * Prefer the configured `evolink` provider (model defaults to `kimi-k3`)
 * when its key is present.
 *
 * The response is a `text/event-stream` of typed JSON frames:
 *   data: {"t":"delta","text":"…"}     — incremental reply text
 *   data: {"t":"gate","status":"login_required" | "payment_required"}
 *   data: {"t":"error","message":"…"}
 *   data: {"t":"done","model":"…","provider":"…"}
 * Early validation/rate-limit failures still return a normal JSON envelope
 * (`respErr` / 429) — the client treats any non-event-stream response as an
 * error. Image attachments (`attachments[].type === 'image'`) are embedded as
 * `image_url` parts so a vision-capable model can actually see them; videos are
 * display-only and surfaced to the model as a text note.
 */

const MAX_TURNS = 20;
const MAX_CONTENT_LEN = 4000;
const RATE_LIMIT_INTERVAL_MS = 6000;
// Signed-in users: subscription quota first, then credit balance fallback.
// No free tier — 0 subscription quota + 0 credits = paywall.

const SYSTEM_PROMPT =
  'You are kimik3, a friendly, knowledgeable assistant powered by Kimi K3. You help people think, write, research, and build. Be concise, warm, and practical. Use Markdown when it improves clarity. When the user attaches images, look at them and respond to what you see.';

const NOT_CONFIGURED_REPLY = `👋 I'm kimik3 — but no live model is reachable yet.

An admin needs to connect one from **Admin → Settings → AI**:
1. Paste your key under the **evolink** group (\`evolink_api_key\`).
2. Set the model to **\`kimi-k3\`** (\`evolink_model\`) — or leave it blank and Kimi K3 is used by default.

Once that's in place, every message here gets a real Kimi K3 response.`;

interface PlaygroundConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

interface Attachment {
  type: 'image' | 'video' | 'document';
  url: string;
  filename?: string;
}

type SseEmit = (obj: Record<string, unknown>) => void;

/**
 * Resolve the model config for the playground. Prefers evolink (Kimi K3) when
 * its key is present, otherwise falls back to OpenAI. Same logic as
 * getChatModelConfig() in the chat service.
 */
async function resolvePlaygroundConfig(): Promise<PlaygroundConfig> {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      provider: 'evolink',
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || 'kimi-k3',
      hasKey: true,
    };
  }

  const apiKey =
    (await getConfig('openai_api_key')) || process.env.OPENAI_API_KEY || '';
  const baseUrl =
    (await getConfig('openai_base_url')) ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1';
  const model =
    (await getConfig('openai_model')) || process.env.OPENAI_MODEL || '';
  return { provider: 'openai', apiKey, baseUrl, model, hasKey: !!apiKey };
}

/** Build a `text/event-stream` Response that runs `work`, emitting frames.
 *  `setCookies` lets the caller attach one or more Set-Cookie headers to the
 *  response (used to flip the `kimi_free_chat_used` cookie after the first
 *  anonymous chat). */
function sseResponse(
  work: (emit: SseEmit) => Promise<void>,
  setCookies: string[] = []
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit: SseEmit = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        await work(emit);
      } catch (e: any) {
        emit({ t: 'error', message: e?.message || 'Stream failed' });
      } finally {
        controller.close();
      }
    },
  });
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  for (const cookie of setCookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(stream, { headers });
}

const MIME_FROM_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * Trusted URL prefixes the playground is allowed to inline. Anything else
 * (arbitrary internal IPs, cloud metadata endpoints, attacker-controlled
 * hosts) must be rejected — otherwise `fetch(url)` becomes an SSRF primitive
 * and a malicious attachment leaks private file contents into the model
 * prompt. Resolved at request time so admin-managed storage hosts are picked
 * up live.
 */
async function getTrustedStorageHosts(): Promise<Set<string>> {
  const hosts = new Set<string>();
  const r2Domain = await getConfig('r2_domain');
  if (r2Domain) {
    try {
      hosts.add(new URL(r2Domain).host);
    } catch {}
  }
  const s3Endpoint = await getConfig('s3_endpoint');
  if (s3Endpoint) {
    try {
      hosts.add(new URL(s3Endpoint).host);
    } catch {}
  }
  return hosts;
}

/**
 * Convert an attachment URL into an inline base64 data URL the model can read
 * without a public fetch. Vision providers download a remote `image_url` to
 * count tokens, so a `/uploads/...` path on localhost (or a private bucket in
 * prod) makes them fail with `count_token_failed`. Inlining the bytes removes
 * that dependency entirely — works in dev and prod.
 *
 * SECURITY: rejects anything that isn't an uploaded file (local `/uploads/...`)
 * or a URL on an explicitly-trusted storage host. Both blocks are protected
 * against path traversal / SSRF — `path.join` normalizes `..`, so the result
 * is re-anchored under `public/uploads/` before any read.
 */
async function toDataUrl(
  url: string,
  trustedHosts: Set<string>
): Promise<string> {
  if (url.startsWith('data:')) return url;

  // Local upload (no storage configured) — read straight from public/uploads.
  // Allow ONLY paths under /uploads/ and verify the resolved file stays inside
  // the uploads directory after normalization (blocks `/uploads/../../etc/...`).
  if (url.startsWith('/')) {
    if (!url.startsWith('/uploads/')) {
      throw new Error('Refusing to read files outside /uploads/');
    }
    const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
    const resolved = path.resolve(uploadsRoot, url.replace(/^\/uploads\//, ''));
    if (
      !resolved.startsWith(uploadsRoot + path.sep) &&
      resolved !== uploadsRoot
    ) {
      throw new Error('Path traversal blocked');
    }
    const buf = await readFile(resolved);
    const ext = (resolved.split('.').pop() || '').toLowerCase();
    const mime = MIME_FROM_EXT[ext] || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  // Remote URL (storage configured) — only fetch from trusted storage hosts.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid attachment URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (!trustedHosts.has(parsed.host)) {
    throw new Error(`Refusing to fetch from non-trusted host: ${parsed.host}`);
  }
  const res = await fetch(url, { redirect: 'manual' });
  // Follow no redirects — a redirect from a "trusted" host to a metadata IP
  // would re-introduce SSRF. The trusted host must serve the bytes directly.
  if (res.status >= 300 && res.status < 400) {
    throw new Error('Redirects are not allowed on attachment URLs');
  }
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Compose the message list. The last user turn becomes multimodal when images
 * are attached; videos are noted in text (the model can't ingest video).
 * Returns the model to use — a configured vision model when images are present.
 */
async function buildMessages(
  turns: ChatTurn[],
  attachments: Attachment[],
  cfg: PlaygroundConfig,
  trustedHosts: Set<string>
): Promise<{ messages: ChatTurn[]; model: string }> {
  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');
  const documents = attachments.filter((a) => a.type === 'document');

  let model = cfg.model;
  if (images.length > 0) {
    const vision =
      (await getConfig('evolink_vision_model')) ||
      (await getConfig('openai_vision_model')) ||
      '';
    if (vision) model = vision;
  }

  if (images.length === 0 && videos.length === 0 && documents.length === 0) {
    return { messages: turns, model };
  }

  // Attach media to the LAST user turn (that's the one being answered).
  const lastUserIdx = [...turns].reduce(
    (acc, t, i) => (t.role === 'user' ? i : acc),
    -1
  );
  if (lastUserIdx === -1) return { messages: turns, model };

  const lastText =
    typeof turns[lastUserIdx].content === 'string'
      ? (turns[lastUserIdx].content as string)
      : (turns[lastUserIdx].content as ChatContentPart[])
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');

  const parts: ChatContentPart[] = [];
  const textBits: string[] = [];
  if (lastText.trim()) textBits.push(lastText.trim());
  for (const v of videos) {
    textBits.push(`[Attached video${v.filename ? `: ${v.filename}` : ''}]`);
  }
  for (const d of documents) {
    textBits.push(
      `[Attached document${d.filename ? `: ${d.filename}` : ''} — ${d.url}]`
    );
  }
  parts.push({ type: 'text', text: textBits.join('\n\n') || ' ' });
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: await toDataUrl(img.url, trustedHosts) },
    });
  }

  const messages = turns.slice();
  messages[lastUserIdx] = { role: 'user', content: parts };
  return { messages, model };
}

/**
 * Signed-in chat gate: subscription quota → credit balance fallback.
 * Returns 'ok' if the message is billable, otherwise a gate status string.
 */
async function checkChatAccess(
  userId: string
): Promise<'ok' | 'payment_required'> {
  const result = await consumeMessage(userId);
  return result.success ? 'ok' : 'payment_required';
}

/** Cookie that marks an anonymous visitor as having used their free chat.
 *  HttpOnly so it can't be cleared from JS; 1-year max-age so clearing site
 *  data is the only way to reset. */
const FREE_CHAT_COOKIE = 'kimi_free_chat_used';
const FREE_CHAT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
function freeChatCookieHeader(): string {
  return `${FREE_CHAT_COOKIE}=1; Max-Age=${FREE_CHAT_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax`;
}

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: RATE_LIMIT_INTERVAL_MS,
    keyPrefix: 'playground-chat',
  });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const rawAttachments: Attachment[] = Array.isArray(body?.attachments)
    ? body.attachments.filter(
        (a: any) =>
          a &&
          (a.type === 'image' || a.type === 'video') &&
          typeof a.url === 'string'
      )
    : [];

  const history: ChatTurn[] = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content || content.length > MAX_CONTENT_LEN) continue;
    history.push({ role: m.role, content });
  }

  const turns = history.slice(-MAX_TURNS);
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return respErr('A user message is required');
  }

  const cfg = await resolvePlaygroundConfig();
  if (!cfg.hasKey) {
    // No live model — deliver the setup guidance as a normal (single-chunk) message.
    return sseResponse(async (emit) => {
      emit({ t: 'delta', text: NOT_CONFIGURED_REPLY });
      emit({ t: 'done', model: 'kimi-k3', provider: 'unconfigured' });
    });
  }

  // --- Access gate (only enforced when a live model is configured) ---
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });

  // Tier 1 + 2: anonymous visitor gets exactly one free chat, tracked via
  // an HttpOnly cookie. The cookie is checked server-side so clearing
  // document.cookie via JS can't reset it (only clearing site data works).
  const hasUsedFreeChat = !!getCookieFromHeader(
    request.headers.get('cookie'),
    FREE_CHAT_COOKIE
  );

  let gate: 'login_required' | 'payment_required' | null = null;
  let markFreeChatUsed = false;
  if (!session?.user) {
    if (!hasUsedFreeChat) {
      // Tier 1: first anonymous chat — allowed; flip the cookie on the way out.
      markFreeChatUsed = true;
    } else {
      // Tier 2: free chat already used — must sign up / log in.
      gate = 'login_required';
    }
  } else {
    // Tier 3 + 4: signed-in users need a subscription quota or credit balance.
    const access = await checkChatAccess(session.user.id);
    if (access !== 'ok') gate = 'payment_required';
  }

  if (gate) {
    return sseResponse(async (emit) => {
      emit({ t: 'gate', status: gate });
      emit({ t: 'done' });
    });
  }

  return sseResponse(
    async (emit) => {
      try {
        const trustedHosts = await getTrustedStorageHosts();
        const { messages, model } = await buildMessages(
          turns,
          rawAttachments,
          cfg,
          trustedHosts
        );
        for await (const delta of openaiChatCompletionStream({
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        })) {
          if (delta) emit({ t: 'delta', text: delta });
        }
        emit({ t: 'done', model, provider: cfg.provider });
      } catch (e: any) {
        emit({ t: 'error', message: e?.message || 'Generation failed' });
        emit({ t: 'done' });
      }
    },
    markFreeChatUsed ? [freeChatCookieHeader()] : []
  );
}

export const Route = createFileRoute('/api/playground/chat')({
  server: { handlers: { POST } },
});
