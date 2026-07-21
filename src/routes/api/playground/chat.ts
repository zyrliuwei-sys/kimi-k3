import { createFileRoute } from '@tanstack/react-router';

import {
  openaiChatCompletionStream,
  type ChatContentPart,
  type ChatTurn,
} from '@/core/ai/chat';
import { getAuth } from '@/core/auth';
import { envConfigs } from '@/config';
import { getConfig } from '@/modules/config/service';
import { consume as consumeCredits } from '@/modules/credits/service';
import { checkIpQuota, enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

/**
 * Stateless "API Playground" chat endpoint — **streaming** (SSE).
 *
 * Rate-limited per IP and gated freemium-style: anonymous visitors get a small
 * number of free messages (`ANON_FREE_LIMIT`) then a sign-up wall; signed-in
 * users spend 1 credit per message (`CHAT_CREDIT_COST`) then a paywall.
 * Conversations are NOT persisted here — that's what /api/chat is for. Prefer
 * the configured `evolink` provider (model defaults to `kimi-k3`) when its key
 * is present.
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
// Freemium gate: anonymous visitors get this many free messages (per
// browser/IP), then hit a sign-up wall. Signed-in users pay 1 credit per
// message via the credits module (free taste = their signup credit grant).
const ANON_FREE_LIMIT = 2;
const CHAT_CREDIT_COST = 1;

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
  type: 'image' | 'video';
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

/** Build a `text/event-stream` Response that runs `work`, emitting frames. */
function sseResponse(work: (emit: SseEmit) => Promise<void>): Response {
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
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Resolve a possibly-relative upload URL to an absolute one the model can fetch. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (envConfigs.app_url || '').replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Compose the message list. The last user turn becomes multimodal when images
 * are attached; videos are noted in text (the model can't ingest video).
 * Returns the model to use — a configured vision model when images are present.
 */
async function buildMessages(
  turns: ChatTurn[],
  attachments: Attachment[],
  cfg: PlaygroundConfig
): Promise<{ messages: ChatTurn[]; model: string }> {
  const images = attachments.filter((a) => a.type === 'image');
  const videos = attachments.filter((a) => a.type === 'video');

  let model = cfg.model;
  if (images.length > 0) {
    const vision =
      (await getConfig('evolink_vision_model')) ||
      (await getConfig('openai_vision_model')) ||
      '';
    if (vision) model = vision;
  }

  if (images.length === 0 && videos.length === 0) {
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
  parts.push({ type: 'text', text: textBits.join('\n\n') || ' ' });
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: absoluteUrl(img.url) } });
  }

  const messages = turns.slice();
  messages[lastUserIdx] = { role: 'user', content: parts };
  return { messages, model };
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

  // --- Freemium gate (only enforced when a live model is configured) ---
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });

  let gate: 'login_required' | 'payment_required' | null = null;
  if (!session?.user) {
    const quota = checkIpQuota(request, {
      keyPrefix: 'hero-chat-anon',
      limit: ANON_FREE_LIMIT,
    });
    if (quota.exceeded) gate = 'login_required';
  } else {
    const consumed = await consumeCredits({
      userId: session.user.id,
      credits: CHAT_CREDIT_COST,
      scene: 'hero_chat',
      description: 'Hero chat · Kimi K3',
    });
    if (!consumed.success) gate = 'payment_required';
  }

  if (gate) {
    return sseResponse(async (emit) => {
      emit({ t: 'gate', status: gate });
      emit({ t: 'done' });
    });
  }

  const { messages, model } = await buildMessages(turns, rawAttachments, cfg);

  return sseResponse(async (emit) => {
    try {
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
  });
}

export const Route = createFileRoute('/api/playground/chat')({
  server: { handlers: { POST } },
});
