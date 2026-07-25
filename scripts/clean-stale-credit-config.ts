/**
 * Clean stale `initial_credits_amount` row from the `config` table so the
 * updated code default (10 credits) takes effect on next sign-up.
 *
 * Background:
 *   The signup bonus flow reads `configs.initial_credits_amount` from the
 *   `config` table. If a value was ever saved via Admin → Settings → Credits,
 *   it overrides the code default — even after the default is changed. To
 *   pick up the new code default we have to delete the row.
 *
 * Also inspects `ppt_credit_cost` (recently added; rarely present in DB) and
 * leaves it alone unless --all is passed.
 *
 * Usage:
 *   tsx scripts/with-env.ts tsx scripts/clean-stale-credit-config.ts --confirm
 *   NODE_ENV=production tsx scripts/with-env.ts tsx scripts/clean-stale-credit-config.ts --confirm
 *
 * Idempotency: refuses to write without --confirm. Prints every row it
 * touches.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { envConfigs } from '../src/config';
import { config } from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';

const TARGET_KEYS = [
  'initial_credits_amount',
  'initial_credits_description',
  'ppt_credit_cost',
];

async function main() {
  const confirm = process.argv.includes('--confirm');
  const cleanAll = process.argv.includes('--all');

  if (!confirm) {
    console.error(
      'Refusing to run without --confirm. Re-run with --confirm to delete.'
    );
    process.exit(1);
  }

  console.log(
    `DB provider: ${envConfigs.database_provider}, url host: ${
      envConfigs.database_url?.split('@')[1]?.split('/')[0] ?? 'NONE'
    }`
  );

  const db = dbFn();

  // 1. Snapshot existing rows
  const existing = await db
    .select()
    .from(config)
    .where(inArray(config.name, TARGET_KEYS));

  if (existing.length === 0) {
    console.log(
      'Nothing to clean — none of the target keys exist in the config table.'
    );
    console.log(
      '   Code defaults will apply on next sign-up (10 cr, 5 cr/PPT).'
    );
    process.exit(0);
  }

  console.log('\nFound in config table:');
  for (const row of existing) {
    console.log(`   ${row.name} = ${JSON.stringify(row.value)}`);
  }

  // 2. Decide what to delete
  //    - initial_credits_amount: ALWAYS delete (we want the new code default).
  //    - initial_credits_description: ALWAYS delete (DB still has the old
  //      "20 free credits" copy from the previous default; we want the
  //      fresh "10 free credits (≈ 2 PPT decks)" copy from the new fallback).
  //    - ppt_credit_cost: only delete if --all, otherwise leave alone so
  //      admin can keep any custom value.
  const toDelete = existing.filter(
    (r) =>
      r.name === 'initial_credits_amount' ||
      r.name === 'initial_credits_description' ||
      (cleanAll && r.name === 'ppt_credit_cost')
  );

  if (toDelete.length === 0) {
    console.log('\nNothing to delete under current flags.');
    console.log(
      '   Pass --all to also clear ppt_credit_cost (otherwise admin value is preserved).'
    );
    process.exit(0);
  }

  console.log('\nWill delete:');
  for (const row of toDelete) {
    console.log(`   ${row.name} = ${JSON.stringify(row.value)}`);
  }

  // 3. Delete
  const namesToDelete = toDelete.map((r) => r.name);
  const deleted = await db
    .delete(config)
    .where(
      and(inArray(config.name, namesToDelete), eq(config.name, config.name))
    )
    .returning({ name: config.name });

  console.log('\nDeleted rows:');
  for (const row of deleted) {
    console.log(`   ✓ ${row.name}`);
  }

  // 4. Remind about cache
  console.log(
    '\n⚠️  IMPORTANT: the running app caches `config` for 1 hour. To pick up'
  );
  console.log(
    '   the change immediately, restart the dev/prod server (Ctrl+C → pnpm dev).'
  );
  console.log(
    '\n✅ Cleanup complete. Next sign-up will receive 10 credits (≈ 2 PPT decks).'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
