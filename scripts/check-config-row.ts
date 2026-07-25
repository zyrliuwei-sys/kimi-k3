import { sql } from 'drizzle-orm';

import { config } from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';

async function main() {
  const db = dbFn();
  const rows = await db.select().from(config);
  console.log(`Total config rows: ${rows.length}`);
  console.log('\nAll rows:');
  for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    const val = r.value
      ? r.value.length > 60
        ? r.value.slice(0, 60) + '…'
        : r.value
      : 'NULL';
    console.log(`  ${r.name} = ${val}`);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
