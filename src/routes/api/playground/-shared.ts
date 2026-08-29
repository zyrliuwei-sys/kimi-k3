import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChatContentPart, ChatTurn } from '@/core/ai/chat';
import { getConfig } from '@/modules/config/service';
import { parseDocument } from '@/modules/doc-library/parser';
import { getStorage } from '@/modules/storage/service';
import {
  DEFAULT_CHAT_MODEL_ID,
  getChatModelDisplayName,
} from '@/lib/chat-billing';

/**
 * Shared helpers for the stateless playground endpoints (`/api/playground/chat`
 * single-model, `/api/playground/compare` multi-model fan-out). Extracted so
 * both routes resolve provider config, system prompt, SSE plumbing, and the
 * attachment pipeline (images → inline data URLs, documents → parsed text)
 * the same way instead of drifting apart.
 */

export interface PlaygroundConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export type SseEmit = (obj: Record<string, unknown>) => void;

/**
 * Resolve the model config for the playground. Prefers EvoLink when
 * its key is present, otherwise falls back to OpenAI. Same logic as
 * getChatModelConfig() in the chat service.
 */
export async function resolvePlaygroundConfig(): Promise<PlaygroundConfig> {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      provider: 'evolink',
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || DEFAULT_CHAT_MODEL_ID,
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

/** Build a `text/event-stream` Response that runs `work`, emitting frames. */
export function sseResponse(work: (emit: SseEmit) => Promise<void>): Response {
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
  return new Response(stream, { headers });
}

export function getSystemPrompt(model: string): string {
  const modelName = getChatModelDisplayName(model);
  return `You are ${modelName}, the model selected for this conversation. kimik3 is the product name, not your model identity. If asked who you are or which model is replying, identify yourself as ${modelName}; never say that you are kimik3 or that you cannot verify your model identity. Be concise, warm, and practical. Use Markdown when it improves clarity. Attached images: respond to what you see. Attached documents (PDF, Word, Excel, PPT, Apple Pages, Apple Numbers, MD, TXT, CSV): their parsed text is inlined in the user message — answer from it directly. Excel tables include a Formula column — use the formulas, not just the values. PPT slides include "Speaker notes:" — read those for intent.`;
}

export const NOT_CONFIGURED_REPLY = `👋 I'm kimik3 — but no live model is reachable yet.

An admin needs to connect one from **Admin → Settings → AI**:
1. Paste your key under the **evolink** group (\`evolink_api_key\`).
2. Set the model to **\`kimi-k3\`** (\`evolink_model\`) — or leave it blank and Kimi K3 is used by default.

Once that's in place, every message uses the selected live model.`;

// ─── Attachments (shared by chat + compare) ──────────────────────────────────

export interface PlaygroundAttachment {
  type: 'image' | 'video' | 'document';
  url: string;
  // Storage key from the upload endpoint. When storage is configured, the
  // playground re-downloads via the storage provider's signed GET (private
  // R2 buckets 401 on unauthenticated fetches). Optional so legacy clients
  // / data still work via the URL fallback.
  key?: string;
  filename?: string;
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
  pages: 'application/x-iwork-pages-sffpages',
  numbers: 'application/x-iwork-numbers-sffnumbers',
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

/** Keep only well-formed attachment entries from an untyped request body. */
export function sanitizePlaygroundAttachments(
  raw: unknown
): PlaygroundAttachment[] {
  return Array.isArray(raw)
    ? raw.filter(
        (a: any): a is PlaygroundAttachment =>
          a &&
          (a.type === 'image' || a.type === 'video' || a.type === 'document') &&
          typeof a.url === 'string'
      )
    : [];
}

/**
 * Trusted URL prefixes the playground is allowed to inline. Anything else
 * (arbitrary internal IPs, cloud metadata endpoints, attacker-controlled
 * hosts) must be rejected — otherwise `fetch(url)` becomes an SSRF primitive
 * and a malicious attachment leaks private file contents into the model
 * prompt. Resolved at request time so admin-managed storage hosts are picked
 * up live.
 */
export async function getTrustedStorageHosts(): Promise<Set<string>> {
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
  doc: PlaygroundAttachment,
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
 * Resolve the streaming model when images are attached. The selectable
 * premium models can process image inputs directly — preserve their exact id
 * so the selected model and the server-side billing model always stay
 * identical; only the Kimi default swaps to the configured vision model.
 */
export async function resolveVisionOverride(
  requestedModel: string
): Promise<string> {
  if (requestedModel !== 'kimi-k3') return requestedModel;
  const vision =
    (await getConfig('evolink_vision_model')) ||
    (await getConfig('openai_vision_model')) ||
    '';
  return vision || requestedModel;
}

/**
 * The model-independent, potentially expensive half of attachment handling:
 * video notes + parsed document text + inline image data URLs. Prepared once
 * per request so a multi-column fan-out never re-fetches / re-parses the
 * same files N times.
 */
export interface PreparedAttachmentMedia {
  /** Text notes appended to the user's turn (video markers, document text). */
  textBits: string[];
  /** Inline base64 data URLs for image attachments. */
  imageDataUrls: string[];
}

export async function prepareAttachmentMedia(
  attachments: PlaygroundAttachment[],
  trustedHosts: Set<string>
): Promise<PreparedAttachmentMedia> {
  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');
  const documents = attachments.filter((a) => a.type === 'document');

  const textBits: string[] = [];
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
  // Convert images to data URLs in parallel — sequential awaits here would
  // stack up the request's TTFT by N × (network + base64) latency.
  const imageDataUrls = await Promise.all(
    images.map((img) => toDataUrl(img, trustedHosts))
  );
  return { textBits, imageDataUrls };
}

/**
 * Splice prepared media into the LAST user turn of a conversation (that's
 * the one being answered) as multimodal content parts.
 */
export function attachMediaToLastUserTurn(
  turns: ChatTurn[],
  media: PreparedAttachmentMedia
): ChatTurn[] {
  if (!media.textBits.length && !media.imageDataUrls.length) return turns;

  const lastUserIdx = [...turns].reduce(
    (acc, t, i) => (t.role === 'user' ? i : acc),
    -1
  );
  if (lastUserIdx === -1) return turns;

  const lastText =
    typeof turns[lastUserIdx].content === 'string'
      ? (turns[lastUserIdx].content as string)
      : (turns[lastUserIdx].content as ChatContentPart[])
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');

  const textBits: string[] = [];
  if (lastText.trim()) textBits.push(lastText.trim());
  textBits.push(...media.textBits);

  const parts: ChatContentPart[] = [
    { type: 'text', text: textBits.join('\n\n') || ' ' },
  ];
  for (const url of media.imageDataUrls) {
    parts.push({ type: 'image_url', image_url: { url } });
  }

  const messages = turns.slice();
  messages[lastUserIdx] = { role: 'user', content: parts };
  return messages;
}

/**
 * Compose the message list for a single-model turn: attach media to the last
 * user turn and resolve the vision model override. Returns the messages to
 * send plus the model to stream with (billing stays keyed to the REQUESTED
 * model, mirroring the historical behavior of `/api/playground/chat`).
 */
export async function buildMessages(
  turns: ChatTurn[],
  attachments: PlaygroundAttachment[],
  requestedModel: string,
  trustedHosts: Set<string>
): Promise<{ messages: ChatTurn[]; model: string }> {
  if (attachments.length === 0) {
    return { messages: turns, model: requestedModel };
  }
  const model = attachments.some((a) => a.type === 'image')
    ? await resolveVisionOverride(requestedModel)
    : requestedModel;
  const media = await prepareAttachmentMedia(attachments, trustedHosts);
  return { messages: attachMediaToLastUserTurn(turns, media), model };
}
