// One-off data migration: Postgres (Neon) → Cloudflare D1.
//
// Reads every table from DATABASE_URL (postgres) and writes a SQLite INSERT
// script that matches src/config/db/schema.sqlite.ts — converting booleans to
// 0/1, timestamps to epoch seconds or ms (per column `mode`), and json to text.
//
// Usage:
//   npx tsx scripts/with-env.ts tsx scripts/export-pg-to-d1.ts <out.sql>
//   npx wrangler d1 execute <db-name> --remote --file=<out.sql>
//
// The output first DELETEs every table, so it is safe to re-run at cutover.
import { writeFileSync } from 'node:fs';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import postgres from 'postgres';

import * as schema from '../src/config/db/schema.sqlite';

const out = process.argv[2] || 'd1-data.sql';
const url = process.env.DATABASE_URL;
if (!url?.startsWith('postgres'))
  throw new Error('DATABASE_URL must be a postgres url');

const tables = Object.values(schema)
  .filter((t): t is SQLiteTable => t instanceof SQLiteTable)
  .map((t) => getTableConfig(t));

// Parents before children so foreign keys resolve.
const deps = new Map(
  tables.map((t) => [
    t.name,
    t.foreignKeys
      .map((fk) => getTableConfig(fk.reference().foreignTable).name)
      .filter((n) => n !== t.name),
  ])
);
const ordered: typeof tables = [];
const visit = (t: (typeof tables)[number], seen = new Set<string>()) => {
  if (ordered.includes(t) || seen.has(t.name)) return;
  seen.add(t.name);
  for (const d of deps.get(t.name)!)
    visit(tables.find((x) => x.name === d)!, seen);
  ordered.push(t);
};
tables.forEach((t) => visit(t));

function toEpoch(v: unknown, ms: boolean) {
  const d = v instanceof Date ? v : new Date(v as string);
  const t = d.getTime();
  if (Number.isNaN(t)) throw new Error(`bad timestamp: ${v}`);
  return String(ms ? t : Math.floor(t / 1000));
}

function lit(v: unknown, col: { columnType: string; mode?: string }) {
  if (v === null || v === undefined) return 'NULL';
  switch (col.columnType) {
    case 'SQLiteTimestamp':
      return toEpoch(v, col.mode === 'timestamp_ms');
    case 'SQLiteBoolean':
      return v === true || v === 't' || v === 1 ? '1' : '0';
    case 'SQLiteInteger':
    case 'SQLiteReal':
    case 'SQLiteNumeric':
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (v instanceof Date) return String(v.getTime());
      return String(Number(v));
  }
  const s =
    v instanceof Date
      ? v.toISOString()
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

const sql = postgres(url, { max: 1 });
const lines = ['PRAGMA defer_foreign_keys = true;'];
for (const t of [...ordered].reverse()) lines.push(`DELETE FROM "${t.name}";`);

for (const t of ordered) {
  const rows = await sql.unsafe(`select * from "${t.name}"`);
  const pgCols = rows.columns?.map((c) => c.name) ?? [];
  const missing = pgCols.filter((c) => !t.columns.some((x) => x.name === c));
  if (missing.length)
    console.warn(`! ${t.name}: PG-only columns dropped: ${missing}`);

  const cols = t.columns.filter((c) => pgCols.includes(c.name));
  const names = cols.map((c) => `"${c.name}"`).join(', ');
  for (const r of rows) {
    const vals = cols.map((c) => lit(r[c.name], c as never)).join(', ');
    lines.push(`INSERT INTO "${t.name}" (${names}) VALUES (${vals});`);
  }
  console.log(`${t.name}: ${rows.length}`);
}
await sql.end();

writeFileSync(out, lines.join('\n') + '\n');
console.log(`→ ${out}`);
