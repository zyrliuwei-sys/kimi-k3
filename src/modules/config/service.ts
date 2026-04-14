import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { config } from '@/config/db/schema';
import { envConfigs } from '@/config';

type ConfigMap = Record<string, string>;

// In-memory cache
let cachedConfigs: ConfigMap | null = null;
let cacheTime = 0;
const CACHE_TTL = 3600_000; // 1 hour

/**
 * Get all configs from database.
 */
export async function getDbConfigs(): Promise<ConfigMap> {
  const now = Date.now();
  if (cachedConfigs && now - cacheTime < CACHE_TTL) {
    return cachedConfigs;
  }

  try {
    if (!envConfigs.database_url && envConfigs.database_provider !== 'd1') {
      return {};
    }

    const rows = await db().select().from(config);
    const result: ConfigMap = {};
    for (const row of rows) {
      if (row.name && row.value) {
        result[row.name] = row.value;
      }
    }

    cachedConfigs = result;
    cacheTime = now;
    return result;
  } catch {
    return {};
  }
}

/**
 * Get all configs merged: env + database (database overrides env).
 */
export async function getAllConfigs(): Promise<ConfigMap> {
  const dbConfigs = await getDbConfigs();
  return { ...envConfigs, ...dbConfigs };
}

/**
 * Save multiple configs to database (upsert).
 */
export async function saveConfigs(configs: ConfigMap) {
  await db().transaction(async (tx: any) => {
    for (const [name, value] of Object.entries(configs)) {
      const [existing] = await tx
        .select()
        .from(config)
        .where(eq(config.name, name))
        .limit(1);

      if (existing) {
        await tx.update(config).set({ value }).where(eq(config.name, name));
      } else {
        await tx.insert(config).values({ name, value });
      }
    }
  });

  // Invalidate cache
  cachedConfigs = null;
  cacheTime = 0;
}

/**
 * Get a single config value.
 */
export async function getConfig(name: string): Promise<string | undefined> {
  const configs = await getAllConfigs();
  return configs[name];
}

/**
 * Filter configs to only include public-safe keys.
 */
export function filterPublicConfigs(configs: ConfigMap, publicKeys: string[]): ConfigMap {
  const result: ConfigMap = {};
  for (const key of publicKeys) {
    if (configs[key]) {
      result[key] = configs[key];
    }
  }
  return result;
}
