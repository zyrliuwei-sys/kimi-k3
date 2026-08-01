/**
 * One-shot backfill: for every successful evolink-video task, fetch
 * the source mp4 (R2 rehosted if available, otherwise the raw evolink
 * URL), extract a 720-wide JPEG at the 0.5s mark, write it under
 * `public/uploads/video-posters/<id>.jpg`, and persist the public path
 * on the task row as `taskResult.posterUrl`. The frontend tile uses
 * this posterUrl as `<img src=...>` — Image-like rendering, no
 * `<video>` autoplay-policy pain.
 *
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/backfill-video-posters.ts --confirm
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';
import { parseTaskResult } from '../src/routes/api/ai-tasks/-shared';

async function ffmpegExtract(
  mp4Path: string,
  outPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      '0.5',
      '-i',
      mp4Path,
      '-vf',
      'scale=720:-2',
      '-frames:v',
      '1',
      '-q:v',
      '5',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(true);
      else {
        console.warn(`ffmpeg exit ${code}: ${stderr.slice(0, 200)}`);
        resolve(false);
      }
    });
  });
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`fetch ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(dest, buf);
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  const candidates = await db()
    .select()
    .from(schema.aiTask)
    .where(
      and(
        eq(schema.aiTask.provider, 'evolink-video'),
        eq(schema.aiTask.status, 'success')
      )
    );

  const need = candidates.filter(
    (t) => !parseTaskResult(t.taskResult)?.posterUrl
  );
  console.log(
    `Found ${candidates.length} success tasks; ${need.length} need a poster.`
  );

  if (need.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const tmp = await fs.mkdtemp(path.join(tmpdir(), 'poster-'));
  const outDir = path.resolve('public/uploads/video-posters');
  await fs.mkdir(outDir, { recursive: true });

  for (const t of need) {
    const stored = parseTaskResult(t.taskResult);
    // R2 rehosted URL is a publicly-readable CDN link, no auth needed.
    const sourceUrl = stored?.videoUrl || stored?.originalVideoUrl;
    if (!sourceUrl) {
      console.log(`  ${t.id} — no source URL, skipping.`);
      continue;
    }
    console.log(`  ${t.id} — extract from ${sourceUrl.slice(0, 80)}…`);

    let mp4Path: string | null = null;
    try {
      mp4Path = path.join(tmp, `${t.id}.mp4`);
      await fetchToFile(sourceUrl, mp4Path);
    } catch (e: any) {
      console.log(`    fetch failed: ${e?.message || e}`);
      continue;
    }

    const posterFilename = `${t.id}.jpg`;
    const posterTmp = path.join(tmp, posterFilename);
    const ok = await ffmpegExtract(mp4Path, posterTmp);
    if (!ok) {
      console.log(`    ffmpeg extract failed`);
      continue;
    }

    const finalPath = path.join(outDir, posterFilename);
    await fs.copyFile(posterTmp, finalPath);
    const posterUrl = `/uploads/video-posters/${posterFilename}`;
    console.log(
      `    wrote ${posterUrl} (${(await fs.stat(finalPath)).size} bytes)`
    );

    if (!confirm) {
      console.log(`    [dry-run] would persist taskResult.posterUrl`);
      continue;
    }
    const newTr = { ...stored, posterUrl };
    await db()
      .update(schema.aiTask)
      .set({ taskResult: JSON.stringify(newTr) })
      .where(eq(schema.aiTask.id, t.id));
    console.log(`    ✓ persisted posterUrl on ${t.id}`);
  }

  console.log(
    `\n${confirm ? 'Done.' : 'Dry-run only. Pass --confirm to apply.'}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
