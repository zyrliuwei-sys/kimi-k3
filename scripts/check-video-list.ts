import { and, desc, eq, sql } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  // Find the user's completed video tasks
  const tasks = await db()
    .select({
      id: schema.aiTask.id,
      userId: schema.aiTask.userId,
      status: schema.aiTask.status,
      provider: schema.aiTask.provider,
      taskResult: schema.aiTask.taskResult,
      createdAt: schema.aiTask.createdAt,
    })
    .from(schema.aiTask)
    .where(eq(schema.aiTask.mediaType, 'video'))
    .orderBy(desc(schema.aiTask.createdAt))
    .limit(5);

  for (const t of tasks) {
    const tr =
      typeof t.taskResult === 'string'
        ? JSON.parse(t.taskResult)
        : t.taskResult;
    console.log(
      `\n=== ${t.id} (status=${t.status}, provider=${t.provider}) ===`
    );
    console.log(`createdAt: ${t.createdAt?.toISOString?.() || t.createdAt}`);
    if (tr) {
      console.log(`taskResult.videoUrl   = ${tr.videoUrl}`);
      console.log(`taskResult.original   = ${tr.originalVideoUrl || '(none)'}`);
      console.log(`taskResult.videos[]   = ${JSON.stringify(tr.videos || [])}`);
      console.log(`taskResult.remoteTask = ${tr.remoteTaskId || '(none)'}`);
    } else {
      console.log(`taskResult: (null)`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
