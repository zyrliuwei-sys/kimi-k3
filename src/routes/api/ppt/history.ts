import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { listTasks } from '@/modules/ppt/service';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/ppt/history — list the caller's recent PPT generation jobs.
 */

export const Route = createFileRoute('/api/ppt/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return respErr('Unauthorized', { status: 401 });
        }
        const rows = await listTasks(session.user.id, 20);
        return respData(rows);
      },
    },
  },
});
