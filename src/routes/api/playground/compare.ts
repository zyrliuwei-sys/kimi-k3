import { createFileRoute } from '@tanstack/react-router';

import {
  openaiChatCompletionStream,
  type ChatCompletionUsage,
  type ChatTurn,
} from '@/core/ai/chat';
import { checkLongContextAllowed } from '@/core/ai/tier-pricing';
import { estimateMessagesTokens } from '@/core/ai/token-estimate';
import { getAuth } from '@/core/auth';
import {
  consumeFreeChatQuota,
  isFreeChatEnabled,
} from '@/modules/free-chat-quota/service';
import { settleConsume } from '@/modules/subscription-quota/refund';
import { consumeMessage } from '@/modules/subscription-quota/service';
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
  getSystemPrompt,
  NOT_CONFIGURED_REPLY,
  resolvePlaygroundConfig,
  sseResponse,
  type PlaygroundConfig,
  type SseEmit,
} from './-shared';

/**
 * Stateless side-by-side model comparison endpoint — **streaming** (SSE).
 *
 * One request fans out to N models (1–4) in parallel, so the 2s-per-request
 * min-interval limiter on `/api/playground/chat` can't 429 columns 2..N of a
 * comparison. Every frame carries the column index `c` the client fanned out:
 *
 *   data: {"t":"delta","c":0,"text":"…"}   — incremental reply for column c
 *   data: {"t":"gate","c":2,"status":"payment_required"}
 *   data: {"t":"error","c":1,"message":"…"}
 *   data: {"t":"done","c":0,"model":"…","provider":"…"}
 *   data: {"t":"end"}                      — all columns finished
 *
 * Each column is an INDEPENDENT conversation: the client sends that column's
 * own prior turns, and follow-ups must include the model's own earlier
 * answers (LORKA-style side-by-side semantics). Nothing is persisted — same
 * contract as `/api/playground/chat`, which this mirrors for billing:
 * free models burn the daily free quota, paid models reserve credits
 * pre-flight (scene `compare_chat`, one reservation PER COLUMN) and settle
 * to actual usage post-flight. A column that can't pay is gated alone; the
 * other columns keep streaming.
 */

const MAX_COLUMNS = 4;
const MAX_TURNS = 20;
const MAX_CONTENT_LEN = 4000;
// One comparison costs N× a single message, so give the anti-spam interval a
// little more headroom than the single-model endpoint. The real cost ceiling
// remains the per-column credit/quota gate.
const RATE_LIMIT_INTERVAL_MS = 3000;

// Columns reserve CONCURRENTLY (Promise.all below), so holding each premium
// column's full 4096-token output budget would demand the SUM of all ceilings
// as liquid balance — ~50 credits per column, while an actual compare turn
// costs ~5. A user with a healthy balance then gets a bogus `payment_required`
// on columns 2..N of the first fan-out (observed: 95-cr balance, GPT-5.6 held
// 54 → Opus's 48 hold bounced). Hold a realistic output budget instead; the
// post-flight settle surcharges the rare full-length answer (bounded exposure,
// same contract as the refund-path surcharge — see subscription-quota/refund).
const COMPARE_RESERVE_OUTPUT_TOKENS = 1024;

interface CompareColumn {
  /** Model id as sent by the client (already allowlist-validated). */
  requestedModel: string;
  /** Sanitized conversation history; last turn is always the new user turn. */
  turns: ChatTurn[];
}

async function POST({ request }: { request: Request }) {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: RATE_LIMIT_INTERVAL_MS,
    keyPrefix: 'playground-compare',
  });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const rawColumns: any[] = Array.isArray(body?.columns) ? body.columns : [];
  if (rawColumns.length < 1 || rawColumns.length > MAX_COLUMNS) {
    return respErr(`Compare requires between 1 and ${MAX_COLUMNS} columns`);
  }

  const columns: CompareColumn[] = [];
  for (const col of rawColumns) {
    const requestedModel = getChatModelId(col?.model);
    if (col?.model !== undefined && !requestedModel) {
      return respErr('Unsupported chat model');
    }

    const raw = Array.isArray(col?.messages) ? col.messages : [];
    const history: ChatTurn[] = [];
    for (const msg of raw) {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
      const content = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!content || content.length > MAX_CONTENT_LEN) continue;
      history.push({ role: msg.role, content });
    }

    const turns = history.slice(-MAX_TURNS);
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      return respErr('A user message is required in every column');
    }

    columns.push({
      requestedModel: requestedModel ?? DEFAULT_CHAT_MODEL_ID,
      turns,
    });
  }

  const cfg = await resolvePlaygroundConfig();
  if (!cfg.hasKey) {
    return sseResponse(async (emit) => {
      for (let c = 0; c < columns.length; c++) {
        emit({ t: 'delta', c, text: NOT_CONFIGURED_REPLY });
        emit({
          t: 'done',
          c,
          model: columns[c].requestedModel,
          provider: 'unconfigured',
        });
      }
      emit({ t: 'end' });
    });
  }

  // Same provider semantics as the single-model endpoint: the selectable ids
  // are the server-owned EvoLink allowlist; the legacy OpenAI-compatible
  // fallback ignores the selector and uses the configured model.
  const modelFor = (requested: string) =>
    cfg.provider === 'evolink'
      ? requested
      : getChatModelId(cfg.model) || requested;

  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return sseResponse(async (emit) => {
      emit({ t: 'gate', status: 'login_required' });
      emit({ t: 'end' });
    });
  }

  return sseResponse(async (emit) => {
    // A client abort closes the controller; enqueue then throws. Wrap it so a
    // cancelled stream kills the column's upstream loop (the throw escapes the
    // for-await) instead of crashing the settle logic that must still run.
    const safeEmit: SseEmit = (obj) => {
      try {
        emit(obj);
      } catch {}
    };
    await Promise.all(
      columns.map((col, c) =>
        runColumn(
          safeEmit,
          c,
          session.user.id,
          cfg,
          modelFor(col.requestedModel),
          col.turns
        )
      )
    );
    safeEmit({ t: 'end' });
  });
}

/**
 * Stream one column: pre-flight guards → billing reservation → provider
 * stream → settle to actual usage. Never rejects; every failure path emits a
 * per-column frame and returns.
 */
async function runColumn(
  emit: SseEmit,
  c: number,
  userId: string,
  cfg: PlaygroundConfig,
  model: string,
  turns: ChatTurn[]
): Promise<void> {
  const billingModel = getChatModelId(model) ?? 'kimi-k3';
  try {
    const fullMessages: ChatTurn[] = [
      { role: 'system', content: getSystemPrompt(model) },
      ...turns,
    ];
    const estimatedInputTokens = estimateMessagesTokens(fullMessages);
    const modelBudgetError = getChatModelInputBudgetError({
      model: billingModel,
      estimatedInputTokens,
    });
    if (modelBudgetError) {
      emit({ t: 'error', c, message: modelBudgetError });
      return;
    }

    const tierCheck = await checkLongContextAllowed({
      userId,
      messages: fullMessages,
    });
    if (!tierCheck.allowed) {
      emit({
        t: 'error',
        c,
        message:
          'subscription_required: this message exceeds the long-context limit. Subscribe to send large prompts.',
      });
      return;
    }

    // ── Per-token billing (mirrors /api/playground/chat, per column) ──
    let chargeCtx:
      | { via: 'quota' }
      | {
          via: 'credits';
          consumeId: string;
          originalCost: number;
          rates: ChatTokenRates;
        }
      | null = null;
    if (isFreeChatModel(billingModel) && (await isFreeChatEnabled())) {
      const quota = await consumeFreeChatQuota(userId);
      if (!quota.allowed) {
        emit({ t: 'gate', c, status: 'free_limit_reached' });
        return;
      }
    } else {
      const rates = await getChatTokenRates(billingModel);
      const estimatedCost = computeChatReservationCost({
        model: billingModel,
        estimatedInputTokens,
        rates,
        outputBudgetTokens: COMPARE_RESERVE_OUTPUT_TOKENS,
      });

      const debit = await consumeMessage(userId, {
        cost: estimatedCost,
        scene: 'compare_chat',
        description: `Compare chat · ${billingModel} · ~${estimatedInputTokens} in tok (est.)`,
        allowSubscriptionQuota: !isPremiumChatModel(billingModel),
      });
      if (!debit.success) {
        emit({ t: 'gate', c, status: 'payment_required' });
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
        model,
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
            emit({ t: 'delta', c, text: chunk });
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
            ...(isPremiumChatModel(billingModel)
              ? { cache_write_tokens: estimatedInputTokens }
              : {}),
          },
          chargeCtx.rates
        );
        void settleConsume({
          consumeId: chargeCtx.consumeId,
          userId,
          originalCost: chargeCtx.originalCost,
          finalAmount: partialCost,
        });
      }
      emit({
        t: 'error',
        c,
        message: (streamErr as Error)?.message || 'Stream interrupted',
      });
      return;
    }

    emit({ t: 'done', c, model, provider: cfg.provider });

    // Post-flight settle to ACTUAL usage (input + output, split rates).
    // Fire-and-forget — settleConsume logs its own failures.
    if (
      chargeCtx?.via === 'credits' &&
      actualUsage &&
      actualUsage.total_tokens > 0
    ) {
      const finalCost = computeUsageTokenCost(actualUsage, chargeCtx.rates);
      void settleConsume({
        consumeId: chargeCtx.consumeId,
        userId,
        originalCost: chargeCtx.originalCost,
        finalAmount: finalCost,
      });
    }
  } catch (e: any) {
    emit({ t: 'error', c, message: e?.message || 'Generation failed' });
  }
}

export const Route = createFileRoute('/api/playground/compare')({
  server: { handlers: { POST } },
});
