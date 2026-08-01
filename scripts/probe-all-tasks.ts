import { desc, eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  // All tasks across all users
  const allTasks = await db()
    .select()
    .from(schema.aiTask)
    .orderBy(desc(schema.aiTask.createdAt))
    .limit(20);
  console.log('Total aiTask rows in DB (max 20):', allTasks.length);
  for (const t of allTasks) {
    console.log(
      '  ',
      t.mediaType.padEnd(6),
      t.status.padEnd(10),
      t.id.slice(0, 8),
      'userId:',
      t.userId.slice(0, 8),
      'created:',
      t.createdAt?.toISOString?.()
    );
  }
}
main();
