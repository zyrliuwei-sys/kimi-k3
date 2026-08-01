import { eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  // Read all configs
  const configs = await db().select().from(schema.config);
  console.log('--- All configs ---');
  for (const c of configs) {
    const v = c.value ?? '';
    const masked = v.length > 12 ? v.slice(0, 4) + '***' + v.slice(-4) : v;
    console.log(`  ${c.name.padEnd(40)} = ${masked}`);
  }
  console.log('');
  // Read credit balance
  const credits = await db().select().from(schema.credit);
  const active = credits.filter(
    (c) =>
      c.transactionType === 'grant' &&
      c.status === 'active' &&
      (c.expiresAt === null || c.expiresAt > new Date())
  );
  const totalActive = active.reduce(
    (sum, c) => sum + (c.remainingCredits ?? 0),
    0
  );
  console.log(`--- Credits ---`);
  console.log(`  Total active grant credits: ${totalActive}`);
  console.log(`  Active grant rows: ${active.length}`);
}
main();
