/**
 * End-to-end audit: EvoLink response shape → DB column → list endpoint
 * normalization → frontend pickVideoUrls. Verify each link of the chain.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  console.log('=== STEP 1: 真实 DB 里 aiTask.taskResult 是什么样的 ===');
  const recent = await db()
    .select({
      id: schema.aiTask.id,
      status: schema.aiTask.status,
      taskResult: schema.aiTask.taskResult,
    })
    .from(schema.aiTask)
    .where(eq(schema.aiTask.provider, 'evolink-video'))
    .orderBy(desc(schema.aiTask.createdAt))
    .limit(3);

  for (const r of recent) {
    console.log(`\n--- ${r.id} (status=${r.status}) ---`);
    const tr =
      typeof r.taskResult === 'string'
        ? JSON.parse(r.taskResult)
        : r.taskResult;
    console.log('All top-level keys:', Object.keys(tr || {}));
    console.log(
      'tr.videoUrl =',
      typeof tr?.videoUrl,
      JSON.stringify(tr?.videoUrl)?.slice(0, 80)
    );
    console.log(
      'tr.originalVideoUrl =',
      typeof tr?.originalVideoUrl,
      JSON.stringify(tr?.originalVideoUrl)?.slice(0, 80)
    );
    console.log('tr.videos =', JSON.stringify(tr?.videos));
    console.log('tr.video_urls =', JSON.stringify(tr?.video_urls));
    console.log('tr.videoStorageKey =', tr?.videoStorageKey);
    console.log('tr.remoteTaskId =', tr?.remoteTaskId);
  }

  console.log('\n\n=== STEP 2: 我代码里的 parseTaskMedia 走的是哪个路径 ===');
  console.log('路径 A (优先): tr.videos (array of {url} | string)');
  console.log('路径 B: tr.video_urls');
  console.log('路径 C (fallback): typeof tr.videoUrl === "string" → push');

  console.log('\n=== STEP 3: 上面 DB 里的数据,parseTaskMedia 会输出什么 ===');
  for (const r of recent) {
    const tr =
      typeof r.taskResult === 'string'
        ? JSON.parse(r.taskResult)
        : r.taskResult;
    if (!tr) {
      console.log(`  ${r.id}: tr=null → videoUrls=[]`);
      continue;
    }
    const fromVideos = Array.isArray(tr.videos);
    const fromVideoUrls = Array.isArray(tr.video_urls);
    const fromVideoUrl = typeof tr.videoUrl === 'string' && tr.videoUrl;
    console.log(`  ${r.id}:`);
    console.log(`    videos[]? ${fromVideos ? 'YES (will use this)' : 'no'}`);
    console.log(
      `    video_urls[]? ${fromVideoUrls ? 'YES (will use this)' : 'no'}`
    );
    console.log(`    videoUrl str? ${fromVideoUrl ? 'YES (fallback)' : 'no'}`);
    console.log(
      `    → picked URL = ${fromVideos ? tr.videos.map((v: any) => (typeof v === 'string' ? v : v.url)).filter(Boolean)[0] : fromVideoUrls ? '(skipped)' : fromVideoUrl || '(empty)'}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message);
    process.exit(1);
  });
