import handler from '@tanstack/react-start/server-entry';

import { paraglideMiddleware } from './paraglide/server.js';

// On Cloudflare Workers, stash the binding env (D1, ASSETS, …) on globalThis
// so synchronous code paths (e.g. the db() singleton with DATABASE_PROVIDER=d1)
// can reach bindings without threading the request context through every call.
// The specifier is kept non-literal so bundlers leave the import to runtime;
// outside workerd the import rejects and we just move on.
const CF_WORKERS_MODULE = 'cloudflare:workers';
let cfEnvPromise: Promise<void> | null = null;

function ensureCloudflareEnv(): Promise<void> {
  if (!cfEnvPromise) {
    cfEnvPromise = import(/* @vite-ignore */ CF_WORKERS_MODULE)
      .then((mod) => {
        (globalThis as any).__CF_ENV__ = mod.env;
      })
      .catch(() => {
        // Not running on Cloudflare Workers — nothing to stash.
      });
  }
  return cfEnvPromise;
}

// Custom server entry — wraps every request in Paraglide's middleware so
// getLocale() resolves per-request (AsyncLocalStorage) during SSR.
export default {
  async fetch(req: Request): Promise<Response> {
    // Bare apex → canonical www host (when the app URL is a www host).
    const url = new URL(req.url);
    const canonicalHost = new URL(import.meta.env.VITE_APP_URL || url.origin)
      .host;
    if (
      canonicalHost.startsWith('www.') &&
      url.host === canonicalHost.slice(4)
    ) {
      url.host = canonicalHost;
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    await ensureCloudflareEnv();
    return paraglideMiddleware(req, () => handler.fetch(req));
  },
};
