/**
 * Free-tier chat quota — the DB-backed daily allowance behind the free chat
 * models (see FREE_CHAT_MODEL_IDS in `@/lib/chat-billing`).
 *
 * Why DB-backed when `@/lib/rate-limit` already has counters: those are
 * in-memory per-process Maps that reset on every deploy/restart. A free tier
 * that resets when the server does is an open invitation to scripted abuse —
 * one restart (or a second instance) and the allowance is fresh again. These
 * rows survive restarts, work across instances, and double as the audit
 * trail for free-tier usage.
 *
 * The day key is the calendar date at UTC+8, so the allowance resets at
 * Beijing midnight — matching the audience of this deployment.
 */

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { chatFreeQuota } from '@/config/db/schema';
import { getConfig } from '@/modules/config/service';
import { getUuid } from '@/lib/hash';

const DEFAULT_DAILY_LIMIT = 30;

export interface FreeQuotaResult {
  /** Whether this message may proceed. */
  allowed: boolean;
  /** Messages consumed today, including the one being attempted. */
  count: number;
  /** Configured daily limit. */
  limit: number;
  /** Allowance left after this attempt (never negative). */
  remaining: number;
}

/** Master kill-switch — flipping `free_chat_enabled` off in the admin panel
 * routes free-tier requests back to the normal credit gates. */
export async function isFreeChatEnabled(): Promise<boolean> {
  return (await getConfig('free_chat_enabled')) !== 'false';
}

/** 'YYYY-MM-DD' for right now in Asia/Shanghai (UTC+8), fixed-offset. */
export function getBeijingDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

async function readDailyLimit(): Promise<number> {
  const raw = await getConfig('free_chat_daily_limit');
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

/**
 * Atomically debit one free-tier message. The upsert increments (and creates
 * on first use) in a single statement, so two concurrent tabs can never both
 * read "29 used" and slip past the limit. When the attempt is rejected the
 * counter still increments — the overshoot is harmless (the row is per-day)
 * and keeps the audit trail honest about how hard the limit was hit.
 */
export async function consumeFreeChatQuota(
  userId: string
): Promise<FreeQuotaResult> {
  const limit = await readDailyLimit();
  const day = getBeijingDayKey();

  const [row] = await db()
    .insert(chatFreeQuota)
    .values({ id: getUuid(), userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [chatFreeQuota.userId, chatFreeQuota.day],
      set: {
        count: sql`${chatFreeQuota.count} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
  };
}

/** Read-only view of today's allowance (for UI affordances). */
export async function getFreeChatQuota(
  userId: string
): Promise<Omit<FreeQuotaResult, 'allowed'>> {
  const limit = await readDailyLimit();
  const day = getBeijingDayKey();
  const rows = await db()
    .select({ count: chatFreeQuota.count })
    .from(chatFreeQuota)
    .where(and(eq(chatFreeQuota.userId, userId), eq(chatFreeQuota.day, day)))
    .limit(1);
  const count = rows[0]?.count ?? 0;
  return { count, limit, remaining: Math.max(0, limit - count) };
}
