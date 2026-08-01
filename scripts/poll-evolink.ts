import { and, desc, eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { EvolinkVideoProvider } from '../src/core/ai/evolink-video';
import { db } from '../src/core/db';

async function main() {
  // Find the unprocessed task
  const [task] = await db()
    .select()
    .from(schema.aiTask)
    .where(
      and(
        eq(schema.aiTask.provider, 'evolink-video'),
        eq(schema.aiTask.status, 'processing')
      )
    )
    .orderBy(desc(schema.aiTask.createdAt))
    .limit(1);

  if (!task) {
    console.log('No processing video tasks found.');
    return;
  }
  const tr =
    typeof task.taskResult === 'string'
      ? JSON.parse(task.taskResult)
      : task.taskResult;
  const remoteTaskId = tr?.remoteTaskId;
  if (!remoteTaskId) {
    console.log(`Task ${task.id} has no remoteTaskId`);
    return;
  }

  console.log(
    `Local task:  ${task.id} (createdAt=${task.createdAt?.toISOString?.() || task.createdAt})`
  );
  console.log(`Remote ID:   ${remoteTaskId}`);
  console.log(
    `Local age:   ${Math.round((Date.now() - new Date(task.createdAt).getTime()) / 1000)}s`
  );
  console.log(`Polling...`);

  // Fetch the admin api key
  const [cfg] = await db()
    .select()
    .from(schema.config)
    .where(eq(schema.config.name, 'evolink_api_key'));
  const apiKey = cfg?.value;
  if (!apiKey) {
    console.log('No evolink_api_key configured.');
    return;
  }

  const provider = new EvolinkVideoProvider({
    apiKey,
    baseUrl: 'https://api.evolink.ai/v1',
  });
  const polled = await provider.queryStatus(remoteTaskId);
  console.log('Polled result:', JSON.stringify(polled, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
