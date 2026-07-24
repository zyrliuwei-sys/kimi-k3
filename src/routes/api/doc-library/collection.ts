import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from '@/modules/doc-library/service';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/doc-library/collection
 *
 *   GET    ? — list the caller's collections (newest first)
 *   POST   ? — create a new collection  { name, description? }
 *   PATCH  ?id=… — rename / re-describe  { name?, description? }
 *   DELETE ?id=… — delete a collection (cascades to docs + messages)
 *
 * All handlers require auth. Ownership is enforced inside the service.
 */

async function requireUser() {
  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: new Headers(),
  });
  if (!session?.user?.id) {
    return { error: respErr('Unauthorized', { status: 401 }) } as const;
  }
  return { userId: session.user.id } as const;
}

export const Route = createFileRoute('/api/doc-library/collection')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const rows = await listCollections(r.userId);
        return respData(rows);
      },

      POST: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          description?: string;
        };
        const name = (body.name || '').trim();
        if (!name) return respErr('name is required', { status: 400 });
        if (name.length > 100) {
          return respErr('name must be ≤ 100 characters', { status: 400 });
        }
        const row = await createCollection({
          userId: r.userId,
          input: { name, description: body.description?.trim() },
        });
        return respData(row);
      },

      PATCH: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const url = new URL(request.url);
        const id = url.searchParams.get('id') || '';
        if (!id) return respErr('id is required', { status: 400 });
        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          description?: string;
        };
        const patch: { name?: string; description?: string } = {};
        if (typeof body.name === 'string') {
          const n = body.name.trim();
          if (n.length === 0)
            return respErr('name cannot be empty', { status: 400 });
          if (n.length > 100) {
            return respErr('name must be ≤ 100 characters', { status: 400 });
          }
          patch.name = n;
        }
        if (typeof body.description === 'string') {
          patch.description = body.description.trim();
        }
        const row = await updateCollection(r.userId, id, patch);
        if (!row) return respErr('Collection not found', { status: 404 });
        return respData(row);
      },

      DELETE: async ({ request }) => {
        const r = await requireUser();
        if ('error' in r) return r.error;
        const url = new URL(request.url);
        const id = url.searchParams.get('id') || '';
        if (!id) return respErr('id is required', { status: 400 });
        const ok = await deleteCollection(r.userId, id);
        if (!ok) return respErr('Collection not found', { status: 404 });
        return respData({ id });
      },
    },
  },
});
