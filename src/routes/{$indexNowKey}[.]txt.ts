import { createFileRoute } from '@tanstack/react-router';

import { getAllConfigs } from '@/modules/config/service';
import { isValidIndexNowKey } from '@/modules/indexnow/service';

/**
 * IndexNow ownership proof. The protocol requires `<key>.txt` at the origin
 * root and the response body must be exactly the same key.
 */
async function GET({ params }: { params: { indexNowKey: string } }) {
  const configs = await getAllConfigs();
  const key = configs.indexnow_key?.trim();

  if (!isValidIndexNowKey(key) || params.indexNowKey !== key) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(key, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // The key is deliberately stable; a short cache still makes key changes
      // propagate promptly to crawlers.
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export const Route = createFileRoute('/{$indexNowKey}.txt')({
  server: { handlers: { GET } },
});
