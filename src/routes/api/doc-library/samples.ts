import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { loadSamplesForUser } from '@/modules/doc-library/samples';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/doc-library/samples
 *
 *   POST — load pre-baked sample collections for the current user.
 *          Idempotent: a second call returns 0 / 0 if the samples are
 *          already present. Used by the empty-state CTA in the sidebar.
 */

export const Route = createFileRoute('/api/doc-library/samples')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return respErr('Unauthorized', { status: 401 });
        }
        try {
          const result = await loadSamplesForUser(session.user.id);
          return respData(result);
        } catch (e: any) {
          return respErr(e?.message ?? 'Failed to load samples', {
            status: 500,
          });
        }
      },
    },
  },
});
