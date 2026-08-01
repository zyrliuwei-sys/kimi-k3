import { eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  const id = process.argv[2];
  const url = process.argv[3];
  if (!id || !url) {
    console.error(
      'Usage: tsx scripts/mark-task-success.ts <taskId> <videoUrl>'
    );
    process.exit(1);
  }
  await db()
    .update(schema.aiTask)
    .set({
      status: 'success',
      taskResult: JSON.stringify({
        remoteTaskId: 'task-unified-1785476176-jmyt1kq9',
        provider: 'evolink-video',
        model: 'seedance-2.0-text-to-video',
        videoUrl: url,
        videos: [{ url }],
      }),
    })
    .where(eq(schema.aiTask.id, id));
  console.log('Task marked SUCCESS:', id);
  console.log('videoUrl:', url);
}
main();
