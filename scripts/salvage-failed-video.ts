/**
 * Same salvage loop as salvage-stuck-video.ts but for tasks stuck at
 * `failed` (where the deployed polling endpoint tripped on a transient
 * error mid-polling even though Evolink eventually reported success).
 * If the remote is `completed` and the local row is `failed`, lift the
 * row back to `success` and persist the URL — credits were already
 * charged at the gateway, so the user's generated video is real.
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/salvage-failed-video.ts --confirm
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { EvolinkVideoProvider } from '../src/core/ai/evolink-video';
import { db } from '../src/core/db';
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
  if (!cfg?.value) {
    console.log('No evolink_api_key configured.');
    return;
  }

  const candidates = await db()
    .select()
    .from(schema.aiTask)
    .where(
      and(
        eq(schema.aiTask.provider, 'evolink-video'),
        inArray(schema.aiTask.status, ['failed'])
      )
    )
    .orderBy(desc(schema.aiTask.createdAt))
    .limit(20);

  if (candidates.length === 0) {
    console.log('No failed evolink-video tasks.');
    return;
  }
  console.log(`Found ${candidates.length} failed evolink-video task(s):`);

  const provider = new EvolinkVideoProvider({ apiKey: cfg.value });
  const saveFiles = await buildRehostSaveFiles();
  let updated = 0;

  for (const t of candidates) {
    const stored = parseTaskResult(t.taskResult);
    if (!stored?.remoteTaskId) continue;
    let polled;
    try {
      polled = await provider.queryStatus(stored.remoteTaskId);
    } catch (e: any) {
      console.log(`  ${t.id} — poll failed: ${e?.message || e}`);
      continue;
    }
    if (polled.status !== 'success' || !polled.videoUrl) {
      console.log(`  ${t.id} — Evolink still ${polled.status}, no salvage.`);
      continue;
    }

    console.log(`  ${t.id} — Evolink COMPLETED (recovered!)`);

    let videoUrl = polled.videoUrl;
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
      } catch (e: any) {
        console.warn(`    R2 rehost failed: ${e?.message || e}`);
      }
    }

    const newTaskResult = {
      ...stored,
      remoteTaskId: stored.remoteTaskId,
      videoUrl,
      originalVideoUrl: polled.videoUrl,
      videoStorageKey,
    };

    if (!confirm) {
      console.log(
        `    [dry-run] would lift to success, videoUrl=${videoUrl.slice(0, 80)}…`
      );
      continue;
    }
    await db()
      .update(schema.aiTask)
      .set({ status: 'success', taskResult: JSON.stringify(newTaskResult) })
      .where(eq(schema.aiTask.id, t.id));
    updated++;
    console.log(`    ✓ lifted to success`);
  }

  console.log(
    confirm ? `Updated ${updated}.` : 'Dry-run only. Pass --confirm to apply.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
