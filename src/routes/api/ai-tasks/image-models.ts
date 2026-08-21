import { createFileRoute } from '@tanstack/react-router';

import { EvolinkImageProvider, listEvolinkImageModels } from '@/core/ai';
import { getAllConfigs } from '@/modules/config/service';
import { respData } from '@/lib/resp';

/**
 * `GET /api/ai-tasks/image-models` — the image models actually reachable
 * with the deployment's Evolink key, for the composer's model menu.
 *
 * The list comes from the gateway's own `/v1/models`, narrowed to
 * image-capable ids and cached for an hour per key (see
 * `listEvolinkImageModels`). `defaultModel` is what `POST /api/ai-tasks`
 * would use when the client doesn't pick one, so the menu can show the
 * right row as selected on first paint.
 *
 * Returns an empty list (not an error) when Evolink isn't configured or
 * the listing call fails — the composer then just runs on the default
 * model without a menu, which is the pre-existing behaviour.
 *
 * No auth: this exposes model ids only, no credentials and no user data,
 * and the underlying gateway call is cached so it can't be used to
 * hammer the provider.
 */
async function GET() {
  const configs = await getAllConfigs();

  // The gateway can list `gpt-image-1.5-lite` while rejecting it at the
  // generation endpoint. Keep the product on the one model that is known
  // to accept image-generation requests for this integration. Add a model
  // here only after a real generation request has succeeded with it.
  const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

  if (!configs?.evolink_api_key) {
    return respData({ models: [], defaultModel: DEFAULT_IMAGE_MODEL });
  }

  // Touch the gateway so we surface "out of credits" early; the result
  // is ignored otherwise. Wrapped in try/catch so a transient failure
  // here doesn't break the menu load.
  try {
    const provider = new EvolinkImageProvider({
      apiKey: configs.evolink_api_key,
      baseUrl: configs.evolink_base_url,
    });
    await listEvolinkImageModels(
      provider,
      `${configs.evolink_api_key}|${configs.evolink_base_url || ''}`,
      [DEFAULT_IMAGE_MODEL]
    );
  } catch {
    // ignore — the menu still serves, submit will surface the real error
  }

  // Model discovery is advisory only: a provider can list an id that it
  // then rejects during submission. Always return the safe default rather
  // than a stale admin setting or an unverified discovery result.
  const defaultModel = DEFAULT_IMAGE_MODEL;
  return respData(
    { models: [DEFAULT_IMAGE_MODEL], defaultModel },
    {
      headers: {
        // Public + 5min edge cache. The composer asks for this on every
        // page load to populate the model menu; without an edge cache
        // the request would always round-trip the origin (and on Workers
        // that means a DB read + upstream gateway call every time). 5
        // minutes is short enough that adding/removing a model in admin
        // settings propagates quickly, long enough that repeat visitors
        // never hit the origin.
        'Cache-Control':
          'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    }
  );
}

export const Route = createFileRoute('/api/ai-tasks/image-models')({
  server: { handlers: { GET } },
});
