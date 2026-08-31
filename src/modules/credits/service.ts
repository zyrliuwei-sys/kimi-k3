import { and, asc, desc, eq, gt, isNull, ne, or, sql, sum } from 'drizzle-orm';

import { db } from '@/core/db';
import { credit } from '@/config/db/schema';
import { getSnowId, getUuid } from '@/lib/hash';

// --- Enums ---

export enum CreditStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  DELETED = 'deleted',
}

export enum CreditTransactionType {
  GRANT = 'grant',
  CONSUME = 'consume',
}

export enum CreditTransactionScene {
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
  RENEWAL = 'renewal',
  GIFT = 'gift',
  REWARD = 'reward',
}

type NewCredit = typeof credit.$inferInsert;

// --- Expiration ---

export function calculateCreditExpirationTime(params: {
  creditsValidDays: number;
  currentPeriodEnd?: Date;
}): Date | null {
  const { creditsValidDays, currentPeriodEnd } = params;

  if (!creditsValidDays || creditsValidDays <= 0) {
    return null; // never expires
  }

  if (currentPeriodEnd) {
    return new Date(currentPeriodEnd.getTime());
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + creditsValidDays);
  return expiresAt;
}

function validCreditConditions(userId: string, paidOnly = false) {
  const now = new Date();
  const base = and(
    eq(credit.userId, userId),
    eq(credit.transactionType, CreditTransactionType.GRANT),
    eq(credit.status, CreditStatus.ACTIVE),
    gt(credit.remainingCredits, 0),
    or(isNull(credit.expiresAt), gt(credit.expiresAt, now))
  );
  if (!paidOnly) return base;
  // Exclude the signup trial grant — only "paid" credits (payment, subscription,
  // renewal, admin reward) may be used for premium features like video.
  return and(base, ne(credit.transactionScene, CreditTransactionScene.GIFT));
}

// --- Balance ---

export async function getBalance(userId: string): Promise<number> {
  const [result] = await db()
    .select({ total: sum(credit.remainingCredits) })
    .from(credit)
    .where(validCreditConditions(userId));

  return parseInt(result?.total || '0');
}

/**
 * Balance of paid credits only — excludes the signup trial grant
 * (scene = 'gift'). Used to gate premium features (video gen) that
 * require actual payment.
 */
export async function getPaidBalance(userId: string): Promise<number> {
  const [result] = await db()
    .select({ total: sum(credit.remainingCredits) })
    .from(credit)
    .where(validCreditConditions(userId, true));

  return parseInt(result?.total || '0');
}

// --- Grant ---

export async function grant(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  description?: string;
  orderNo?: string;
  subscriptionNo?: string;
  scene?: string;
  expiresAt?: Date | null;
}) {
  const newCredit: NewCredit = {
    id: getUuid(),
    userId: params.userId,
    userEmail: params.userEmail || '',
    transactionNo: getSnowId(),
    transactionType: CreditTransactionType.GRANT,
    transactionScene: params.scene || CreditTransactionScene.GIFT,
    credits: params.credits,
    remainingCredits: params.credits,
    status: CreditStatus.ACTIVE,
    description: params.description || 'Grant credit',
    orderNo: params.orderNo || '',
    subscriptionNo: params.subscriptionNo || '',
    expiresAt: params.expiresAt !== undefined ? params.expiresAt : null,
  };

  await db().insert(credit).values(newCredit);
  return newCredit;
}

// --- Consume (FIFO with batching) ---

export async function consume(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  scene?: string;
  description?: string;
  metadata?: string;
  /** When true, only paid credits may be used (excludes the signup trial
   *  grant). The check fails if the user has no paid balance. */
  paidOnly?: boolean;
  tx?: any;
}): Promise<{ success: boolean; consumedCredit?: any }> {
  const {
    userId,
    userEmail,
    credits: amount,
    scene,
    description,
    metadata,
    paidOnly = false,
    tx,
  } = params;
  const now = new Date();

  const execute = async (tx: any) => {
    // 1. Check balance
    const [balance] = await tx
      .select({ total: sum(credit.remainingCredits) })
      .from(credit)
      .where(validCreditConditions(userId, paidOnly));

    if (!balance?.total || parseInt(balance.total) < amount) {
      return { success: false };
    }

    // 2. FIFO consumption with batching
    let remainingToConsume = amount;
    const batchSize = 1000;
    const maxBatches = 10;
    let batchNo = 0;
    const consumedItems: any[] = [];

    while (remainingToConsume > 0 && batchNo < maxBatches) {
      const batchCredits = await tx
        .select()
        .from(credit)
        .where(validCreditConditions(userId, paidOnly))
        .orderBy(asc(credit.expiresAt))
        .limit(batchSize)
        .for('update');

      if (!batchCredits || batchCredits.length === 0) break;

      for (const item of batchCredits) {
        if (remainingToConsume <= 0) break;
        const toConsume = Math.min(remainingToConsume, item.remainingCredits);

        await tx
          .update(credit)
          .set({ remainingCredits: item.remainingCredits - toConsume })
          .where(eq(credit.id, item.id));

        consumedItems.push({
          creditId: item.id,
          transactionNo: item.transactionNo,
          creditsConsumed: toConsume,
          creditsBefore: item.remainingCredits,
          creditsAfter: item.remainingCredits - toConsume,
        });

        remainingToConsume -= toConsume;
      }

      batchNo++;
    }

    // 3. Create consumption record
    const consumedCredit: NewCredit = {
      id: getUuid(),
      userId,
      userEmail: userEmail || '',
      transactionNo: getSnowId(),
      transactionType: CreditTransactionType.CONSUME,
      transactionScene: scene || '',
      status: CreditStatus.ACTIVE,
      description: description || '',
      credits: -amount,
      remainingCredits: 0,
      consumedDetail: JSON.stringify(consumedItems),
      metadata: metadata || '',
    };
    await tx.insert(credit).values(consumedCredit);

    return { success: true, consumedCredit };
  };

  if (tx) return execute(tx);
  return db().transaction(execute);
}

// --- Revoke (restore credits from a consumed record) ---

export async function revoke(consumeCreditId: string) {
  const [consumeRecord] = await db()
    .select()
    .from(credit)
    .where(
      and(
        eq(credit.id, consumeCreditId),
        eq(credit.transactionType, CreditTransactionType.CONSUME),
        eq(credit.status, CreditStatus.ACTIVE)
      )
    )
    .limit(1);

  if (!consumeRecord || !consumeRecord.consumedDetail) return;

  const items = JSON.parse(consumeRecord.consumedDetail);

  await db().transaction(async (tx: any) => {
    // Atomic increment per source grant — no read-modify-write race.
    for (const item of items) {
      await tx
        .update(credit)
        .set({
          remainingCredits: sql`${credit.remainingCredits} + ${item.creditsConsumed}`,
        })
        .where(eq(credit.id, item.creditId));
    }

    // Mark consumption record as deleted
    await tx
      .update(credit)
      .set({ status: CreditStatus.DELETED })
      .where(eq(credit.id, consumeCreditId));
  });
}

/**
 * Reduce a previously-consumed hold to its final amount. Releasing from the
 * newest FIFO slices preserves the original credit consumption, so a later
 * revoke still restores exactly the final settled amount.
 */
export async function settleConsumption(params: {
  consumeCreditId: string;
  credits: number;
  tx?: any;
}) {
  const { consumeCreditId, credits: finalCredits, tx } = params;
  if (!Number.isInteger(finalCredits) || finalCredits < 0) {
    throw new Error('Final credit amount must be a non-negative integer.');
  }

  const execute = async (transaction: any) => {
    const [consumeRecord] = await transaction
      .select()
      .from(credit)
      .where(
        and(
          eq(credit.id, consumeCreditId),
          eq(credit.transactionType, CreditTransactionType.CONSUME),
          eq(credit.status, CreditStatus.ACTIVE)
        )
      )
      .limit(1)
      .for('update');

    if (!consumeRecord) {
      throw new Error('Credit reservation was not found.');
    }

    const reservedCredits = Math.abs(Number(consumeRecord.credits));
    if (finalCredits > reservedCredits) {
      throw new Error('Final credits exceed the reserved credit hold.');
    }
    if (finalCredits === reservedCredits) return consumeRecord;

    const items = JSON.parse(consumeRecord.consumedDetail || '[]') as Array<{
      creditId: string;
      creditsConsumed: number;
      [key: string]: unknown;
    }>;
    let creditsToRelease = reservedCredits - finalCredits;

    for (
      let index = items.length - 1;
      index >= 0 && creditsToRelease > 0;
      index--
    ) {
      const item = items[index];
      const consumed = Number(item.creditsConsumed);
      if (!Number.isFinite(consumed) || consumed <= 0) continue;
      const released = Math.min(consumed, creditsToRelease);
      await transaction
        .update(credit)
        .set({
          remainingCredits: sql`${credit.remainingCredits} + ${released}`,
        })
        .where(eq(credit.id, item.creditId));
      item.creditsConsumed = consumed - released;
      creditsToRelease -= released;
    }

    if (creditsToRelease > 0) {
      throw new Error('Credit reservation detail is incomplete.');
    }

    const settledItems = items.filter((item) => item.creditsConsumed > 0);
    if (finalCredits === 0) {
      await transaction
        .update(credit)
        .set({ status: CreditStatus.DELETED })
        .where(eq(credit.id, consumeCreditId));
      return { ...consumeRecord, credits: 0, status: CreditStatus.DELETED };
    }

    await transaction
      .update(credit)
      .set({
        credits: -finalCredits,
        consumedDetail: JSON.stringify(settledItems),
      })
      .where(eq(credit.id, consumeCreditId));
    return {
      ...consumeRecord,
      credits: -finalCredits,
      consumedDetail: JSON.stringify(settledItems),
    };
  };

  if (tx) return execute(tx);
  return db().transaction(execute);
}

// --- Auto-grant for new user ---

/**
 * True when the user already holds a signup-gift credit row.
 *
 * The gift scene is the idempotency key for the whole signup-bonus
 * feature: every path that can grant it checks here first, so a user
 * who signs up with Google, verifies their email, and re-runs the
 * callback still ends up with exactly one gift row.
 */
async function hasSignupBonus(userId: string): Promise<boolean> {
  const [existing] = await db()
    .select({ id: credit.id })
    .from(credit)
    .where(
      and(
        eq(credit.userId, userId),
        eq(credit.transactionScene, CreditTransactionScene.GIFT)
      )
    )
    .limit(1);
  return Boolean(existing);
}

/**
 * Grant the signup bonus, config-driven (`initial_credits_*` in the
 * `config` table, editable at Admin → Settings → General → Credits).
 * The same keys feed `useSignupBonus()` on the marketing surfaces and
 * the welcome email, so what we advertise is what we grant.
 *
 * Called from `src/routes/api/auth/$.ts` on every path that can create
 * a user — OAuth callback, magic-link verify, credential sign-up, and
 * email verification. Never from `databaseHooks.user.create.after`:
 * better-auth 1.6.x queues that hook via `queueAfterTransactionHook`
 * and doesn't reliably flush it before the OAuth callback redirects,
 * which silently skipped the grant for every Google signup.
 *
 * Idempotent — a user with an existing gift row is a no-op, so callers
 * can fire it defensively without double-granting.
 *
 * Race note: two concurrent auth requests for the same brand-new user
 * could both pass `hasSignupBonus` before either inserts. The window is
 * microseconds and the blast radius is one extra bonus; not worth a
 * transaction or a unique index on (user_id, transaction_scene).
 */
export async function grantForNewUser(params: {
  userId: string;
  userEmail?: string;
  configs: Record<string, string>;
}) {
  const { userId, userEmail, configs } = params;

  // Defaults (must mirror src/modules/config/settings.ts and
  // src/hooks/use-signup-bonus.ts for fresh installs that never opened
  // Admin → Settings): 5 credits expiring in 30 days — enough for one
  // PPT deck or a short chat session. Image generation costs more than
  // the whole bonus (~10 cr), so the first image is handed out separately
  // by the `image_first_free` trial (src/lib/image-billing.ts) rather than
  // by inflating this number.

  if (configs.initial_credits_enabled === 'false') return;

  const parsed = parseInt(configs.initial_credits_amount);
  const credits = Number.isNaN(parsed) ? 5 : parsed;
  if (credits <= 0) return;

  if (await hasSignupBonus(userId)) return;

  const validDays = parseInt(configs.initial_credits_valid_days) || 30;
  const description =
    configs.initial_credits_description ||
    'Welcome to kimik3 — 5 free credits + your first image generation on us 🎨';

  const expiresAt = calculateCreditExpirationTime({
    creditsValidDays: validDays,
  });

  return grant({
    userId,
    userEmail,
    credits,
    description,
    scene: CreditTransactionScene.GIFT,
    expiresAt,
  });
}

// --- History ---

export async function getHistory(userId: string, limit = 50) {
  return db()
    .select()
    .from(credit)
    .where(and(eq(credit.userId, userId), isNull(credit.deletedAt)))
    .orderBy(desc(credit.createdAt))
    .limit(limit);
}
