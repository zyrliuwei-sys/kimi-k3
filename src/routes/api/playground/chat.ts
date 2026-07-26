import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFileRoute } from '@tanstack/react-router';

import {
  openaiChatCompletionStream,
  type ChatCompletionUsage,
  type ChatContentPart,
  type ChatTurn,
} from '@/core/ai/chat';
import { checkLongContextAllowed } from '@/core/ai/tier-pricing';
import { estimateMessagesTokens } from '@/core/ai/token-estimate';
import { getAuth } from '@/core/auth';
import { getConfig } from '@/modules/config/service';
import { getBalance } from '@/modules/credits/service';
import { parseDocument } from '@/modules/doc-library/parser';
import { getStorage } from '@/modules/storage/service';
import { refundConsume } from '@/modules/subscription-quota/refund';
import {
  consumeMessage,
  getRemainingQuota,
} from '@/modules/subscription-quota/service';
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
 * `image_url` parts so a vision-capable model can actually see them; document
 * attachments (PDF / DOCX / XLSX / PPTX / MD / TXT / CSV) are fetched, parsed
 * into plain text, and inlined into the user turn so the model can read them;
 * videos are display-only and surfaced to the model as a text note.
 */

const MAX_TURNS = 20;
const MAX_CONTENT_LEN = 4000;
// 2s between messages — feels like a real conversation without opening the
// floodgates. The hard cost ceiling is the credit/quota gate downstream
// (signed-in: consumeMessage debits; anon: 1 free chat per IP via cookie),
// so this is just an anti-click-spam guard, not an anti-abuse wall.
const RATE_LIMIT_INTERVAL_MS = 2000;
// Signed-in users: subscription quota first, then credit balance fallback.
// No free tier — 0 subscription quota + 0 credits = paywall.

const SYSTEM_PROMPT =
  'You are kimik3, a friendly, knowledgeable assistant powered by Kimi K3. You help people think, write, research, and build. Be concise, warm, and practical. Use Markdown when it improves clarity. When the user attaches images, look at them and respond to what you see. When the user attaches documents (PDF, Word, Markdown, plain text, CSV, etc.), their parsed text is inlined in the user message — read the document contents and answer from them directly. When the user attaches a video, the client has extracted several still frames and uploaded them as images covering the first ~60s of the video; treat those frames as a sampling of the video content and describe / answer based on what you can see in them.';

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
  // Storage key from the upload endpoint. When storage is configured, the
  // playground re-downloads via the storage provider's signed GET (private
  // R2 buckets 401 on unauthenticated fetches). Optional so legacy clients
  // / data still work via the URL fallback.
  key?: string;
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

// Mirrors upload-media.ts so we can derive a sensible MIME for a local
// document when the upstream Content-Type header is missing (e.g. `/uploads/`
// files served by Vite's static handler).
const MIME_FROM_EXT_DOC: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
};

// Per-document char budget before we truncate a single attachment's text.
// Keeps a stack of large docs from blowing out the model context window.
// ~500k chars ≈ 125k tokens — leaves room for the system prompt + history
// + the user's question.
const MAX_DOC_CHARS = 500_000;

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
 * Read the raw bytes of an attachment. Three resolution paths, in order:
 *
 *   1. `attachment.key` set + storage configured → signed GET via the
 *      storage provider (works against private R2 buckets where the
 *      unauthenticated public URL would 401).
 *   2. URL is a local `/uploads/...` path → read straight from disk. Path
 *      stays anchored under `public/uploads/` (blocks `/uploads/../etc/...`).
 *   3. URL is on a trusted storage host → unauthenticated GET. Works only
 *      when the bucket is public; private buckets fall back to (1) via the
 *      upload key.
 *
 * Returns `{ bytes, mime }`. Callers pick how to consume it (vision → base64
 * data URL, document → text parser).
 */
async function readAttachmentBytes(
  attachment: { url: string; key?: string },
  trustedHosts: Set<string>,
  opts: { fallbackMime?: string } = {}
): Promise<{ bytes: Buffer; mime: string }> {
  const { url, key } = attachment;

  // 1) Signed download via the storage provider — the only path that works
  //    against a private R2 bucket.
  if (key) {
    const storage = await getStorage();
    if (storage) {
      const result = await storage.downloadFile({ key });
      if (result) {
        return {
          bytes: result.bytes,
          mime: result.mime || opts.fallbackMime || 'application/octet-stream',
        };
      }
    }
    // Storage was wiped/unconfigured after upload — the key is useless now.
    // Fall through to the URL path so the user still gets a clear error
    // instead of a generic "no key found".
  }

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)/);
    return {
      bytes: Buffer.from(url.split(',', 2)[1] || '', 'base64'),
      mime: match?.[1] || opts.fallbackMime || 'application/octet-stream',
    };
  }

  // 2) Local upload (no storage configured).
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
    return {
      bytes: buf,
      mime:
        MIME_FROM_EXT[ext] ||
        MIME_FROM_EXT_DOC[ext] ||
        opts.fallbackMime ||
        'application/octet-stream',
    };
  }

  // 3) Remote URL on a trusted storage host — only works for public buckets.
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
  if (res.status >= 300 && res.status < 400) {
    throw new Error('Redirects are not allowed on attachment URLs');
  }
  if (!res.ok) throw new Error(`Failed to fetch attachment (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime =
    res.headers.get('content-type')?.split(';')[0] ||
    opts.fallbackMime ||
    'application/octet-stream';
  return { bytes: buf, mime };
}

/**
 * Convert an image attachment into an inline base64 data URL the model can
 * read without a public fetch. Vision providers download a remote `image_url`
 * to count tokens, so a `/uploads/...` path on localhost (or a private bucket
 * in prod) makes them fail with `count_token_failed`. Inlining the bytes
 * removes that dependency entirely — works in dev and prod.
 */
async function toDataUrl(
  attachment: { url: string; key?: string },
  trustedHosts: Set<string>
): Promise<string> {
  const { bytes, mime } = await readAttachmentBytes(attachment, trustedHosts, {
    fallbackMime: 'image/png',
  });
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * Read a document attachment, parse it into plain text via the doc-library
 * parser (PDF / DOCX / XLSX / PPTX / MD / TXT / CSV), and return the text
 * trimmed to `MAX_DOC_CHARS`. Errors are swallowed and surfaced as a short
 * "[Could not read …]" note so the model still gets the user's question and
 * the filename, rather than the whole request blowing up.
 */
async function loadDocumentText(
  doc: Attachment,
  trustedHosts: Set<string>
): Promise<string> {
  const label = doc.filename || 'document';
  try {
    const { bytes, mime } = await readAttachmentBytes(doc, trustedHosts, {
      fallbackMime:
        MIME_FROM_EXT_DOC[(label.split('.').pop() || '').toLowerCase()] ||
        'application/octet-stream',
    });
    const parsed = await parseDocument({
      buffer: bytes,
      mimeType: mime,
      filename: label,
    });
    const text =
      parsed.text.length > MAX_DOC_CHARS
        ? `${parsed.text.slice(0, MAX_DOC_CHARS)}\n\n[...truncated — document exceeds the per-attachment ${MAX_DOC_CHARS.toLocaleString()}-character limit...]`
        : parsed.text;
    const notice = parsed.truncated
      ? `\n\n[Note: original document was truncated by the parser as well.]`
      : '';
    return `--- Begin document: ${label} ---\n${text}\n--- End document: ${label} ---${notice}`;
  } catch (e: any) {
    return `[Could not read attached document "${label}": ${e?.message || 'parse failed'}]`;
  }
}

/**
 * Compose the message list. The last user turn becomes multimodal when images
 * are attached; videos are noted in text (the model can't ingest video);
 * documents are parsed and their text is inlined so the model can actually
 * read them. Returns the model to use — a configured vision model when
 * images are present.
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
  // Parse and inline every document's text in parallel so a stack of large
  // attachments doesn't serialize the request.
  if (documents.length > 0) {
    const docTexts = await Promise.all(
      documents.map((d) => loadDocumentText(d, trustedHosts))
    );
    for (const t of docTexts) textBits.push(t);
  }
  parts.push({ type: 'text', text: textBits.join('\n\n') || ' ' });
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: await toDataUrl(img, trustedHosts) },
    });
  }

  const messages = turns.slice();
  messages[lastUserIdx] = { role: 'user', content: parts };
  return { messages, model };
}

/**
 * Signed-in chat gate — pure READ, no credit consumption.
 *
 * We split the gate check from the actual debit (consumeMessage) so that a
 * transient failure (race, stale state, network blip) never causes a credit
 * to be charged AND the user to be told "out of credits" simultaneously.
 *
 * Two ways the user has access:
 *   1. Active subscription with remaining quota (per-month, not per-credit)
 *   2. Any positive credit balance (consumed at request time, in the stream)
 */
async function checkChatAccess(
  userId: string
): Promise<'ok' | 'payment_required'> {
  const quota = await getRemainingQuota(userId);
  if (quota.remaining > 0) return 'ok';

  const balance = await getBalance(userId);
  if (balance > 0) return 'ok';

  return 'payment_required';
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
          (a.type === 'image' || a.type === 'video' || a.type === 'document') &&
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
  }
  // NOTE: For SIGNED-IN users we no longer pre-check the balance. We always
  // proceed to the stream and let `consumeMessage` decide — if it fails
  // mid-stream (insufficient credits, race with another tab, …) we emit a
  // `gate` event so the client shows the upgrade modal. This removes the
  // historical "user has credits, gate blocks them anyway" failure mode
  // where the gate read and the stream consume saw different balance
  // snapshots.

  if (gate) {
    return sseResponse(async (emit) => {
      emit({ t: 'gate', status: gate });
      emit({ t: 'done' });
    });
  }

  return sseResponse(
    async (emit) => {
      try {
        // ── Per-token billing ──
        // Two-phase: pre-flight estimate (charge upfront so a race with
        // another tab doesn't accidentally stream a request the user can't
        // pay for), post-flight actual (refund the difference if the model
        // returned fewer tokens than estimated).
        //
        // The debit intentionally happens AFTER buildMessages + the
        // long-context guard so we don't charge for requests that get
        // rejected downstream (doc parse failures, 200k+ token past grace).
        const trustedHosts = await getTrustedStorageHosts();
        const { messages, model } = await buildMessages(
          turns,
          rawAttachments,
          cfg,
          trustedHosts
        );
        const fullMessages: ChatTurn[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ];

        // Long-context guard. Only enforced for signed-in users (anon path
        // is already capped at MAX_CONTENT_LEN * MAX_TURNS above, well below
        // the threshold). Long pastes / huge attachments need a subscription.
        if (session?.user) {
          const tierCheck = await checkLongContextAllowed({
            userId: session.user.id,
            messages: fullMessages,
          });
          if (!tierCheck.allowed) {
            emit({
              t: 'error',
              message:
                'subscription_required: this message exceeds the long-context limit. Subscribe to send large prompts.',
            });
            emit({ t: 'done' });
            return;
          }
        }

        // Pre-flight estimate → upfront debit. Subscription quota path
        // ignores cost (1 quota slot per call, by design — see consumeMessage).
        // Credit path uses per-token math from admin-configurable rate/min.
        let chargeCtx:
          | { via: 'quota' }
          | { via: 'credits'; consumeId: string; originalCost: number }
          | null = null;
        if (session?.user) {
          const rateRaw = await getConfig('chat_credit_per_1k_tokens');
          const rate = Number.parseFloat(rateRaw || '0.05');
          const minRaw = await getConfig('chat_credit_min_per_call');
          const minCost = Number.parseInt(minRaw || '1', 10) || 1;

          const estimatedTokens = estimateMessagesTokens(fullMessages);
          const estimatedCost = Math.max(
            minCost,
            Math.ceil(
              (estimatedTokens / 1000) *
                (Number.isFinite(rate) && rate > 0 ? rate : 0.05)
            )
          );

          const debit = await consumeMessage(session.user.id, {
            cost: estimatedCost,
            scene: 'playground_chat',
            description: `Playground chat · ${estimatedTokens} tok (est.)`,
          });
          if (!debit.success) {
            emit({ t: 'gate', status: 'payment_required' });
            emit({ t: 'done' });
            return;
          }
          if (debit.via === 'credits' && debit.result?.consumedCredit?.id) {
            chargeCtx = {
              via: 'credits',
              consumeId: debit.result.consumedCredit.id,
              originalCost: estimatedCost,
            };
          } else {
            chargeCtx = { via: 'quota' };
          }
        }

        // Stream + collect actual usage for the refund pass.
        let actualUsage: ChatCompletionUsage | undefined;
        try {
          for await (const chunk of openaiChatCompletionStream({
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            model,
            messages: fullMessages,
          })) {
            if (typeof chunk === 'string') {
              if (chunk) emit({ t: 'delta', text: chunk });
            } else {
              actualUsage = chunk.usage;
            }
          }
        } catch (streamErr) {
          // Stream failed mid-flight — keep the charge (user got partial
          // output) and surface the error.
          emit({
            t: 'error',
            message: (streamErr as Error)?.message || 'Stream interrupted',
          });
          emit({ t: 'done' });
          return;
        }

        emit({ t: 'done', model, provider: cfg.provider });

        // Post-flight refund: only when we (a) charged via credits (not
        // subscription quota), (b) the provider returned real usage, and
        // (c) actual cost < estimated cost. We never surcharge post-flight.
        if (
          chargeCtx?.via === 'credits' &&
          actualUsage &&
          actualUsage.total_tokens > 0
        ) {
          const rateRaw = await getConfig('chat_credit_per_1k_tokens');
          const rate = Number.parseFloat(rateRaw || '0.05');
          const minRaw = await getConfig('chat_credit_min_per_call');
          const minCost = Number.parseInt(minRaw || '1', 10) || 1;

          const actualCost = Math.max(
            minCost,
            Math.ceil(
              (actualUsage.total_tokens / 1000) *
                (Number.isFinite(rate) && rate > 0 ? rate : 0.05)
            )
          );

          if (actualCost < chargeCtx.originalCost) {
            // Fire and forget — failures are logged inside refundConsume.
            void refundConsume({
              consumeId: chargeCtx.consumeId,
              userId: session.user.id,
              originalCost: chargeCtx.originalCost,
              keepAmount: actualCost,
            });
          }
        }
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
