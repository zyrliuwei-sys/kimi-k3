/**
 * Quick connectivity test for the Seedance 2.0 text-to-video pipeline.
 * Reads the evolink_api_key from the DB configs (no auth needed — it
 * reads from the config table directly), then submits a single 3-second
 * 480p test job via EvolinkVideoProvider.submit().
 *
 * Does NOT deduct credits (only the route layer does that). Run:
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/test-seedance.ts
 */
import { EvolinkVideoProvider } from '@/core/ai/evolink-video';
import { db } from '@/core/db';
import { config } from '@/config/db/schema';

async function main() {
  console.log('=== Seedance 2.0 connectivity test ===\n');

  // 1. Read configs from DB.
  const rows = await db().select().from(config);
  const cfg: Record<string, string> = {};
  for (const r of rows) {
    if (r.name && r.value != null) cfg[r.name] = r.value;
  }

  const key = cfg.evolink_api_key || '';
  const base = cfg.evolink_base_url;
  const model = cfg.evolink_video_model || 'seedance-2.0-text-to-video';
  const enabled = cfg.seedance_video_enabled;

  console.log('configs found:', Object.keys(cfg).length, 'rows');
  console.log(
    '  evolink_api_key:',
    key
      ? `${key.slice(0, 4)}...${key.slice(-4)} (${key.length} chars)`
      : '❌ MISSING'
  );
  console.log(
    '  evolink_base_url:',
    base || '(default https://api.evolink.ai/v1)'
  );
  console.log('  evolink_video_model:', model);
  console.log('  seedance_video_enabled:', enabled ?? '(default true)');
  console.log('');

  if (!key) {
    console.error('❌ evolink_api_key not set — cannot test');
    process.exit(1);
  }
  if (enabled === 'false') {
    console.error(
      '❌ seedance_video_enabled = "false" — provider call still works, but the route will reject'
    );
  }

  // 2. Build provider exactly like the route does.
  const provider = new EvolinkVideoProvider({
    apiKey: key,
    baseUrl: base,
  });

  // 3. Submit a tiny test job: 3s, 480p, 16:9, no audio.
  const prompt =
    'a single red apple on a white table, soft studio lighting, gentle camera push-in';
  console.log('submitting test job…');
  console.log('  prompt:', prompt);
  console.log('  duration: 3s, quality: 480p, aspect: 16:9, audio: off\n');

  const t0 = Date.now();
  try {
    const result = await provider.submit({
      prompt,
      duration: 3,
      quality: '480p',
      aspectRatio: '16:9',
      generateAudio: false,
    });
    const dt = Date.now() - t0;
    console.log(`✅ submit OK in ${dt}ms`);
    console.log('  remoteTaskId:', result.taskId);
    console.log('  model:', result.model);
    console.log(
      '\n→ Video is now generating on Evolink. To check status, run:'
    );
    console.log(
      `   pnpm exec tsx scripts/with-env.ts tsx scripts/test-seedance-status.ts ${result.taskId}`
    );
  } catch (e: any) {
    const dt = Date.now() - t0;
    console.error(`❌ submit FAILED in ${dt}ms`);
    console.error('  message:', e?.message || String(e));
    if (e?.stack)
      console.error('  stack:', e.stack.split('\n').slice(0, 4).join('\n'));
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(99);
});
