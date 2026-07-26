/**
 * POST /api/website-audit — start a new audit.
 *
 * Runs the full pipeline synchronously (URL → fetch → parse → LLM → persist).
 * For audit_llm_timeout ≤ 90s this fits inside the typical reverse-proxy
 * ceiling; we don't poll yet. If the LLM consistently takes >90s on large
 * pages, we'll graduate to an aiTask-based async flow in `runAudit`.
 *
 * Response shape:
 *   {
 *     taskId:     "…",          // ai_task.id (history record)
 *     report:     AuditReport,
 *     cached:     boolean,      // true = came from cache (0 credits)
 *     costCredits: number,
 *     reason:     "cache_hit" | "first_free" | "standard",
 *     benchmark:  Percentiles | null,
 *   }
 *
 * Errors come from `service.AuditError` and get mapped to user-friendly
 * i18n keys by the frontend; the API just returns the code + a short msg.
 */

import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import {
  AuditError,
  getBenchmarkIfEnabled,
  runAudit,
} from '@/modules/website-audit/service';
import { respData, respErr } from '@/lib/resp';

const FORBIDDEN_URL_RE = /^(file|javascript|data|gopher|ftp):/i;

async function POST({ request }: { request: Request }) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const body = await request.json().catch(() => ({}));
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!rawUrl) return respErr('url is required', { status: 400 });

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return respErr('invalid_url', { status: 400 });
    }
    if (FORBIDDEN_URL_RE.test(parsed.protocol)) {
      return respErr('protocol_blocked', { status: 400 });
    }

    const result = await runAudit({ userId: session.user.id, url: rawUrl });
    const benchmark = await getBenchmarkIfEnabled();

    return respData({
      taskId: result.taskId,
      report: result.report,
      cached: result.cached,
      costCredits: result.costCredits,
      reason: result.reason,
      benchmark,
    });
  } catch (e: any) {
    if (e instanceof AuditError) {
      const status = e.code === 'insufficient_credits' ? 402 : 400;
      return respErr(e.code, { status });
    }
    // Log full stack to the server console so we can debug "Cannot convert
    // undefined or null to object" reports without shipping a debugger.
    // eslint-disable-next-line no-console
    console.error('[audit-route] unhandled:', e?.stack || e?.message || e);
    // Map a few raw-error patterns that escape AuditError wrapping.
    const msg = String(e?.message || '');
    if (
      msg.includes('private_ip_blocked') ||
      msg.includes('dns_lookup_failed') ||
      msg.includes('protocol_blocked')
    ) {
      return respErr('ssrf', { status: 400 });
    }
    return respErr(msg || 'audit_failed', { status: 500 });
  }
}

export const Route = createFileRoute('/api/website-audit/')({
  server: { handlers: { POST } },
});
