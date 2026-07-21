import { md5 } from './hash';

type MinIntervalOptions = {
  intervalMs: number;
  keyPrefix?: string;
  extraKey?: string;
};

type Store = Map<string, number>;

declare global {
  var __minIntervalRateLimitStore: Store | undefined;
}

function getClientIpFromRequest(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || '';
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    ''
  );
}

function getStore(): Store {
  if (!globalThis.__minIntervalRateLimitStore) {
    globalThis.__minIntervalRateLimitStore = new Map();
  }
  return globalThis.__minIntervalRateLimitStore;
}

function buildKey(request: Request, opts: MinIntervalOptions): string {
  const url = new URL(request.url);
  const ip = getClientIpFromRequest(request);
  const cookie = request.headers.get('cookie') || '';
  const cookieHash = cookie ? md5(cookie) : 'no-cookie';
  const prefix = opts.keyPrefix || 'min-interval';
  const extra = opts.extraKey ? `|${opts.extraKey}` : '';
  return `${prefix}|${request.method}|${url.pathname}|${ip}|${cookieHash}${extra}`;
}

export function enforceMinIntervalRateLimit(
  request: Request,
  opts: MinIntervalOptions
): Response | null {
  const intervalMs = Math.max(0, Number(opts.intervalMs) || 0);
  if (!intervalMs) return null;
  const now = Date.now();
  const store = getStore();
  const key = buildKey(request, opts);
  const last = store.get(key);
  if (typeof last === 'number') {
    const delta = now - last;
    if (delta >= 0 && delta < intervalMs) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((intervalMs - delta) / 1000)
      );
      return Response.json(
        {
          error: 'too_many_requests',
          message: `Please retry after ${retryAfterSeconds}s.`,
        },
        {
          status: 429,
          headers: {
            'cache-control': 'no-store',
            'retry-after': String(retryAfterSeconds),
          },
        }
      );
    }
  }
  store.set(key, now);
  return null;
}

type IpQuotaOptions = {
  limit: number;
  keyPrefix?: string;
};

/**
 * Counting quota per browser/IP. Returns `{ exceeded: true }` once the caller
 * has hit `limit` allowed calls in this process; otherwise increments and
 * allows. Like the min-interval limiter this is in-memory (per-instance) and
 * keyed on IP + cookie hash, so it's a soft gate — enough to nudge casual
 * anonymous users toward sign-up, not a hard anti-abuse wall.
 */
export function checkIpQuota(
  request: Request,
  opts: IpQuotaOptions
): { exceeded: boolean; count: number; limit: number } {
  const limit = Math.max(0, Math.floor(opts.limit));
  const ip = getClientIpFromRequest(request);
  const cookie = request.headers.get('cookie') || '';
  const cookieHash = cookie ? md5(cookie) : 'no-cookie';
  const key = `${opts.keyPrefix || 'ip-quota'}|${ip}|${cookieHash}`;

  const store = getStore();
  const current = store.get(key) || 0;
  if (current >= limit) {
    return { exceeded: true, count: current, limit };
  }
  store.set(key, current + 1);
  return { exceeded: false, count: current + 1, limit };
}
