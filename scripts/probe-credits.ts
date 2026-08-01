import { eq, sql } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  // Read credit rows
  const credits = await db().select().from(schema.credit);
  console.log(`Total credit rows in DB: ${credits.length}`);

  if (credits.length === 0) {
    console.log('Empty — listing tables:');
    const tables = await db().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    );
    console.log(
      'Tables:',
      tables.rows?.map((t: any) => t.table_name).join(', ')
    );
    return;
  }

  // Aggregate
  const breakdown = new Map<string, { rows: number; remaining: number }>();
  for (const c of credits) {
    if (c.status !== 'active') continue;
    if (!c.remainingCredits || c.remainingCredits <= 0) continue;
    const key = `${c.transactionType}/${c.transactionScene}`;
    const cur = breakdown.get(key) || { rows: 0, remaining: 0 };
    cur.rows += 1;
    cur.remaining += c.remainingCredits;
    breakdown.set(key, cur);
  }
  console.log('\nBreakdown of active grants:');
  for (const [key, v] of breakdown) {
    console.log(`  ${key.padEnd(36)} rows=${v.rows} remaining=${v.remaining}`);
  }

  // Top 5 users
  const userBalance = new Map<string, { email: string; remaining: number }>();
  for (const c of credits) {
    if (c.status !== 'active') continue;
    if (!c.remainingCredits || c.remainingCredits <= 0) continue;
    if (c.transactionType !== 'grant') continue;
    const cur = userBalance.get(c.userId) || {
      email: c.userEmail || '',
      remaining: 0,
    };
    cur.remaining += c.remainingCredits;
    if (c.userEmail && !cur.email) cur.email = c.userEmail;
    userBalance.set(c.userId, cur);
  }
  const top = Array.from(userBalance.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 3);

  console.log('\nTop 3 users by balance:');
  for (const u of top) {
    console.log(`\n  email=${u.email} remaining=${u.remaining}`);

    // Per-user breakdown
    const scenes = new Map<string, { rows: number; remaining: number }>();
    for (const c of credits) {
      if (c.userId !== u.id) continue;
      if (c.status !== 'active') continue;
      if (!c.remainingCredits || c.remainingCredits <= 0) continue;
      if (c.transactionType !== 'grant') continue;
      const key = c.transactionScene || '(none)';
      const cur = scenes.get(key) || { rows: 0, remaining: 0 };
      cur.rows += 1;
      cur.remaining += c.remainingCredits;
      scenes.set(key, cur);
    }
    for (const [k, v] of scenes) {
      console.log(
        `    scene=${k.padEnd(20)} rows=${v.rows} remaining=${v.remaining}`
      );
    }

    // Also list all expiresAt to spot any expiration patterns
    console.log(`    expiring credit rows for this user:`);
    for (const c of credits) {
      if (
        c.userId !== u.id ||
        c.status !== 'active' ||
        !c.remainingCredits ||
        c.remainingCredits <= 0
      )
        continue;
      const exp = c.expiresAt ? new Date(c.expiresAt).toISOString() : 'never';
      console.log(
        `      scene=${(c.transactionScene || '?').padEnd(20)} rem=${c.remainingCredits} remaining/total=${c.remainingCredits}/${c.credits} desc="${c.description?.slice(0, 50)}" expires=${exp}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
