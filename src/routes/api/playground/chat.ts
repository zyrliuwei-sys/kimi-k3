import { createFileRoute } from '@tanstack/react-router';

import {
  openaiChatCompletionStream,
  type ChatCompletionUsage,
  type ChatTurn,
} from '@/core/ai/chat';
import { checkLongContextAllowed } from '@/core/ai/tier-pricing';
import { estimateMessagesTokens } from '@/core/ai/token-estimate';
import { getAuth } from '@/core/auth';
import { getBalance } from '@/modules/credits/service';
import {
  consumeFreeChatQuota,
  isFreeChatEnabled,
} from '@/modules/free-chat-quota/service';
import { settleConsume } from '@/modules/subscription-quota/refund';
import {
  consumeMessage,
  getRemainingQuota,
} from '@/modules/subscription-quota/service';
import {
  computeChatReservationCost,
  computeUsageTokenCost,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelId,
  getChatModelInputBudgetError,
  getChatModelMaxOutputTokens,
  getChatTokenRates,
  isFreeChatModel,
  isPremiumChatModel,
  type ChatTokenRates,
} from '@/lib/chat-billing';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

import {
  buildMessages,
  getSystemPrompt,
  getTrustedStorageHosts,
  NOT_CONFIGURED_REPLY,
  resolvePlaygroundConfig,
  sanitizePlaygroundAttachments,
  sseResponse,
  type PlaygroundAttachment,
} from './-shared';

/**
 * Stateless "API Playground" chat endpoint — **streaming** (SSE).
 *
 * Access tiers (in order):
 *   1. Anonymous visitor → `login_required` gate (must sign up / log in).
 *      No free tier — every call costs real API money.
 *   2. Signed-in user with subscription quota or paid credits → allowed
 *      (`consumeMessage` debits).
 *   3. Signed-in user with neither → `payment_required` gate.
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
 * attachments (PDF / DOCX / XLSX / PPTX / Pages / Numbers / MD / TXT / CSV)
 * are fetched, parsed into plain text, and inlined into the user turn so the
 * model can read them;
 * videos are display-only and surfaced to the model as a text note.
 */

const MAX_TURNS = 20;
const MAX_CONTENT_LEN = 4000;
// 2s between messages — feels like a real conversation without opening the
// floodgates. The hard cost ceiling is the credit/quota gate downstream
// (signed-in: consumeMessage debits; anon: login_required),
// so this is just an anti-click-spam guard, not an anti-abuse wall.
const RATE_LIMIT_INTERVAL_MS = 2000;
// Signed-in users: subscription quota first, then credit balance fallback.
// No free tier — 0 subscription quota + 0 credits = paywall.

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

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: RATE_LIMIT_INTERVAL_MS,
    keyPrefix: 'playground-chat',
  });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const requestedModel = getChatModelId(body?.model);
  if (body?.model !== undefined && !requestedModel) {
    return respErr('Unsupported chat model');
  }
  const rawAttachments: PlaygroundAttachment[] = sanitizePlaygroundAttachments(
    body?.attachments
  );

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
  // The product chat only exposes a small, server-owned EvoLink allowlist.
  // Leave the legacy OpenAI-compatible fallback untouched when EvoLink is not
  // configured: the configured fallback model wins over a selector value.
  if (!cfg.hasKey) {
    const setupModel = requestedModel ?? DEFAULT_CHAT_MODEL_ID;
    return sseResponse(async (emit) => {
      emit({ t: 'delta', text: NOT_CONFIGURED_REPLY });
      emit({ t: 'done', model: setupModel, provider: 'unconfigured' });
    });
  }
  const model =
    cfg.provider === 'evolink'
      ? (requestedModel ?? getChatModelId(cfg.model))
      : cfg.model;
  if (!model) {
    return respErr(
      'Configure evolink_model as kimi-k3, gpt-5.6-sol, or claude-opus-4-8'
    );
  }
  const billingModel = getChatModelId(model) ?? 'kimi-k3';

  // --- Access gate (only enforced when a live model is configured) ---
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });

  // Anonymous visitors must sign in — no free tier. Every call costs real
  // API money, so we gate before streaming rather than eating the cost.
  let gate: 'login_required' | 'payment_required' | null = null;
  if (!session?.user) {
    gate = 'login_required';
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

  return sseResponse(async (emit) => {
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
      const { messages, model: resolvedModel } = await buildMessages(
        turns,
        rawAttachments,
        model,
        trustedHosts
      );
      const fullMessages: ChatTurn[] = [
        { role: 'system', content: getSystemPrompt(resolvedModel) },
        ...messages,
      ];
      const estimatedInputTokens = estimateMessagesTokens(fullMessages);
      const modelBudgetError = getChatModelInputBudgetError({
        model: billingModel,
        estimatedInputTokens,
      });
      if (modelBudgetError) {
        emit({ t: 'error', message: modelBudgetError });
        emit({ t: 'done' });
        return;
      }

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

      // Pre-flight reservation on ESTIMATED INPUT tokens. This guarantees
      // the user can cover at least the prompt before we call the model —
      // a drained balance is rejected here (payment_required), NOT
      // mid-stream, so the admin never pays for a request the user can't
      // afford. The real input+output cost is settled post-flight.
      // Subscription quota path ignores cost (1 quota slot per call).
      let chargeCtx:
        | { via: 'quota' }
        | {
            via: 'credits';
            consumeId: string;
            originalCost: number;
            rates: ChatTokenRates;
          }
        | null = null;
      if (
        session?.user &&
        isFreeChatModel(billingModel) &&
        (await isFreeChatEnabled())
      ) {
        // Free-tier models: no credits, no subscription slot — a DB-backed
        // daily message quota is the entire gate. Exhausted quota opens the
        // same checkout panel as credit exhaustion (upsell, not a dead end).
        const quota = await consumeFreeChatQuota(session.user.id);
        if (!quota.allowed) {
          emit({ t: 'gate', status: 'free_limit_reached' });
          emit({ t: 'done' });
          return;
        }
      } else if (session?.user) {
        const rates = await getChatTokenRates(billingModel);
        // Premium models reserve a bounded output budget before contacting the
        // provider. Kimi keeps its existing input-only reservation behavior.
        const estimatedCost = computeChatReservationCost({
          model: billingModel,
          estimatedInputTokens,
          rates,
        });

        const debit = await consumeMessage(session.user.id, {
          cost: estimatedCost,
          scene: 'playground_chat',
          description: `Playground chat · ${billingModel} · ~${estimatedInputTokens} in tok (est.)`,
          allowSubscriptionQuota: !isPremiumChatModel(billingModel),
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
            rates,
          };
        } else {
          chargeCtx = { via: 'quota' };
        }
      }

      // Stream + collect actual usage for the refund pass.
      let actualUsage: ChatCompletionUsage | undefined;
      let streamedText = '';
      try {
        for await (const chunk of openaiChatCompletionStream({
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: resolvedModel,
          messages: fullMessages,
          includeTemperature: !isPremiumChatModel(billingModel),
          maxCompletionTokens: getChatModelMaxOutputTokens(billingModel),
          maxCompletionTokenField:
            billingModel === 'gpt-5.6-sol'
              ? 'max_completion_tokens'
              : 'max_tokens',
        })) {
          if (typeof chunk === 'string') {
            if (chunk) {
              streamedText += chunk;
              emit({ t: 'delta', text: chunk });
            }
          } else {
            actualUsage = chunk.usage;
          }
        }
      } catch (streamErr) {
        // Return the unused premium reservation on a failed stream. We only
        // retain a conservative estimate for visible partial output.
        if (chargeCtx?.via === 'credits') {
          const partialCost = computeUsageTokenCost(
            {
              prompt_tokens: estimatedInputTokens,
              completion_tokens: estimateMessagesTokens([
                { role: 'assistant', content: streamedText },
              ]),
              // Without a provider usage frame, retain enough of a premium
              // reservation to cover a cache-write prompt that reached the
              // gateway before it failed.
              ...(isPremiumChatModel(billingModel)
                ? { cache_write_tokens: estimatedInputTokens }
                : {}),
            },
            chargeCtx.rates
          );
          void settleConsume({
            consumeId: chargeCtx.consumeId,
            userId: session.user.id,
            originalCost: chargeCtx.originalCost,
            finalAmount: partialCost,
          });
        }
        emit({
          t: 'error',
          message: (streamErr as Error)?.message || 'Stream interrupted',
        });
        emit({ t: 'done' });
        return;
      }

      emit({ t: 'done', model: resolvedModel, provider: cfg.provider });

      // Post-flight settle to ACTUAL usage (input + output, split rates).
      // Two-way: surcharge when the reply ran longer than the input-only
      // reservation, refund when shorter. Subscription quota path is
      // skipped (flat per call). Fire-and-forget — settleConsume logs its
      // own failures.
      if (
        chargeCtx?.via === 'credits' &&
        actualUsage &&
        actualUsage.total_tokens > 0
      ) {
        const finalCost = computeUsageTokenCost(actualUsage, chargeCtx.rates);
        void settleConsume({
          consumeId: chargeCtx.consumeId,
          userId: session.user.id,
          originalCost: chargeCtx.originalCost,
          finalAmount: finalCost,
        });
      }
    } catch (e: any) {
      emit({ t: 'error', message: e?.message || 'Generation failed' });
      emit({ t: 'done' });
    }
  });
}

export const Route = createFileRoute('/api/playground/chat')({
  server: { handlers: { POST } },
});
