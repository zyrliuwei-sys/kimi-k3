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

export function getClientIpFromRequest(request: Request): string {
  // Behind Cloudflare, CF-Connecting-IP is the authoritative client IP and
  // cannot be spoofed — Cloudflare overwrites any caller-supplied value. It
  // MUST be checked before X-Forwarded-For: XFF is a client-appendable chain,
  // so trusting it first let an attacker rotate the header to dodge per-IP
  // rate limits and anonymous quotas on every endpoint using this helper.
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || '';
  return '';
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
  // Key on IP only — no cookie. The cookie hash used to be mixed in so several
  // people behind one NAT IP each got their own quota, but the cookie is
  // client-supplied and rotatable: an attacker cycling cookies could reset the
  // budget and burn unlimited free messages from a single IP. For a free-taste
  // gate the per-IP budget is the abuse-resistant choice (relies on the
  // now-unspoofable CF-Connecting-IP resolved above).
  const ip = getClientIpFromRequest(request);
  const key = `${opts.keyPrefix || 'ip-quota'}|${ip}`;

  const store = getStore();
  const current = store.get(key) || 0;
  if (current >= limit) {
    return { exceeded: true, count: current, limit };
  }
  store.set(key, current + 1);
  return { exceeded: false, count: current + 1, limit };
}

// ─── QQ-email attempt cooldown ───────────────────────────────────────────────
//
// After QQ_ATTEMPT_LIMIT blocked QQ-email signup attempts from the same
// client IP within QQ_ATTEMPT_WINDOW_MS, that IP is locked out of ALL
// signup attempts for QQ_COOLDOWN_MS. The 24h cool-off makes scripted
// abuse with rotating QQ aliases uneconomical while still letting a
// curious real user through the next day.
//
// Like the other limiters in this file the store is per-process; on
// Cloudflare Workers each request gets a fresh Map so the cross-request
// state is effectively lost. Acceptable today (deployment runs on
// Node + Neon) and matches the existing rate-limit pattern; revisit
// with KV / D1 if / when we move signup to Workers.

const QQ_ATTEMPT_LIMIT = 5;
const QQ_ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // 1h sliding window
const QQ_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h lockout

type QqAttemptState = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

function getQqAttemptState(ip: string): QqAttemptState {
  const store = getStore();
  const key = `qq-attempt|${ip}`;
  const now = Date.now();
  const existing = store.get(key) as QqAttemptState | undefined;
  if (!existing || now - existing.windowStart > QQ_ATTEMPT_WINDOW_MS) {
    const fresh: QqAttemptState = {
      count: 0,
      windowStart: now,
      blockedUntil: 0,
    };
    store.set(key, fresh);
    return fresh;
  }
  return existing;
}

/**
 * Check whether the client IP is currently in the QQ-attempt cooldown.
 * Returns a 429 Response when locked out, or null when the request may
 * proceed. Caller is expected to short-circuit on a non-null return.
 */
export function enforceQqAttemptCooldown(
  request: Request,
  message: string
): Response | null {
  const ip = getClientIpFromRequest(request);
  if (!ip) return null;
  const state = getQqAttemptState(ip);
  const now = Date.now();
  if (state.blockedUntil > now) {
    const retryAfter = Math.max(
      1,
      Math.ceil((state.blockedUntil - now) / 1000)
    );
    return Response.json(
      { message },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(retryAfter),
        },
      }
    );
  }
  return null;
}

/**
 * Bump the QQ-attempt counter for the client IP. If the counter crosses
 * QQ_ATTEMPT_LIMIT inside the current 1h window, the IP is flagged for
 * a 24h cooldown that the next enforceQqAttemptCooldown() call will
 * surface. Call this only on QQ-email blocks (not on every signup) so
 * legitimate signups from the same IP don't poison the counter.
 */
export function recordQqAttempt(request: Request): void {
  const ip = getClientIpFromRequest(request);
  if (!ip) return;
  const state = getQqAttemptState(ip);
  state.count += 1;
  if (state.count >= QQ_ATTEMPT_LIMIT) {
    state.blockedUntil = Date.now() + QQ_COOLDOWN_MS;
  }
}
