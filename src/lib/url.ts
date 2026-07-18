import { envConfigs } from '@/config';

/**
 * Derive the public origin from the incoming request so SSR output
 * (canonical, og:url, JSON-LD, sitemap, robots) is always correct on the
 * deployed domain — independent of VITE_APP_URL, which defaults to localhost
 * until it is set in production.
 *
 * Reads the proxy headers Cloudflare / most platforms set
 * (x-forwarded-proto, x-forwarded-host), then the bare Host header, and falls
 * back to the configured app_url when none are present.
 */
export function originFromRequest(request: Request): string {
  const headers = request.headers;
  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const host = headers.get('x-forwarded-host') || headers.get('host') || '';
  return host ? `${proto}://${host}` : envConfigs.app_url;
}
