/**
 * Website Auditor — global benchmark percentile.
 *
 * Pulls recent successful audits from `aiTask.taskResult` and computes the
 * p25/p50/p75 of `overall.score` plus each per-dimension score. The newest
 * report renders "Your SEO 78 — global median 62 (p75 = 84)" which is far
 * more persuasive than "Your SEO 78".
 *
 * We compute on-read and cache in-process (Node module cache). For multi-
 * instance deployments this should graduate to a memoized DB-backed table,
 * but v1 keeps it simple — a per-process TTL of 5 minutes.
 *
 * Caveats:
 *   - Until we have ≥ 10 historic reports the percentiles are noisy. We
 *     emit `null` percentiles in that case so the UI can hide the line
 *     instead of showing a misleading "you're above 0% of users".
 *   - The percentile set is global only — industry/region split is v2.
 */

import { and, desc, eq, gte, isNull } from 'drizzle-orm';

import { db } from '@/core/db';
import { aiTask } from '@/config/db/schema';

import type { AuditReport } from './schema';

const LOOKBACK_DAYS = 90;
const MIN_SAMPLE = 10;
const TTL_MS = 5 * 60 * 1000;
const MAX_SCAN = 500;

interface CachedPercentiles {
  fetchedAt: number;
  overall: { p25: number; p50: number; p75: number; sample: number };
  perDimension: Record<
    keyof AuditReport['sections'],
    { p25: number; p50: number; p75: number }
  >;
}

export interface BenchmarkPayload {
  fetchedAt: number;
  overall: { p25: number; p50: number; p75: number; sample: number };
  perDimension: Record<string, { p25: number; p50: number; p75: number }>;
}

let cache: CachedPercentiles | null = null;

export async function getGlobalBenchmarks(): Promise<CachedPercentiles | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const rows = await db()
    .select({ result: aiTask.taskResult })
    .from(aiTask)
    .where(
      and(
        eq(aiTask.mediaType, 'audit'),
        eq(aiTask.status, 'success'),
        isNull(aiTask.deletedAt),
        gte(aiTask.createdAt, since)
      )
    )
    .orderBy(desc(aiTask.createdAt))
    .limit(MAX_SCAN);

  const scores: number[] = [];
  const perDim: Record<string, number[]> = {
    seo: [],
    ui: [],
    performance: [],
    a11y: [],
    aiReadability: [],
    codeQuality: [],
    content: [],
  };

  for (const row of rows) {
    const result = row.result;
    if (!result) continue;
    let report: AuditReport;
    try {
      report =
        typeof result === 'string' ? JSON.parse(result) : (result as any);
    } catch {
      continue;
    }
    if (!report?.overall?.score) continue;
    scores.push(report.overall.score);
    if (report.sections) {
      for (const dim of Object.keys(perDim)) {
        const section = (report.sections as any)[dim];
        if (section && typeof section.score === 'number') {
          perDim[dim].push(section.score);
        }
      }
    }
  }

  if (scores.length < MIN_SAMPLE) {
    // Not enough sample size — invalidate any previous cache so we retry.
    cache = null;
    return null;
  }

  const perDimSafe = perDim ?? {};
  const result: CachedPercentiles = {
    fetchedAt: Date.now(),
    overall: {
      p25: percentile(scores, 25),
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      sample: scores.length,
    },
    perDimension: Object.fromEntries(
      Object.entries(perDimSafe).map(([k, v]) => {
        const list = Array.isArray(v) ? v : [];
        if (list.length < MIN_SAMPLE) {
          return [k, { p25: 0, p50: 0, p75: 0 }];
        }
        return [
          k,
          {
            p25: percentile(list, 25),
            p50: percentile(list, 50),
            p75: percentile(list, 75),
          },
        ];
      })
    ) as CachedPercentiles['perDimension'],
  };
  cache = result;
  return result;
}

/** Linear-interpolated percentile, 0–100. */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return Math.round(sorted[low] * (1 - weight) + sorted[high] * weight);
}

/** Invalidate the in-process cache. Exposed for tests / admin tooling. */
export function clearBenchmarkCache() {
  cache = null;
}
