import { eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { config } from '@/config/db/schema';

const CONFIG_KEY = 'footer_badges';

/** Read directly so separate server instances cannot serve stale config cache data. */
export async function getStoredFooterBadges(): Promise<string | undefined> {
  const [row] = await db()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.name, CONFIG_KEY))
    .limit(1);

  return row?.value ?? undefined;
}

/** Store the validated badge list in the shared config table. */
export async function saveStoredFooterBadges(value: string): Promise<void> {
  await db().transaction(async (tx: any) => {
    const [existing] = await tx
      .select({ name: config.name })
      .from(config)
      .where(eq(config.name, CONFIG_KEY))
      .limit(1);

    if (existing) {
      await tx.update(config).set({ value }).where(eq(config.name, CONFIG_KEY));
    } else {
      await tx.insert(config).values({ name: CONFIG_KEY, value });
    }
  });
}
