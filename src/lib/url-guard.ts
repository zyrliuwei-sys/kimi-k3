/**
 * Validate a user-supplied URL before the server acts on it (here: before we
 * ask a remote screenshot service to fetch it). The remote service does the
 * actual fetch from its own infra, so this guard isn't a hard SSRF firewall —
 * it's abuse/typo hygiene: block obviously local/private/loopback targets and
 * non-http(s) schemes. Deliberately sync and dependency-free (no `node:dns`)
 * so it runs identically on Node (dev) and Cloudflare Workers (prod).
 */

const PRIVATE_IPV4 = [
  /^127\./, // loopback
  /^0\./, // "this" network
  /^10\./, // private 10/8
  /^192\.168\./, // private 192.168/16
  /^172\.(1[6-9]|2\d|3[01])\./, // private 172.16/12
  /^169\.254\./, // link-local (incl. cloud metadata 169.254.169.254)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];

function isPrivateIpLiteral(host: string): boolean {
  // IPv4 literal.
  if (PRIVATE_IPV4.some((re) => re.test(host))) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.startsWith('127.')) {
    // Any other dotted-quad that isn't clearly public-reserved above still
    // passes; we only block the reserved ranges.
  }
  // IPv6 literal (strip brackets).
  const v = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (v === '::1' || v === '::') return true; // loopback / unspecified
  if (v.startsWith('fe80:')) return true; // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local fc00::/7
  return false;
}

/** Throw if `raw` isn't a public http(s) URL; otherwise return its normalized href. */
export function assertPublicUrl(raw: string): { href: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must use http or https');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateIpLiteral(host)
  ) {
    throw new Error('This URL host is not allowed');
  }
  return { href: url.href };
}
