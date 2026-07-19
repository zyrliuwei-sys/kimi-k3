/**
 * Temporary probe: reproduce the prod get-session DB failure locally with
 * full stack traces. Run: pnpm exec tsx scripts/with-env.ts tsx scripts/probe-db.ts
 */
import { sql } from 'drizzle-orm';

import { db } from '@/core/db';
import * as schema from '@/config/db/schema';

async function main() {
  const url = process.env.DATABASE_URL || '';
  console.log('PROVIDER:', process.env.DATABASE_PROVIDER);
  console.log('URL:', url ? url.replace(/:[^:@]+@/, ':***@') : '(empty)');

  // 1. raw connection
  try {
    const r = (await db().execute(sql`SELECT 1 AS ok`)) as any[];
    console.log('✅ raw SELECT 1 ->', r?.[0]);
  } catch (e) {
    console.error('❌ raw SELECT 1 FAILED:', e);
    process.exit(1);
  }

  // 2. which tables exist?
  try {
    const tables = (await db().execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema() ORDER BY table_name`
    )) as any[];
    const names = tables.map((r) => r.table_name).filter(Boolean);
    console.log('📋 tables:', names.join(', ') || '(none)');
    const need = ['user', 'session', 'account', 'verification', 'config'];
    const missing = need.filter((t) => !names.includes(t));
    console.log(
      missing.length
        ? '❌ MISSING tables: ' + missing.join(', ')
        : '✅ all auth/config tables present'
    );
  } catch (e) {
    console.error('❌ listing tables FAILED:', e);
  }

  // 3. getDbConfigs query (runs first in the auth handler)
  try {
    const rows = await db().select().from(schema.config);
    console.log('✅ select from config ->', rows.length, 'rows');
  } catch (e) {
    console.error('❌ select from config FAILED:', e);
  }

  // 4. the session query that get-session performs
  try {
    const rows = await db().select().from(schema.session).limit(1);
    console.log('✅ select from session ->', rows.length, 'rows');
  } catch (e) {
    console.error('❌ select from session FAILED:', e);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
