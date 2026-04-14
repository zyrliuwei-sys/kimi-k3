import { createDb } from './create-db';
import { envConfigs } from '@/config';

let dbInstance: any = null;

export function db() {
  if (dbInstance) return dbInstance;

  dbInstance = createDb({
    database_provider: envConfigs.database_provider,
    database_url: envConfigs.database_url || 'file:data/local.db',
    database_auth_token: envConfigs.database_auth_token || undefined,
    db_schema: envConfigs.db_schema,
    db_singleton_enabled: envConfigs.db_singleton_enabled,
    db_max_connections: envConfigs.db_max_connections,
  });

  return dbInstance;
}

export type { DbConfig } from './types';
export { createDb, closeDb } from './create-db';
