import { drizzle } from 'drizzle-orm/d1';

// Minimal D1Database type to avoid pulling in @cloudflare/workers-types globally
type D1Database = {
  prepare(query: string): any;
  batch(statements: any[]): Promise<any[]>;
  exec(query: string): Promise<any>;
  dump(): Promise<ArrayBuffer>;
};

// D1 singleton instance
let d1DbInstance: ReturnType<typeof drizzle> | null = null;

function getD1Binding(): D1Database {
  throw new Error(
    'D1 database not supported in non-CloudflareWorkers environment.'
  );
}

export function createD1Db() {
  if (d1DbInstance) return d1DbInstance;

  const binding = getD1Binding();
  d1DbInstance = drizzle(binding);
  return d1DbInstance;
}
