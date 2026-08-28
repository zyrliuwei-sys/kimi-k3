import { sql } from 'drizzle-orm';

import { db } from '../src/core/db';

/**
 * Create the `chat_free_quota` table (free-tier chat daily quota, see
 * `@/modules/free-chat-quota/service.ts` and FREE_CHAT_MODEL_IDS in
 * `@/lib/chat-billing`).
 *
 * The `drizzle/` migration chain in this repo is SQLite-era and unreadable by
 * the current drizzle-kit, so production schema changes ship as reviewed
 * idempotent SQL instead of db:generate/db:migrate. This DDL matches what
 * drizzle would push from `schema.postgres.ts` (bare REFERENCES → no action,
 * precision-6 timestamps without time zone) so a future db:push sees no drift.
 *
 * Dry-run by default. Pass --confirm to apply.
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/create-chat-free-quota.ts           # dry run
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/create-chat-free-quota.ts --confirm # apply
 */

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "chat_free_quota" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON UPDATE no action ON DELETE no action,
  "day" text NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_free_quota_user_day"
  ON "chat_free_quota" ("user_id","day")`,
  `CREATE INDEX IF NOT EXISTS "idx_chat_free_quota_day"
  ON "chat_free_quota" ("day")`,
];

async function main() {
  const confirm = process.argv.includes('--confirm');

  if (!confirm) {
    console.log('Dry run — SQL that would be applied:\n');
    for (const stmt of STATEMENTS) console.log(`${stmt};\n`);
    console.log('Re-run with --confirm to apply.');
    return;
  }

  for (const stmt of STATEMENTS) {
    await db().execute(sql.raw(stmt));
    console.log('✓ applied:', stmt.split('\n')[0]);
  }

  const check = await db().execute(sql`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_name = 'chat_free_quota' order by ordinal_position
  `);
  console.log('\nVerification (information_schema):');
  console.log(JSON.stringify(check.rows ?? check, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
