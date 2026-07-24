import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { streamAsk } from '@/modules/doc-library/service';
import { respErr } from '@/lib/resp';

/**
 * /api/doc-library/ask — streaming cross-document Q&A.
 *
 * Request: POST application/json
 *   { collectionId: string, question: string }
 *
 * Response: `text/event-stream` with one JSON object per `data:` frame.
 *   { t:'delta',    text }       — incremental reply text
 *   { t:'sources',  sources }    — { docId, filename, page, quote }[]
 *   { t:'done' }                  — final
 *   { t:'error',    message }     — terminal failure
 *
 * Auth: requires a signed-in user. Anonymous visitors are rejected with 401
 * via the `error` frame (so the client stays on the same SSE consumer).
 *
 * Credits: 1 credit per question (subscribed user) — consumed at the start
 * of the stream via the standard `consumeMessage` quota hook, mirroring the
 * playground chat endpoint.
 */

export const Route = createFileRoute('/api/doc-library/ask')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return respErr('Unauthorized', { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          collectionId?: string;
          question?: string;
        };
        const collectionId = (body.collectionId || '').trim();
        const question = (body.question || '').trim();
        if (!collectionId) {
          return respErr('collectionId is required', { status: 400 });
        }
        if (!question) {
          return respErr('question is required', { status: 400 });
        }
        if (question.length > 4000) {
          return respErr('question is too long (max 4000 chars)', {
            status: 400,
          });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const emit = (obj: Record<string, unknown>) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
              );
            try {
              for await (const evt of streamAsk(
                {
                  userId: session.user.id,
                  collectionId,
                  question,
                },
                request.signal
              )) {
                if (
                  evt.type === 'error' &&
                  evt.message === 'payment_required'
                ) {
                  // Re-map internal code to a stable wire string for the
                  // client's `payment_required` branch.
                  emit({ t: 'error', message: 'payment_required' });
                  continue;
                }
                emit(evt as Record<string, unknown>);
                if (evt.type === 'error' || evt.type === 'done') break;
              }
            } catch (e: any) {
              emit({ t: 'error', message: e?.message || 'Stream failed' });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      },
    },
  },
});
