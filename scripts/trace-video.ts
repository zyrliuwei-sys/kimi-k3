/**
 * Trace a full video submission end-to-end. Prints exactly which API
 * endpoint is called, with timing.
 *
 * Run: pnpm exec tsx scripts/with-env.ts tsx scripts/trace-video.ts
 */
import * as schema from '../src/config/db/schema';
import { AIMediaType, pickVideoProvider } from '../src/core/ai';
import { EvolinkVideoProvider } from '../src/core/ai/evolink-video';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
  DEFAULT_SEEDANCE_VIDEO_AUDIO,
  DEFAULT_SEEDANCE_VIDEO_DURATION,
  DEFAULT_SEEDANCE_VIDEO_QUALITY,
  getSeedanceVideoCost,
} from '../src/core/ai/video-pricing';
import { db } from '../src/core/db';
import { getSnowId, getUuid } from '../src/lib/hash';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '../src/modules/ai-tasks/service';
import { getAllConfigs } from '../src/modules/config/service';

async function main() {
  console.log('=== Video API trace ===\n');

  // Pick the most recent user
  const [user] = await db()
    .select()
    .from(schema.user)
    .orderBy(schema.user.createdAt)
    .limit(1);
  if (!user) {
    console.error('No user');
    process.exit(1);
  }
  console.log(`User: ${user.email}  id=${user.id}`);

  // Read configs
  const configs = await getAllConfigs();
  console.log('\n--- Configs ---');
  console.log(
    `  evolink_api_key: ${configs.evolink_api_key ? '***present***' : 'MISSING'}`
  );
  console.log(
    `  evolink_base_url: ${configs.evolink_base_url || '(default https://api.evolink.ai/v1)'}`
  );
  console.log(
    `  evolink_video_model: ${configs.evolink_video_model || '(default seedance-2.0-text-to-video)'}`
  );
  console.log(
    `  evolink_video_models_allowlist: ${configs.evolink_video_models_allowlist || '(empty = any)'}`
  );
  console.log(
    `  seedance_video_enabled: ${configs.seedance_video_enabled ?? '(default true)'}`
  );

  // Resolve provider
  const pick = await pickVideoProvider(configs);
  if (!pick) {
    console.error(
      '\n✗ pickVideoProvider returned null — no evolink_api_key configured'
    );
    process.exit(1);
  }
  console.log('\n--- Provider ---');
  console.log(`  name: ${pick.name}`);
  console.log(`  defaultModel: ${pick.defaultModel}`);
  console.log(`  class: ${pick.provider.constructor.name}`);
  console.log(`  baseUrl: ${(pick.provider as any).baseUrl ?? 'unknown'}`);
  console.log(
    `  apiKey: ${(pick.provider as any).configs?.apiKey ? '***present***' : 'MISSING'}`
  );

  // Cost
  const cost = getSeedanceVideoCost(configs, {
    duration: DEFAULT_SEEDANCE_VIDEO_DURATION,
    quality: DEFAULT_SEEDANCE_VIDEO_QUALITY,
  });
  console.log('\n--- Defaults ---');
  console.log(
    `  duration: ${DEFAULT_SEEDANCE_VIDEO_DURATION}s  quality: ${DEFAULT_SEEDANCE_VIDEO_QUALITY}  aspect: ${DEFAULT_SEEDANCE_VIDEO_ASPECT}  audio: ${DEFAULT_SEEDANCE_VIDEO_AUDIO}`
  );
  console.log(`  cost: ${cost} credits`);

  // Create aiTask
  const prompt = `trace-test-${Date.now()}`;
  const task = await createTask({
    userId: user.id,
    mediaType: AIMediaType.VIDEO,
    provider: pick.name,
    model: pick.defaultModel,
    prompt,
    options: {
      duration: DEFAULT_SEEDANCE_VIDEO_DURATION,
      quality: DEFAULT_SEEDANCE_VIDEO_QUALITY,
      aspectRatio: DEFAULT_SEEDANCE_VIDEO_ASPECT,
      generateAudio: DEFAULT_SEEDANCE_VIDEO_AUDIO,
    },
    costCredits: cost,
    paidOnly: false,
  });
  console.log(`\n✓ aiTask row: ${task.id}  (${cost} credits deducted)`);

  // Submit to provider
  console.log(`\n--- Submitting to ${pick.name} ---`);
  console.log(`  POST https://api.evolink.ai/v1/videos/generations`);
  console.log(
    `  Authorization: Bearer ***${configs.evolink_api_key?.slice(-4)}`
  );
  console.log(`  model: ${pick.defaultModel}`);
  console.log(`  prompt: "${prompt.slice(0, 60)}"`);

  const t0 = Date.now();
  let result, err;
  try {
    result = await pick.provider.submit({
      prompt,
      duration: DEFAULT_SEEDANCE_VIDEO_DURATION,
      quality: DEFAULT_SEEDANCE_VIDEO_QUALITY,
      aspectRatio: DEFAULT_SEEDANCE_VIDEO_ASPECT,
      generateAudio: DEFAULT_SEEDANCE_VIDEO_AUDIO,
    });
  } catch (e: any) {
    err = e;
  }
  const dt = Date.now() - t0;
  console.log(`  ← ${dt}ms`);

  if (err) {
    console.log(`  ✗ ${err.message}`);
    await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
    process.exit(2);
  }

  console.log(`  ✓ remoteTaskId: ${result.taskId}`);
  console.log(`  ✓ model: ${result.model}`);

  // Update to PROCESSING
  await updateTask({
    taskId: task.id,
    status: AITaskStatus.PROCESSING,
    taskResult: {
      remoteTaskId: result.taskId,
      provider: pick.name,
      model: pick.defaultModel,
      duration: DEFAULT_SEEDANCE_VIDEO_DURATION,
      quality: DEFAULT_SEEDANCE_VIDEO_QUALITY,
      aspectRatio: DEFAULT_SEEDANCE_VIDEO_ASPECT,
      generateAudio: DEFAULT_SEEDANCE_VIDEO_AUDIO,
    },
  });

  console.log('\n✅ Submission successful. Polling would now call:');
  console.log(
    `   GET https://api.evolink.ai/v1/videos/generations/${result.taskId}`
  );
  console.log(`   (handled by EvolinkVideoProvider.queryStatus)`);

  // Cleanup: mark FAILED so credit is auto-refunded
  await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
  console.log(`\n(test row ${task.id} marked FAILED — credit auto-refunded)`);
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    process.exit(99);
  })
  .finally(() => process.exit(0));
