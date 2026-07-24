/**
 * Lightweight token estimator — no model-specific tokenizer dependency.
 *
 * Provider specifics:
 *  - OpenAI / Anthropic / Kimi / most modern chat models use BPE-style
 *    tokenizers where ASCII ≈ 4 chars / token and CJK ≈ 1-1.5 chars / token.
 *  - The formula below blends ASCII and CJK counts so both work without
 *    inflating estimates for either case.
 *
 * It's an ESTIMATE — accurate within ±15% for typical prompts. We don't
 * need precision here, we need a fast gate that prevents the
 * "send 280k-token PDF and bankrupt us" failure mode before the upstream
 * API call. The provider's own `usage` field on the response is what we use
 * for actual credit bookkeeping.
 *
 * For multimodal content (image_url parts), each image is roughly
 * 765-1500 tokens at "auto"/"low" detail — we use 1000 as a conservative
 * middle. Videos can't be ingested by chat models anyway, so they don't
 * contribute.
 */

import type { ChatContentPart, ChatTurn } from './chat';

// CJK Unicode blocks (CJK Unified Ideographs + extensions + Japanese kana +
// Hangul). Counting these separately gives a tighter estimate than a single
// chars/4 heuristic.
const CJK_RE = /[　-鿿가-힯＀-￯]/g;

const TOKENS_PER_IMAGE_PART = 1000;

/** Estimate tokens for a single string. */
export function estimateStringTokens(s: string): number {
  if (!s) return 0;
  // Cheap fast-path: ASCII-only.
  // eslint-disable-next-line no-control-regex
  const isAscii = /^[\x00-\x7F]*$/.test(s);
  if (isAscii) return Math.ceil(s.length / 4);

  let cjk = 0;
  // Use match() without /g so we just need exec/replace for the count.
  const matches = s.match(CJK_RE);
  if (matches) cjk = matches.length;
  const other = s.length - cjk;
  // ~4 chars/token ASCII, ~1.5 chars/token CJK.
  return Math.ceil(other / 4 + cjk / 1.5);
}

/** Estimate tokens for a single message turn. */
export function estimateTurnTokens(turn: ChatTurn): number {
  if (typeof turn.content === 'string') {
    return estimateStringTokens(turn.content);
  }
  let total = 0;
  for (const part of turn.content) {
    if (part.type === 'text') {
      total += estimateStringTokens(part.text);
    } else if (part.type === 'image_url') {
      total += TOKENS_PER_IMAGE_PART;
    }
  }
  return total;
}

/** Estimate total input tokens for an entire message list (no role overhead). */
export function estimateMessagesTokens(messages: ChatTurn[]): number {
  let total = 0;
  for (const m of messages) total += estimateTurnTokens(m);
  // ~4 tokens per role tag — small but real overhead.
  total += messages.length * 4;
  return total;
}

/** Estimate tokens for a flat array of ChatContentPart (e.g. the last turn). */
export function estimateContentPartsTokens(parts: ChatContentPart[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.type === 'text') {
      total += estimateStringTokens(p.text);
    } else {
      total += TOKENS_PER_IMAGE_PART;
    }
  }
  return total;
}
