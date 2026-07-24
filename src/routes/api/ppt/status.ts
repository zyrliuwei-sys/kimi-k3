import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getTask } from '@/modules/ppt/service';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/ppt/status?id=… — poll a generation task.
 *
 * Returns the latest row from the `ppt_task` table. The client watches
 * `status` (queued | outlining | writing | rendering | done | failed) and
 * `progress` (0..100) to drive the progress bar; when status === 'done' the
 * response also carries `resultUrl` to download.
 */

export const Route = createFileRoute('/api/ppt/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return respErr('Unauthorized', { status: 401 });
        }
        const url = new URL(request.url);
        const id = url.searchParams.get('id') || '';
        if (!id) return respErr('id is required', { status: 400 });
        const row = await getTask(session.user.id, id);
        if (!row) return respErr('Task not found', { status: 404 });
        return respData(row);
      },
    },
  },
});
