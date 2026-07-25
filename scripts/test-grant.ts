import { desc, eq } from 'drizzle-orm';

import { user } from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';

// Find the latest user and their credit grant
async function main() {
  const db = dbFn();
  const users = await db
    .select()
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(3);
  console.log('Latest users:');
  for (const u of users) {
    console.log(`  ${u.email} created=${u.createdAt.toISOString()}`);
  }
  const { credit } = await import('../src/config/db/schema');
  console.log('\nLatest credit transactions:');
  const credits = await db
    .select()
    .from(credit)
    .orderBy(desc(credit.createdAt))
    .limit(5);
  for (const c of credits) {
    console.log(
      `  ${c.userEmail} amount=${c.credits} remaining=${c.remainingCredits} desc="${c.description}" created=${c.createdAt.toISOString()}`
    );
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
