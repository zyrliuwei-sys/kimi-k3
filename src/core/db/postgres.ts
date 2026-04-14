import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { DbConfig } from './types';

const isCloudflareWorker =
  typeof globalThis !== 'undefined' && 'Cloudflare' in globalThis;

// Global database connection instance (singleton pattern)
let dbInstance: ReturnType<typeof drizzle> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function createPostgresDb(config: DbConfig) {
  let databaseUrl = config.database_url;

  let isHyperdrive = false;
  const schemaName = (config.db_schema || 'public').trim();
  const connectionSchemaOptions =
    schemaName && schemaName !== 'public'
      ? { connection: { options: `-c search_path=${schemaName}` } }
      : {};

  if (isCloudflareWorker) {
    const { env }: { env: any } = { env: {} };
    // Detect if set Hyperdrive
    isHyperdrive = 'HYPERDRIVE' in env;

    if (isHyperdrive) {
      const hyperdrive = env.HYPERDRIVE;
      databaseUrl = hyperdrive.connectionString;
    }
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  // In Cloudflare Workers, create new connection each time
  if (isCloudflareWorker) {
    const client = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 10,
      connect_timeout: 5,
      ...connectionSchemaOptions,
    });

    return drizzle(client);
  }

  // Singleton mode: reuse existing connection
  if (config.db_singleton_enabled === 'true') {
    if (dbInstance) {
      return dbInstance;
    }

    client = postgres(databaseUrl, {
      prepare: false,
      max: Number(config.db_max_connections) || 1,
      idle_timeout: 30,
      connect_timeout: 10,
      ...connectionSchemaOptions,
    });

    dbInstance = drizzle({ client });
    return dbInstance;
  }

  // Non-singleton mode: create new connection each time
  const serverlessClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ...connectionSchemaOptions,
  });

  return drizzle({ client: serverlessClient });
}

export async function closePostgresDb(config: DbConfig) {
  if (config.db_singleton_enabled && client) {
    await client.end();
    client = null;
    dbInstance = null;
  }
}
