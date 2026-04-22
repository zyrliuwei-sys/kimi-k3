import { eq, and, isNull, count, like, type SQL } from 'drizzle-orm';
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
 * List active API keys for a user with pagination and optional search on title.
 */
export async function list(
  userId: string,
  page = 1,
  pageSize = 10,
  search?: string
) {
  const conditions: SQL[] = [
    eq(apikey.userId, userId),
    eq(apikey.status, 'active'),
    isNull(apikey.deletedAt) as unknown as SQL,
  ];
  if (search) {
    conditions.push(like(apikey.title, `%${search}%`));
  }
  const where = and(...conditions);

  const [totalResult] = await db()
    .select({ count: count() })
    .from(apikey)
    .where(where);

  const items = await db()
    .select({
      id: apikey.id,
      key: apikey.key,
      title: apikey.title,
      status: apikey.status,
      createdAt: apikey.createdAt,
    })
    .from(apikey)
    .where(where)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total: totalResult.count };
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
