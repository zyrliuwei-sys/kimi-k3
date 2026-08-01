/**
 * Full end-to-end test of the Seedance 2.0 pipeline. Mirrors the
 * production flow in `src/routes/api/ai-tasks/-video.ts` step-for-step,
 * minus the auth check (we're calling as a known admin user) and the
 * HTTP request shape (we call the provider directly).
 *
 *   1. resolve provider from configs (pickVideoProvider)
 *   2. compute credit cost (getSeedanceVideoCost)
 *   3. createTask + consume credits (atomic)
 *   4. provider.submit(...) — real call to evolink.ai
 *   5. updateTask → PROCESSING
 *
 * If everything succeeds, the remote task id is printed and the aiTask
 * row is left in PROCESSING state so the client can poll it via
 * `/api/ai-tasks/$id`.
 *
 * Usage:
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/e2e-seedance.ts
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/e2e-seedance.ts --duration=3 --quality=480p
 */
import { desc, eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { AIMediaType, EvolinkVideoProvider } from '../src/core/ai';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
  DEFAULT_SEEDANCE_VIDEO_AUDIO,
  DEFAULT_SEEDANCE_VIDEO_DURATION,
  DEFAULT_SEEDANCE_VIDEO_QUALITY,
  getSeedanceVideoCost,
  isSeedanceVideoAspectRatio,
  isSeedanceVideoQuality,
} from '../src/core/ai/video-pricing';
import { db } from '../src/core/db';
import { getSnowId, getUuid } from '../src/lib/hash';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '../src/modules/ai-tasks/service';
import { getAllConfigs } from '../src/modules/config/service';

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
}

async function main() {
  // Find the most-recently-active user (the dev/admin who'll consume
  // the credits). Single-tenant dev DB — just pick the top user.
  const [admin] = await db()
    .select()
    .from(schema.user)
    .orderBy(desc(schema.user.updatedAt))
    .limit(1);
  if (!admin) {
    console.error('No user found');
    process.exit(1);
  }
  console.log(`Using user: ${admin.name} <${admin.email}>  id=${admin.id}`);

  const duration = Number(arg('duration')) || DEFAULT_SEEDANCE_VIDEO_DURATION;
  const qualityRaw = arg('quality');
  const quality = isSeedanceVideoQuality(qualityRaw)
    ? qualityRaw
    : DEFAULT_SEEDANCE_VIDEO_QUALITY;
  const aspectRaw = arg('aspect') || DEFAULT_SEEDANCE_VIDEO_ASPECT;
  const aspectRatio = isSeedanceVideoAspectRatio(aspectRaw)
    ? aspectRaw
    : DEFAULT_SEEDANCE_VIDEO_ASPECT;

  console.log(`Options: ${duration}s, ${quality}, ${aspectRatio}\n`);

  const configs = await getAllConfigs();
  if (!configs?.evolink_api_key) {
    console.error('evolink_api_key missing');
    process.exit(1);
  }
  if (configs.seedance_video_enabled === 'false') {
    console.error('seedance_video_enabled = false');
    process.exit(1);
  }

  const provider = new EvolinkVideoProvider({
    apiKey: configs.evolink_api_key,
    baseUrl: configs.evolink_base_url,
  });
  const costCredits = getSeedanceVideoCost(configs, { duration, quality });
  console.log(
    `Computed cost: ${costCredits} credits for ${duration}s @ ${quality}`
  );

  const prompt =
    'a single red apple on a white table, soft studio lighting, gentle camera push-in';

  // Step 3: createTask + consume credits (atomic).
  let task;
  try {
    task = await createTask({
      userId: admin.id,
      mediaType: AIMediaType.VIDEO,
      provider: 'evolink-video',
      model: 'seedance-2.0-text-to-video',
      prompt,
      options: { duration, quality, aspectRatio, generateAudio: false },
      costCredits,
      paidOnly: false,
    });
    console.log(`✓ aiTask row created: ${task.id}`);
  } catch (e: any) {
    console.error(`✗ createTask failed: ${e?.message || e}`);
    process.exit(1);
  }

  // Step 4: provider.submit() — real call to evolink.
  const t0 = Date.now();
  try {
    const result = await provider.submit({
      prompt,
      duration,
      quality,
      aspectRatio,
      generateAudio: false,
    });
    const dt = Date.now() - t0;
    console.log(`✓ provider.submit OK in ${dt}ms`);
    console.log(`  remoteTaskId: ${result.taskId}`);
    console.log(`  model: ${result.model}`);

    // Step 5: updateTask → PROCESSING.
    await updateTask({
      taskId: task.id,
      status: AITaskStatus.PROCESSING,
      taskResult: {
        remoteTaskId: result.taskId,
        provider: 'evolink-video',
        model: 'seedance-2.0-text-to-video',
        duration,
        quality,
        aspectRatio,
        generateAudio: false,
      },
    });
    console.log(`✓ aiTask row → PROCESSING`);
    console.log(`\n🎉 End-to-end pipeline works!`);
    console.log(`\nNow you can:`);
    console.log(`  1. Refresh /api-playground/video in the browser`);
    console.log(
      `  2. The dialog's submit button (right of seedance-2.0) will hit the full pipeline`
    );
    console.log(`  3. Or poll this task at /api/ai-tasks/${task.id}`);
    console.log(`\nLeaked test row left in PROCESSING state — run:`);
    console.log(
      `  pnpm exec tsx scripts/with-env.ts tsx scripts/cleanup-stale-video-tasks.ts --confirm`
    );
  } catch (e: any) {
    const dt = Date.now() - t0;
    console.error(`✗ provider.submit failed in ${dt}ms: ${e?.message || e}`);
    // Mark FAILED so the credit is refunded.
    await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    process.exit(99);
  })
  .finally(() => process.exit(0));
