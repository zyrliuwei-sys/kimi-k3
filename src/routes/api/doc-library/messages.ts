import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { deleteAllMessages, listMessages } from '@/modules/doc-library/service';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/doc-library/messages
 *
 *   GET    ?collectionId=…  — return the chat history (newest first,
 *                             limit 200) for a collection.
 *   DELETE ?collectionId=…  — wipe the chat history. Documents and the
 *                             collection itself are preserved.
 */

async function requireUser() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: new Headers() });
  if (!session?.user?.id) {
    return { error: respErr('Unauthorized', { status: 401 }) } as const;
  }
  return { userId: session.user.id } as const;
}

export const Route = createFileRoute('/api/doc-library/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const url = new URL(request.url);
        const collectionId = url.searchParams.get('collectionId') || '';
        if (!collectionId) {
          return respErr('collectionId is required', { status: 400 });
        }
        const rows = await listMessages(r.userId, collectionId);
        if (rows === null) {
          return respErr('Collection not found', { status: 404 });
        }
        // Newest-first is what the list returned; reverse so the client gets
        // oldest-first (chronological) which is the natural chat order.
        return respData(rows.slice().reverse());
      },

      DELETE: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const url = new URL(request.url);
        const collectionId = url.searchParams.get('collectionId') || '';
        if (!collectionId) {
          return respErr('collectionId is required', { status: 400 });
        }
        const ok = await deleteAllMessages(r.userId, collectionId);
        if (!ok) return respErr('Collection not found', { status: 404 });
        return respOk();
      },
    },
  },
});

// Tiny helper to avoid an extra import.
function respOk() {
  return Response.json({ code: 0, message: 'ok' });
}
