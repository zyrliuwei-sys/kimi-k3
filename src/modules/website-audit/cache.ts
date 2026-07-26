/**
 * Website Auditor — URL cache.
 *
 * Caches the latest report by a normalized URL hash so a re-audit (e.g. the
 * same user retries after a fix, or two users audit the same site) returns
 * instantly without re-running the LLM. Cache hit = 0 credit deduction.
 *
 * Normalization rules:
 *   - lowercased scheme + host
 *   - strip tracking query params (utm_*, fbclid, gclid, ref, mc_*, _hsenc, _hsmi, mkt_tok)
 *   - drop the fragment
 *   - keep path; collapse repeated slashes
 *
 * Hash: SHA-256 of the normalized URL, hex-encoded.
 *
 * Storage: the `audit_cache` table (added to the schema by Phase 1.3).
 * key = url_hash, value = the raw AuditReport JSON. We intentionally store
 * the full report rather than re-running the LLM — a freshly fetched
 * report is a richer asset than the URL itself.
 */

import { createHash } from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';

import { db } from '@/core/db';
import { auditCache } from '@/config/db/schema';

import type { AuditReport } from './schema';

// ────────────────────────────────────────────────────────────────────────────
// URL normalization & hashing
// ────────────────────────────────────────────────────────────────────────────

const TRACKING_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gclsrc',
  'msclkid',
  'dclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'yclid',
  'igshid',
  'vero_id',
  'vero_conv',
  'trk',
  'trkCampaign',
]);

function isTrackingKey(key: string): boolean {
  return TRACKING_KEYS.has(key) || key.startsWith('utm_');
}

/** Normalize a URL for cache key purposes. Doesn't validate — caller does. */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input.trim();
  }
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.port === '80' || url.port === '443' || url.port === '') {
    url.port = '';
  }
  const params = url.searchParams;
  const keep: [string, string][] = [];
  const seen = new Set<string>();
  // Iterate in original order — sort by key for stable hashing.
  const sortedKeys = [...new Set(params.keys())].sort();
  for (const key of sortedKeys) {
    if (isTrackingKey(key)) continue;
    // Preserve duplicate keys (e.g. ?tag=a&tag=b carries meaning).
    const values = params.getAll(key);
    if (values.length === 0) continue;
    const composite = `${key}=${values.join('&')}`;
    if (seen.has(composite)) continue;
    seen.add(composite);
    keep.push([key, values.join(',')]);
  }
  const query = keep
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const path = url.pathname.replace(/\/{2,}/g, '/');
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname}${port}${path}${query ? `?${query}` : ''}`;
}

export function computeUrlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

export function hashUrl(input: string): { normalized: string; hash: string } {
  const normalized = normalizeUrl(input);
  return { normalized, hash: computeUrlHash(normalized) };
}

// ────────────────────────────────────────────────────────────────────────────
// Cache get / set / invalidate
// ────────────────────────────────────────────────────────────────────────────

export async function getCachedReport(
  urlHash: string
): Promise<{ report: AuditReport; fetchedAt: Date } | null> {
  const rows = await db()
    .select()
    .from(auditCache)
    .where(
      and(
        eq(auditCache.urlHash, urlHash),
        gte(auditCache.expiresAt, new Date())
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  let report: AuditReport;
  try {
    report =
      typeof row.reportJson === 'string'
        ? JSON.parse(row.reportJson)
        : (row.reportJson as unknown as AuditReport);
  } catch {
    return null;
  }
  return { report, fetchedAt: row.fetchedAt };
}

export async function setCachedReport(params: {
  url: string;
  urlHash: string;
  report: AuditReport;
  ttlDays: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + params.ttlDays * 86_400_000);
  await db()
    .insert(auditCache)
    .values({
      urlHash: params.urlHash,
      url: params.url,
      reportJson: JSON.stringify(params.report),
      fetchedAt: new Date(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: auditCache.urlHash,
      set: {
        url: params.url,
        reportJson: JSON.stringify(params.report),
        fetchedAt: new Date(),
        expiresAt,
      },
    });
}

export async function invalidateCachedReport(urlHash: string): Promise<void> {
  await db().delete(auditCache).where(eq(auditCache.urlHash, urlHash));
}
