import { desc, eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  const userId = 'e4c35eef-7207-412d-80ae-c97142bb254e';
  const allTasks = await db()
    .select()
    .from(schema.aiTask)
    .where(eq(schema.aiTask.userId, userId))
    .orderBy(desc(schema.aiTask.createdAt));
  console.log('Total aiTask rows for user:', allTasks.length);
  for (const t of allTasks) {
    console.log(
      '  ',
      t.mediaType,
      t.status,
      t.id.slice(0, 8),
      'created:',
      t.createdAt?.toISOString?.()
    );
  }
}
main();
