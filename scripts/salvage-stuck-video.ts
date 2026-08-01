/**
 * Salvage any aiTask stuck in `processing` once Evolink reports it
 * `status=completed`. The deployed `/api/ai-tasks/$id` polling endpoint
 * is supposed to do this, but a stale deploy left the gateway code that
 * checks an outdated status string (`polled.status === 'failed'` /
 * `'success'`) on this build — so far-back tasks pile up at `processing`
 * forever. This script is the same operation the endpoint would do,
 * but run ad-hoc from the server console.
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/salvage-stuck-video.ts           # dry run
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/salvage-stuck-video.ts --confirm  # apply
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { EvolinkVideoProvider } from '../src/core/ai/evolink-video';
import { db } from '../src/core/db';
import { getUuid } from '../src/lib/hash';
import {
  buildRehostSaveFiles,
  parseTaskResult,
} from '../src/routes/api/ai-tasks/-shared';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const [cfg] = await db()
    .select()
    .from(schema.config)
    .where(eq(schema.config.name, 'evolink_api_key'));
  const apiKey = cfg?.value;
  if (!apiKey) {
    console.log('No evolink_api_key configured.');
    return;
  }

  // Find all evolink-video tasks still in processing/pending state
  const stuck = await db()
    .select()
    .from(schema.aiTask)
    .where(
      and(
        eq(schema.aiTask.provider, 'evolink-video'),
        inArray(schema.aiTask.status, ['processing', 'pending'])
      )
    )
    .orderBy(desc(schema.aiTask.createdAt));

  console.log(`Found ${stuck.length} stuck evolink-video task(s):`);
  for (const t of stuck) {
    const age = Math.round(
      (Date.now() - new Date(t.createdAt).getTime()) / 1000
    );
    console.log(
      `  ${t.id} createdAt=${t.createdAt?.toISOString?.() || t.createdAt} age=${age}s`
    );
  }

  if (stuck.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const provider = new EvolinkVideoProvider({ apiKey });
  const saveFiles = await buildRehostSaveFiles();
  let updated = 0;

  for (const t of stuck) {
    const stored = parseTaskResult(t.taskResult);
    const remoteTaskId = stored?.remoteTaskId;
    if (!remoteTaskId) {
      console.log(`  ${t.id} — no remoteTaskId, skipping.`);
      continue;
    }

    let polled;
    try {
      polled = await provider.queryStatus(remoteTaskId);
    } catch (e: any) {
      console.log(`  ${t.id} — Evolink poll failed: ${e?.message || e}`);
      continue;
    }

    console.log(
      `  ${t.id} remote=${remoteTaskId} → Evolink status=${polled.status}`
    );

    if (polled.status !== 'success') {
      console.log(`    not success yet, leaving as processing.`);
      continue;
    }

    let videoUrl = (polled as any).videoUrl as string;
    if (!videoUrl) {
      console.log(`    success but no videoUrl, skipping.`);
      continue;
    }

    const storageKey = `evolink/video/${t.id}.mp4`;
    let videoStorageKey: string | undefined;
    if (saveFiles) {
      try {
        const saved = await saveFiles([
          {
            url: videoUrl,
            contentType: 'video/mp4',
            key: storageKey,
            type: 'video',
          },
        ]);
        const savedUrl = saved?.[0]?.url;
        if (savedUrl && savedUrl !== videoUrl) {
          videoUrl = savedUrl;
          videoStorageKey = storageKey;
        }
      } catch (error: any) {
        console.warn(
          `    R2 rehost failed (${error?.message || error}), keeping original URL`
        );
      }
    }

    const newTaskResult = {
      ...stored,
      remoteTaskId,
      videoUrl,
      originalVideoUrl: (polled as any).videoUrl,
      videoStorageKey,
    };

    if (!confirm) {
      console.log(
        `    [dry-run] would update task ${t.id}: status=success, videoUrl=${videoUrl.slice(0, 80)}…`
      );
      continue;
    }

    await db()
      .update(schema.aiTask)
      .set({ status: 'success', taskResult: JSON.stringify(newTaskResult) })
      .where(eq(schema.aiTask.id, t.id));
    console.log(`    ✓ updated task ${t.id} → success`);
    updated++;
  }

  console.log(
    `\nDone. ${confirm ? `Updated ${updated} task(s).` : 'Dry-run only. Pass --confirm to apply.'}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
