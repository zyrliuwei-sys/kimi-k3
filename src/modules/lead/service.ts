import { eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { waitlist } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

export interface JoinWaitlistParams {
  email: string;
  source?: string;
  locale?: string;
}

export interface JoinWaitlistResult {
  ok: true;
  duplicate: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add an email to the landing-page waitlist. Idempotent by email — repeat
 * submissions from the same address return `{ duplicate: true }` instead of
 * throwing (the unique constraint is the backstop for races).
 */
export async function joinWaitlist(
  params: JoinWaitlistParams
): Promise<JoinWaitlistResult> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error('Invalid email');
  }

  const existing = await db()
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(eq(waitlist.email, email))
    .limit(1);
  if (existing.length > 0) {
    return { ok: true, duplicate: true };
  }

  await db()
    .insert(waitlist)
    .values({
      id: getUuid(),
      email,
      source: params.source ?? 'hero',
      locale: params.locale ?? '',
    });
  return { ok: true, duplicate: false };
}
