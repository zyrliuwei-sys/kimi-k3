import postgres from 'postgres';

const url = process.env.DATABASE_URL || '';
console.log('URL length:', url.length);
console.log('Has sslmode:', url.includes('sslmode=require'));

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 10,
  connect_timeout: 15,
  ssl: 'require',
});
sql`select 1 as ok`
  .then((r) => {
    console.log('OK:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error('ERR:', e.message);
    console.error('code:', (e as any).code);
    process.exit(1);
  });
