import { createFileRoute } from '@tanstack/react-router';

import { openaiChatCompletion, type ChatTurn } from '@/core/ai/chat';
import { getAuth } from '@/core/auth';
import { getConfig } from '@/modules/config/service';
import { consume as consumeCredits } from '@/modules/credits/service';
import { checkIpQuota, enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

/**
 * Stateless "API Playground" chat endpoint.
 *
 * Rate-limited per IP and gated freemium-style: anonymous visitors get a small
 * number of free messages (`ANON_FREE_LIMIT`) then a sign-up wall; signed-in
 * users spend 1 credit per message (`CHAT_CREDIT_COST`) then a paywall.
 * Conversations are NOT persisted here — that's what /api/chat is for. Prefer
 * the configured `evolink` provider (model defaults to `kimi-k3`) when its key
 * is present, so an admin who only pasted the key still gets a working Kimi K3
 * response. Responses carry a `status`: 'ok' | 'login_required' |
 * 'payment_required' | 'unconfigured'.
 */

const MAX_TURNS = 20;
const MAX_CONTENT_LEN = 4000;
const RATE_LIMIT_INTERVAL_MS = 6000;
// Freemium gate: anonymous visitors get this many free messages (per
// browser/IP), then hit a sign-up wall. Signed-in users pay 1 credit per
// message via the credits module (free taste = their signup credit grant).
const ANON_FREE_LIMIT = 1;
const CHAT_CREDIT_COST = 1;

const SYSTEM_PROMPT =
  'You are kimik3, a friendly, knowledgeable assistant powered by Kimi K3. You help people think, write, research, and build. Be concise, warm, and practical. Use Markdown when it improves clarity.';

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

async function POST({ request }: { request: Request }) {
  try {
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: RATE_LIMIT_INTERVAL_MS,
      keyPrefix: 'playground-chat',
    });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body?.messages) ? body.messages : [];

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
      return respData({
        status: 'unconfigured',
        reply: NOT_CONFIGURED_REPLY,
        model: 'kimi-k3',
        provider: 'unconfigured',
        configured: false,
      });
    }

    // --- Freemium gate (only enforced when a live model is configured) ---
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      // Anonymous: limited free messages per browser/IP, then a sign-up wall.
      const quota = checkIpQuota(request, {
        keyPrefix: 'hero-chat-anon',
        limit: ANON_FREE_LIMIT,
      });
      if (quota.exceeded) {
        return respData({
          status: 'login_required',
          reply: null,
          configured: true,
        });
      }
    } else {
      // Signed-in: each message costs 1 credit; no balance → paywall.
      const consumed = await consumeCredits({
        userId: session.user.id,
        credits: CHAT_CREDIT_COST,
        scene: 'hero_chat',
        description: 'Hero chat · Kimi K3',
      });
      if (!consumed.success) {
        return respData({
          status: 'payment_required',
          reply: null,
          configured: true,
        });
      }
    }

    const reply = await openaiChatCompletion({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...turns],
    });

    return respData({
      status: 'ok',
      reply,
      model: cfg.model,
      provider: cfg.provider,
      configured: true,
    });
  } catch (error: any) {
    return respErr(error?.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/playground/chat')({
  server: { handlers: { POST } },
});
