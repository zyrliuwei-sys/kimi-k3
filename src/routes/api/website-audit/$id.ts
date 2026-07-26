/**
 * GET /api/website-audit/:id — fetch a previously started audit (poll endpoint).
 *
 * Owners only (token auth + same user). Returns:
 *   - { status: "pending"|"processing" } when in flight
 *   - { status: "failed" } when the task failed (credits already refunded)
 *   - { status: "success", report: AuditReport, benchmark } when ready
 */

import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { AITaskStatus, findTask } from '@/modules/ai-tasks/service';
import {
  getAuditReport,
  getBenchmarkIfEnabled,
} from '@/modules/website-audit/service';
import { respData, respErr } from '@/lib/resp';

async function GET({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respErr('Unauthorized', { status: 401 });

    const task = await findTask(params.id);
    if (!task || task.userId !== session.user.id) {
      return respErr('Task not found', { status: 404 });
    }

    if (
      task.status === AITaskStatus.PENDING ||
      task.status === AITaskStatus.PROCESSING
    ) {
      return respData({ status: task.status });
    }

    if (task.status === AITaskStatus.FAILED) {
      return respData({ status: 'failed' });
    }

    if (task.status !== AITaskStatus.SUCCESS) {
      return respData({ status: task.status });
    }

    const report = await getAuditReport(task.id, session.user.id);
    if (!report) return respErr('Report unavailable', { status: 500 });
    const benchmark = await getBenchmarkIfEnabled();
    return respData({ status: 'success', report, benchmark });
  } catch (e: any) {
    return respErr(e?.message || 'Failed to load audit', { status: 500 });
  }
}

export const Route = createFileRoute('/api/website-audit/$id')({
  server: { handlers: { GET } },
});
