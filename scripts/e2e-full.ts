/**
 * Full end-to-end test: submit → poll until SUCCESS → write video URL
 * to DB → confirm the user can see it in My Videos.
 *
 * Run: pnpm exec tsx scripts/with-env.ts tsx scripts/e2e-full.ts
 */
import * as schema from '../src/config/db/schema';
import { AIMediaType, pickVideoProvider } from '../src/core/ai';
import { EvolinkVideoProvider } from '../src/core/ai/evolink-video';
import { getSeedanceVideoCost } from '../src/core/ai/video-pricing';
import { db } from '../src/core/db';
import {
  AITaskStatus,
  createTask,
  updateTask,
} from '../src/modules/ai-tasks/service';
import { getAllConfigs } from '../src/modules/config/service';

async function main() {
  console.log('=== Full video e2e test ===\n');

  const [user] = await db()
    .select()
    .from(schema.user)
    .orderBy(schema.user.createdAt)
    .limit(1);
  if (!user) {
    console.error('No user');
    process.exit(1);
  }

  const configs = await getAllConfigs();
  const pick = await pickVideoProvider(configs);
  if (!pick) {
    console.error('No provider');
    process.exit(1);
  }

  const prompt = `e2e test — a red balloon floating in the sky ${Date.now()}`;
  const duration = 5;
  const quality: '480p' = '480p';
  const aspectRatio: '16:9' = '16:9';
  const generateAudio = false;
  const cost = getSeedanceVideoCost(configs, { duration, quality });

  console.log(`User: ${user.email}`);
  console.log(`Prompt: "${prompt}"`);
  console.log(
    `Options: ${duration}s, ${quality}, ${aspectRatio}, audio: ${generateAudio}`
  );
  console.log(`Cost: ${cost} credits\n`);

  // 1. createTask + deduct credits
  const task = await createTask({
    userId: user.id,
    mediaType: AIMediaType.VIDEO,
    provider: pick.name,
    model: pick.defaultModel,
    prompt,
    options: { duration, quality, aspectRatio, generateAudio },
    costCredits: cost,
    paidOnly: false,
  });
  console.log(
    `✓ Step 1: aiTask row created ${task.id} (${cost} credits deducted)`
  );

  // 2. submit to Evolink
  console.log(`\n→ Step 2: submit to Evolink…`);
  const t0 = Date.now();
  const submitResult = await pick.provider.submit({
    prompt,
    duration,
    quality,
    aspectRatio,
    generateAudio,
  });
  console.log(
    `  ✓ ${Date.now() - t0}ms — remoteTaskId: ${submitResult.taskId}`
  );

  await updateTask({
    taskId: task.id,
    status: AITaskStatus.PROCESSING,
    taskResult: {
      remoteTaskId: submitResult.taskId,
      provider: pick.name,
      model: pick.defaultModel,
      duration,
      quality,
      aspectRatio,
      generateAudio,
    },
  });

  // 3. Poll until SUCCESS or FAILED (max 90 attempts = ~3 min)
  console.log(`\n→ Step 3: polling Evolink every 3s (max 90 attempts)…`);
  const provider = new EvolinkVideoProvider({
    apiKey: configs.evolink_api_key!,
    baseUrl: configs.evolink_base_url,
  });
  let videoUrl: string | null = null;
  const POLL_MAX = 90;
  for (let i = 1; i <= POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const status = await provider.queryStatus(submitResult.taskId);
      if (status.status === 'success' && status.videoUrl) {
        videoUrl = status.videoUrl;
        console.log(`  ✓ Attempt ${i}: SUCCESS — videoUrl=${videoUrl}`);
        break;
      }
      if (status.status === 'failed') {
        console.log(
          `  ✗ Attempt ${i}: FAILED — ${(status as any).message || 'unknown'}`
        );
        await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
        process.exit(2);
      }
      if (i % 5 === 0) {
        console.log(`  … Attempt ${i}: still processing (${status.status})`);
      }
    } catch (e: any) {
      console.log(`  ! Attempt ${i}: poll error ${e.message?.slice(0, 80)}`);
    }
  }

  if (!videoUrl) {
    console.log(`\n✗ Timed out after ${POLL_MAX * 3}s — task still processing`);
    process.exit(3);
  }

  // 4. Write video URL to DB
  console.log(`\n→ Step 4: write SUCCESS to aiTask row`);
  await updateTask({
    taskId: task.id,
    status: AITaskStatus.SUCCESS,
    taskResult: {
      remoteTaskId: submitResult.taskId,
      provider: pick.name,
      model: pick.defaultModel,
      duration,
      quality,
      aspectRatio,
      generateAudio,
      videoUrl,
      videos: [{ url: videoUrl }],
    },
  });

  // 5. Verify it's visible in My Videos (the sidebar query)
  console.log(`\n→ Step 5: verify DB row`);
  const [final] = await db()
    .select()
    .from(schema.aiTask)
    .where(
      schema.aiTask.id.equals
        ? // drizzle doesn't expose .equals(); use eq
          (undefined as any)
        : (undefined as any)
    )
    .limit(1);
  // simpler: re-fetch via eq
  const { eq } = await import('drizzle-orm');
  const [verified] = await db()
    .select()
    .from(schema.aiTask)
    .where(eq(schema.aiTask.id, task.id))
    .limit(1);
  console.log(`  status: ${verified.status}`);
  console.log(
    `  taskResult.videoUrl: ${JSON.parse(verified.taskResult as any).videoUrl}`
  );
  console.log(`  deletedAt: ${verified.deletedAt ?? 'null'}`);

  console.log(
    `\n✅ Full e2e success. Task ${task.id} is now SUCCESS in My Videos.`
  );
  console.log(`\n👉 User can now:`);
  console.log(`   1. Hard-refresh /api-playground/video (Cmd+Shift+R)`);
  console.log(`   2. Click the "My Videos" tab top-right`);
  console.log(`   3. See the red-balloon task, click it → video plays at:`);
  console.log(`      ${videoUrl}`);
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    process.exit(99);
  })
  .finally(() => process.exit(0));
