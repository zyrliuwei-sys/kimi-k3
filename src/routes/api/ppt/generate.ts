import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { generateDeck, type GenerateInput } from '@/modules/ppt/service';
import { respData, respErr } from '@/lib/resp';

/**
 * /api/ppt/generate
 *
 *   POST — kick off a generation. The request blocks until the deck is
 *          done (up to ~60s depending on K3 latency + slide count), then
 *          returns the persisted task row including the download URL.
 *   GET  — alias of /api/ppt/status?…
 */

const MAX_SLIDES = 30;
const MIN_SLIDES = 5;

export const Route = createFileRoute('/api/ppt/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = getAuth();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return respErr('Unauthorized', { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as {
          title?: string;
          topic?: string;
          prompt?: string;
          templateId?: string;
          slideCount?: number;
          sourceType?: 'empty' | 'text' | 'doc_collection';
          sourceText?: string;
          sourceCollectionId?: string;
        };

        // eslint-disable-next-line no-console
        console.log('[ppt/generate] request body:', body);

        const title = (body.title || '').trim();
        if (!title) return respErr('title is required', { status: 400 });
        if (title.length > 120) {
          return respErr('title must be ≤ 120 characters', { status: 400 });
        }

        const slideCount = clamp(
          Number(body.slideCount) || 15,
          MIN_SLIDES,
          MAX_SLIDES
        );

        const sourceType = body.sourceType || 'empty';
        if (
          sourceType !== 'empty' &&
          sourceType !== 'text' &&
          sourceType !== 'doc_collection'
        ) {
          return respErr('Invalid sourceType', { status: 400 });
        }

        const input: GenerateInput = {
          userId: session.user.id,
          title,
          topic: body.topic?.trim() || title,
          prompt: body.prompt?.trim() || '',
          templateId: body.templateId || 'biz-dark',
          slideCount,
          sourceType,
          sourceText: body.sourceText?.slice(0, 100_000),
          sourceCollectionId: body.sourceCollectionId,
        };

        if (sourceType === 'doc_collection' && !body.sourceCollectionId) {
          return respErr('sourceCollectionId is required for doc_collection', {
            status: 400,
          });
        }

        try {
          // eslint-disable-next-line no-console
          console.log(
            '[ppt/generate] starting generation for',
            session.user.id
          );
          const row = await generateDeck(input);
          // eslint-disable-next-line no-console
          console.log(
            '[ppt/generate] done, taskId =',
            row.id,
            'status =',
            row.status
          );
          return respData(row);
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.error('[ppt/generate] threw:', e?.message, e?.code, e?.stack);
          if (e?.code === 'payment_required') {
            return respErr('payment_required', { status: 402 });
          }
          if (e?.message?.includes('No AI provider configured')) {
            return respErr(e.message, { status: 503 });
          }
          return respErr(e?.message || 'Generation failed', { status: 500 });
        }
      },
    },
  },
});

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
