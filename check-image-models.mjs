#!/usr/bin/env node
// Re-probe all Evolink image models after the user topped up the account.
// Run with: pnpm tsx check-image-models.mjs
import { eq, or } from 'drizzle-orm';

import { config } from './src/config/db/schema.ts';
import { db } from './src/core/db/index.ts';

const rows = await db()
  .select()
  .from(config)
  .where(
    or(eq(config.name, 'evolink_api_key'), eq(config.name, 'evolink_base_url'))
  );
const cfgs = Object.fromEntries(rows.map((r) => [r.name, r.value]));
const apiKey = cfgs.evolink_api_key;
const baseUrl = (cfgs.evolink_base_url || 'https://api.evolink.ai/v1').replace(
  /\/$/,
  ''
);
if (!apiKey) {
  console.error('No evolink_api_key');
  process.exit(1);
}

console.log(`baseUrl: ${baseUrl}\n`);

// Fetch the live /v1/models list — narrower than asking one by one.
const listResp = await fetch(`${baseUrl}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const listData = await listResp.json().catch(() => ({}));
const ids = (listData?.data || [])
  .map((m) => m.id || m.name || m.model)
  .filter((s) => typeof s === 'string');

const IMAGE_HINTS = [
  'image',
  'img',
  'gpt-image',
  'dall-e',
  'sdxl',
  'sd-',
  'sd3',
  'flux',
  'imagen',
  'kandinsky',
  'midjourney',
  'firefly',
  'nano-banana',
  'seedream',
  'qwen-image',
  'grok-imagine',
];
const VIDEO_HINTS = ['video', 't2v', 'i2v'];
const TEXT_HINTS = [
  'gpt',
  'claude',
  'kimi',
  'chat',
  'embed',
  'whisper',
  'tts',
  'audio',
  'music',
  'transcribe',
  'realtime',
];

const notVideo = ids.filter(
  (m) => !VIDEO_HINTS.some((h) => m.toLowerCase().includes(h))
);
const strong = notVideo.filter((m) =>
  IMAGE_HINTS.some((h) => m.toLowerCase().includes(h))
);
const fallback = notVideo.filter(
  (m) => !TEXT_HINTS.some((h) => m.toLowerCase().includes(h))
);
const imageIds = strong.length ? strong : fallback;

console.log(`Image-filtered: ${imageIds.length} models\n`);

// Probe each — submit a tiny prompt and bucket by status.
const OK = [];
const IMG2IMG = [];
const INSUFFICIENT = [];
const OTHER = [];

for (const id of imageIds) {
  const r = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: id, prompt: 'a tiny black square', n: 1 }),
  });
  const text = await r.text().catch(() => '');
  let msg = '';
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message || j?.message || text.slice(0, 200);
  } catch {
    msg = text.slice(0, 200);
  }

  if (r.status === 200 || r.status === 202) {
    OK.push(id);
    console.log(`  ✓ ${id}`);
  } else if (r.status === 400 && /requires image input/i.test(msg)) {
    IMG2IMG.push(id);
    console.log(`  ◐ ${id}  (img2img only)`);
  } else if (r.status === 402 || /insufficient[_ ]?credits/i.test(msg)) {
    INSUFFICIENT.push(id);
    console.log(`  ✗ ${id}  (insufficient credits)`);
  } else {
    OTHER.push({ id, status: r.status, msg });
    console.log(`  ? ${id}  (${r.status}) ${msg.slice(0, 100)}`);
  }
}

console.log('\n=== Summary ===');
console.log(`✓ Usable (${OK.length}):`);
for (const id of OK) console.log(`    - ${id}`);
console.log(`\n◐ img2img-only (${IMG2IMG.length}):`);
for (const id of IMG2IMG) console.log(`    - ${id}`);
console.log(`\n✗ Insufficient credits (${INSUFFICIENT.length}):`);
for (const id of INSUFFICIENT) console.log(`    - ${id}`);
console.log(`\n? Other (${OTHER.length}):`);
for (const o of OTHER)
  console.log(`    - ${o.id}: ${o.status} ${o.msg.slice(0, 80)}`);

process.exit(0);
