import { eq } from 'drizzle-orm';

import * as schema from '../src/config/db/schema';
import { db } from '../src/core/db';

async function main() {
  const userId = 'e4c35eef-7207-412d-80ae-c97142bb254e';
  const all = await db()
    .select()
    .from(schema.aiTask)
    .where(eq(schema.aiTask.userId, userId));
  for (const t of all) {
    if (t.mediaType !== 'video') continue;
    console.log(
      `  ${t.status} ${t.id.slice(0, 8)} deletedAt=${t.deletedAt?.toISOString?.() ?? 'null'}`
    );
  }
}
main();
