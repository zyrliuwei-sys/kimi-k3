import { eq, and, isNull } from 'drizzle-orm';
import { getUuid, getNonceStr } from '@/lib/hash';
import { db } from '@/core/db';
import { apikey } from '@/config/db/schema';

/**
 * Create a new API key for a user.
 */
export async function create(params: {
  userId: string;
  title: string;
}): Promise<{ id: string; key: string; title: string }> {
  const { userId, title } = params;
  const key = `sk_${getNonceStr(32)}`;

  const [row] = await db()
    .insert(apikey)
    .values({
      id: getUuid(),
      userId,
      key,
      title,
      status: 'active',
    })
    .returning();

  return { id: row.id, key: row.key, title: row.title };
}

/**
 * List all active API keys for a user.
 */
export async function list(userId: string) {
  return db()
    .select({
      id: apikey.id,
      key: apikey.key,
      title: apikey.title,
      status: apikey.status,
      createdAt: apikey.createdAt,
    })
    .from(apikey)
    .where(
      and(
        eq(apikey.userId, userId),
        eq(apikey.status, 'active'),
        isNull(apikey.deletedAt)
      )
    );
}

/**
 * Delete (soft) an API key.
 */
export async function remove(params: { userId: string; keyId: string }) {
  const { userId, keyId } = params;

  await db()
    .update(apikey)
    .set({ status: 'deleted', deletedAt: new Date() })
    .where(
      and(
        eq(apikey.id, keyId),
        eq(apikey.userId, userId)
      )
    );
}

/**
 * Validate an API key. Returns the userId if valid, null otherwise.
 */
export async function validate(key: string): Promise<string | null> {
  const [row] = await db()
    .select({ userId: apikey.userId })
    .from(apikey)
    .where(
      and(
        eq(apikey.key, key),
        eq(apikey.status, 'active'),
        isNull(apikey.deletedAt)
      )
    )
    .limit(1);

  return row?.userId ?? null;
}
