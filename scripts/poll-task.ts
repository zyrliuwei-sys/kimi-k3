/**
 * Poll an aiTask by id and print status + video URL.
 * Usage: tsx scripts/poll-task.ts <taskId>
 */
import { eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: tsx scripts/poll-task.ts <taskId>');
    process.exit(1);
  }
  const [t] = await db()
    .select()
    .from(schema.aiTask)
    .where(eq(schema.aiTask.id, id))
    .limit(1);
  if (!t) {
    console.error('Task not found');
    process.exit(1);
  }
  console.log('id:', t.id);
  console.log('mediaType:', t.mediaType);
  console.log('status:', t.status);
  console.log('model:', t.model);
  console.log('provider:', t.provider);
  console.log('taskResult:', t.taskResult);
  // try parsed
  try {
    const r =
      typeof t.taskResult === 'string'
        ? JSON.parse(t.taskResult)
        : t.taskResult;
    console.log('parsed taskResult:', JSON.stringify(r, null, 2));
  } catch {}
}
main();
