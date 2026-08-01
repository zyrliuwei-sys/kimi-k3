/**
 * Comprehensive cleanup of stale video tasks. Hard-deletes (not soft) any
 * video task that isn't SUCCESS so they vanish from My Videos immediately.
 *
 * Usage:
 *   pnpm exec tsx scripts/with-env.ts tsx scripts/cleanup-stale-video-tasks.ts [--confirm]
 *
 * Without --confirm, only prints what it would delete.
 */
import { and, eq, inArray } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { AIMediaType } from '../src/core/ai';
import { db } from '../src/core/db';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const candidates = await db()
    .select()
    .from(schema.aiTask)
    .where(eq(schema.aiTask.mediaType, AIMediaType.VIDEO));

  console.log(`All video tasks across all users: ${candidates.length}`);
  for (const t of candidates) {
    let r: any = null;
    try {
      r =
        typeof t.taskResult === 'string'
          ? JSON.parse(t.taskResult)
          : t.taskResult;
    } catch {}
    console.log(
      `  ${t.status.padEnd(10)} user=${t.userId.slice(0, 8)} id=${t.id.slice(0, 8)} prompt="${(
        t.prompt || ''
      ).slice(0, 30)}"`
    );
  }

  if (candidates.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  if (!confirm) {
    console.log(
      '\nRefusing to delete without --confirm. Re-run with --confirm.'
    );
    return;
  }

  const ids = candidates.map((t) => t.id);
  const deleted = await db()
    .delete(schema.aiTask)
    .where(inArray(schema.aiTask.id, ids))
    .returning({ id: schema.aiTask.id });
  console.log(
    `\nHard-deleted ${deleted.length} video task(s) — sidebar should now be empty.`
  );
}

main().catch(console.error);
