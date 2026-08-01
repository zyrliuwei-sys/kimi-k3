import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

/**
 * Pre-commit-3ccef66 admin grants were written with scene = 'gift'.
 * After that commit the admin endpoint switched to scene = 'reward',
 * but the existing 'gift' rows with "Admin" / empty descriptions from
 * the old code path are now incorrectly classified as trial credits
 * and excluded from `paid balance` / paidOnly consumptions.
 *
 * Heuristics to identify the affected rows:
 *   - transactionType = 'grant'
 *   - transactionScene = 'gift'
 *   - description IS NULL or description LIKE '%Admin%'
 *   - credits > 10 (signup bonus is at most ~10 in this app; admin grants
 *     are typically much larger)
 *
 * Pure signup bonuses have description like "Welcome to kimik3 — N free
 * credits..." so they fall through description NOT LIKE '%Admin%'.
 *
 * Dry-run by default. Pass --confirm to apply.
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/backfill-admin-grants.ts          # dry run
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/backfill-admin-grants.ts --confirm # apply
 */

async function main() {
  const confirm = process.argv.includes('--confirm');

  // Find candidate rows
  const candidates = await db()
    .select({
      id: schema.credit.id,
      userId: schema.credit.userId,
      userEmail: schema.credit.userEmail,
      credits: schema.credit.credits,
      remaining: schema.credit.remainingCredits,
      description: schema.credit.description,
      scene: schema.credit.transactionScene,
      status: schema.credit.status,
      createdAt: schema.credit.createdAt,
    })
    .from(schema.credit)
    .where(
      and(
        eq(schema.credit.transactionType, 'grant'),
        eq(schema.credit.transactionScene, 'gift'),
        sql`${schema.credit.remainingCredits} > 0`,
        // Conservative: only reclassify rows that look like explicit
        // admin grants (description literally says "Admin" or starts
        // with "Manual grant"). Avoids touching the 21 "Initial
        // credits" rows which are intentional trial bonuses for users
        // who signed up via the older onboarding flow / invite codes.
        sql`(
          ${schema.credit.description} = 'Admin'
          OR ${schema.credit.description} LIKE 'Manual grant%'
        )`
      )
    );

  console.log(`Found ${candidates.length} candidate rows:`);
  for (const r of candidates) {
    const exp = 'expiresAt' in r ? '' : '';
    console.log(
      `  id=${r.id.slice(0, 8)} user=${r.userEmail || r.userId.slice(0, 8)} credits=${r.credits} remaining=${r.remaining} desc="${(r.description || '').slice(0, 60)}" status=${r.status}`
    );
  }

  if (!confirm) {
    console.log(
      `\nDry-run mode. Pass --confirm to actually reclassify these rows.`
    );
    // Show before/after paid balance impact
    if (candidates.length) {
      const userIds = Array.from(new Set(candidates.map((c) => c.userId)));
      for (const uid of userIds) {
        const userRows = candidates.filter((c) => c.userId === uid);
        const total = userRows.reduce((s, r) => s + r.remaining, 0);
        console.log(
          `  → user ${userRows[0].userEmail} paid balance would gain +${total}`
        );
      }
    }
    return;
  }

  if (candidates.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  const ids = candidates.map((r) => r.id);
  console.log(`\nReclassifying ${ids.length} rows: scene 'gift' → 'reward'`);

  const updated = await db()
    .update(schema.credit)
    .set({ transactionScene: 'reward' })
    .where(
      sql`${schema.credit.id} IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `
      )})`
    )
    .returning({ id: schema.credit.id });

  console.log(`Updated ${updated.length} rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
