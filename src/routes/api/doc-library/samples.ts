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
          // Log the full error chain server-side so the operator can see the
          // raw Drizzle/SQLite message (including `error.cause`) without us
          // leaking SQL or bind params to the client.
          console.error('loadSamplesForUser failed:', e);
          // Surface a clean, actionable hint. The most common cause after a
          // recent schema change is forgetting to run `pnpm db:push` — the
          // libsql error then says "no such table: doc_collection".
          const cause = (e?.cause?.message || e?.message || '').toLowerCase();
          const hint = cause.includes('no such table')
            ? 'Database schema is out of date — run `pnpm db:push` to create the doc_collection tables.'
            : 'Please try again in a moment.';
          return respErr(`Failed to load samples. ${hint}`, { status: 500 });
        }
      },
    },
  },
});
