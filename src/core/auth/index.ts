import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getUuid } from '@/lib/hash';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import { getDbConfigs } from '@/modules/config/service';
import * as schema from '@/config/db/schema';

function getDatabaseProvider(provider: string): 'sqlite' | 'pg' | 'mysql' {
  switch (provider) {
    case 'sqlite':
    case 'turso':
    case 'd1':
      return 'sqlite';
    case 'postgresql':
    case 'postgres':
      return 'pg';
    case 'mysql':
      return 'mysql';
    default:
      throw new Error(`Unsupported database provider for auth: ${provider}`);
  }
}

let authInstance: any;
let socialConfigsLoaded = false;

function getSocialProviders(configs: Record<string, string>) {
  const providers: Record<string, any> = {};

  if (configs.google_client_id && configs.google_client_secret) {
    providers.google = {
      clientId: configs.google_client_id,
      clientSecret: configs.google_client_secret,
    };
  }

  if (configs.github_client_id && configs.github_client_secret) {
    providers.github = {
      clientId: configs.github_client_id,
      clientSecret: configs.github_client_secret,
    };
  }

  return providers;
}

export function getAuth(configs?: Record<string, string>) {
  // Rebuild if social configs just became available
  if (configs && !socialConfigsLoaded) {
    const social = getSocialProviders(configs);
    if (Object.keys(social).length > 0) {
      authInstance = null;
      socialConfigsLoaded = true;
    }
  }

  if (authInstance) return authInstance;

  const socialProviders = configs ? getSocialProviders(configs) : {};

  authInstance = betterAuth({
    appName: envConfigs.app_name,
    baseURL: envConfigs.auth_url || envConfigs.app_url,
    secret: envConfigs.auth_secret,
    trustedOrigins: (request) => {
      const origins: string[] = [];
      if (envConfigs.app_url) origins.push(envConfigs.app_url);
      try {
        const origin = request?.headers?.get?.('origin');
        if (origin && new URL(origin).hostname === 'localhost') origins.push(origin);
      } catch {}
      return origins;
    },
    database: drizzleAdapter(db(), {
      provider: getDatabaseProvider(envConfigs.database_provider),
      schema,
    }),
    socialProviders,
    user: {
      additionalFields: {
        utmSource: { type: 'string', input: false, required: false, defaultValue: '' },
        ip: { type: 'string', input: false, required: false, defaultValue: '' },
        locale: { type: 'string', input: false, required: false, defaultValue: '' },
      },
    },
    advanced: {
      database: { generateId: () => getUuid() },
    },
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
  } satisfies BetterAuthOptions);

  return authInstance;
}
