/**
 * SSRF-safe HTTP fetch for the Website Auditor.
 *
 * What this defends against:
 *   - Server-side request forgery: user-supplied URL points at the host's
 *     private network (10/8, 172.16/12, 192.168/16, 169.254/16, IPv6
 *     link-local + ULA, loopback).
 *   - Redirect smuggling: target URL is public, but a 3xx sends us to a
 *     private hostname — we re-resolve + re-check on every hop.
 *   - Output amplification: a billion-byte response that OOMs the worker.
 *   - Slowloris: a misbehaving server that hangs the connection.
 *   - Non-HTTP schemes: file://, gopher://, javascript:.
 *
 * Platform notes:
 *   - On Node.js (dev, default deploy): we use `node:dns/promises.lookup` with
 *     `{ all: true }` so a hostname with a public AND private A record still
 *     fails closed (any private IP = blocked).
 *   - On Cloudflare Workers: the runtime already refuses `fetch()` to most
 *     private ranges via the `subrequests` policy; we still skip the explicit
 *     DNS check there to avoid pulling `node:dns` into the Workers bundle.
 *     Detect via `typeof process === 'undefined'` heuristic.
 *
 * Public API: `safeFetch(url, opts)` — returns body bytes + status + headers
 * + redirect chain. Throws on any guard violation; the API route wraps these
 * into user-facing error messages.
 */

// node:dns is server-only. We dynamically import inside `resolveHostIps`
// (which is only called on the server) rather than at module top, so a
// client bundle that imports this file accidentally doesn't pull a Node
// builtin into the browser.

// ─── Configuration ─────────────────────────────────────────────────────────

const DEFAULT_CONNECT_TIMEOUT_MS = 6_000;
const DEFAULT_READ_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; Kimik3Audit/1.0; +https://kimik3.com/bot)';

// ─── Private-IP test ───────────────────────────────────────────────────────

const IPV4_PATTERNS: RegExp[] = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // loopback
  /^169\.254\./, // link-local (incl. AWS / GCP metadata 169.254.169.254)
  /^0\./, // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
  /^198\.(1[8-9])\./, // benchmark testing
  /^192\.0\.(0|2)\./, // special use
  /^224\./, // multicast
];

const IPV6_PATTERNS: RegExp[] = [
  /^::1$/i, // loopback
  /^fe80:/i, // link-local
  /^fc[0-9a-f]{2}:/i, // unique local (fc00::/7)
  /^fd[0-9a-f]{2}:/i, // unique local
];

function isPrivateIpV4(ip: string): boolean {
  return IPV4_PATTERNS.some((re) => re.test(ip));
}

function isPrivateIpV6(ip: string): boolean {
  // Bracketed IPv6 literals come back as "[::1]" or with zone ids like
  // "fe80::1%eth0". Strip those for the test.
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0] || '';
  return IPV6_PATTERNS.some((re) => re.test(clean));
}

export function isPrivateIp(ip: string): boolean {
  return ip.includes(':') ? isPrivateIpV6(ip) : isPrivateIpV4(ip);
}

// ─── Host resolution ───────────────────────────────────────────────────────

const isNodeLike =
  typeof process !== 'undefined' &&
  typeof (process as any).versions !== 'undefined' &&
  typeof (process as any).versions.node === 'string';

/**
 * Resolve a hostname to all A/AAAA records. Returns the resolved IPs; throws
 * on DNS failure. On Workers (no `node:dns`), returns `null` to signal "skip
 * the explicit check, rely on the runtime's network policy".
 *
 * The dynamic import is intentional: a top-level `import { lookup } from
 * 'node:dns/promises'` would pull a Node-only module into any client bundle
 * that accidentally imports this file via the barrel. Vite externalizes
 * `node:dns` and the browser then errors with "module externalized for
 * browser compatibility". We only hit the import path in Node — workers
 * fall through to `null` first.
 */
async function resolveHostIps(hostname: string): Promise<string[] | null> {
  if (!isNodeLike) return null;
  if (hostname === 'localhost') return ['127.0.0.1'];
  let lookup: typeof import('node:dns/promises').lookup;
  try {
    ({ lookup } = await import('node:dns/promises'));
  } catch {
    // Not available in this runtime (e.g. Workers without socket support) →
    // defer to platform guard.
    return null;
  }
  try {
    const records = await lookup(hostname, { all: true });
    return records.map((r) => r.address);
  } catch {
    // DNS lookup failure is treated as "we cannot prove this host is safe" →
    // throw to fail closed rather than silently allowing.
    throw new Error(`dns_lookup_failed: ${hostname}`);
  }
}

async function assertSafeHostname(hostname: string): Promise<void> {
  const ips = await resolveHostIps(hostname);
  if (ips === null) return; // Workers — defer to platform guard
  if (!ips.length) throw new Error(`dns_empty: ${hostname}`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`private_ip_blocked: ${hostname} → ${ip}`);
    }
  }
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  maxRedirects?: number;
  maxBodyBytes?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  userAgent?: string;
  /** Hook for testing — replace the inner fetch. */
  fetcher?: typeof fetch;
}

export interface SafeFetchResult {
  /** URL after all redirects. */
  finalUrl: string;
  statusCode: number;
  contentType: string;
  /** All hops including the final response, in order. */
  redirectChain: { url: string; status: number }[];
  bodyBytes: Uint8Array;
  /** Headers from the final response, lowercased keys. */
  headers: Record<string, string>;
}

// ─── Main entry ────────────────────────────────────────────────────────────

export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = options.fetcher ?? fetch;

  let initialUrl: URL;
  try {
    initialUrl = new URL(input);
  } catch {
    throw new Error('invalid_url');
  }
  if (initialUrl.protocol !== 'http:' && initialUrl.protocol !== 'https:') {
    throw new Error(`protocol_blocked: ${initialUrl.protocol}`);
  }

  let currentUrl: string = initialUrl.toString();
  const chain: { url: string; status: number }[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    await assertSafeHostname(parsed.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connectTimeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    chain.push({ url: currentUrl, status: res.status });

    // 3xx — follow manually so each hop is re-validated.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to cancel */
      }
      if (!loc) throw new Error('redirect_without_location');
      const nextUrl = new URL(loc, currentUrl).toString();
      if (hop === maxRedirects) throw new Error('too_many_redirects');
      currentUrl = nextUrl;
      continue;
    }

    if (res.ok === false) throw new Error(`http_${res.status}`);

    // Read body with cap. We can't use res.arrayBuffer() directly because a
    // pathological 1 GB body would OOM us. Stream + cap instead.
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no_body');

    const readTimer = setTimeout(() => controller.abort(), readTimeoutMs);

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          total += value.byteLength;
          if (total > maxBodyBytes) {
            try {
              await reader.cancel();
            } catch {
              /* nothing */
            }
            throw new Error('body_too_large');
          }
          chunks.push(value);
        }
      }
    } finally {
      clearTimeout(readTimer);
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }

    const bodyBytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bodyBytes.set(c, offset);
      offset += c.byteLength;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    return {
      finalUrl: currentUrl,
      statusCode: res.status,
      contentType: headers['content-type'] ?? '',
      redirectChain: chain,
      bodyBytes,
      headers,
    };
  }

  throw new Error('too_many_redirects');
}
