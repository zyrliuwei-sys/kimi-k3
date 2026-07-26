import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuditReport } from '@/modules/website-audit';
import type { BenchmarkPayload } from '@/modules/website-audit/benchmark';
import { apiGet, apiPost } from '@/lib/api-client';

// ─── POST /api/website-audit (run audit) ────────────────────────────────

export interface CreateAuditResponse {
  taskId: string;
  report: AuditReport;
  cached: boolean;
  costCredits: number;
  reason: 'cache_hit' | 'first_free' | 'standard';
  benchmark: BenchmarkPayload | null;
}

// ─── POST /api/website-audit (run audit) ────────────────────────────────

export interface CreateAuditResponse {
  taskId: string;
  report: AuditReport;
  cached: boolean;
  costCredits: number;
  reason: 'cache_hit' | 'first_free' | 'standard';
  benchmark: BenchmarkPayload | null;
}

export function useCreateAudit(opts?: {
  onSuccess?: (r: CreateAuditResponse) => void;
  onError?: (e: Error) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { url: string }) => {
      return await apiPost<CreateAuditResponse>('/api/website-audit', vars);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['audit-history'] });
      opts?.onSuccess?.(data);
    },
    onError: (e: Error) => opts?.onError?.(e),
  });
}

// ─── GET /api/website-audit/:id (poll) ───────────────────────────────────

export type AuditTaskStatusResponse =
  | { status: 'pending' | 'processing' | 'failed' }
  | {
      status: 'success';
      report: AuditReport;
      benchmark: BenchmarkPayload | null;
    };

/**
 * Poll an in-flight audit task. `refetchInterval` adapts to terminal state —
 * once the task settles (success / failed) we stop polling so the cache
 * doesn't churn background requests.
 */
export function useAuditTask(taskId: string | null) {
  return useQuery({
    queryKey: ['audit-task', taskId],
    queryFn: async () => {
      if (!taskId) throw new Error('no_task');
      return await apiGet<AuditTaskStatusResponse>(
        `/api/website-audit/${encodeURIComponent(taskId)}`
      );
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'pending' || data.status === 'processing') {
        return 2000;
      }
      return false;
    },
    retry: 1,
  });
}
