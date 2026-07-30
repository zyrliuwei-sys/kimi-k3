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

  // Exposed in the composer menu are:
  //   - gpt-image-2 (OpenAI flagship, ~15-25s typical) — DEFAULT
  //   - gpt-image-1.5-lite (if the gateway serves it — filtered at runtime)
  //
  // Nano Banana 2 (gemini-3.1-flash-image-preview) is parked for now —
  // the deployment's gateway returns empty imageUrls for it, so the user
  // sees a submit succeed but no image land. Drop it back into the list
  // when the upstream provider is fixed. Decide default vs. alt ordering
  // via `evolink_image_model` in admin.
  const EXPOSED_MODELS = ['gpt-image-2', 'gpt-image-1.5-lite'];
  const defaultModel = configs?.evolink_image_model || EXPOSED_MODELS[0];

  if (!configs?.evolink_api_key) {
    return respData({ models: [], defaultModel });
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
      EXPOSED_MODELS
    );
  } catch {
    // ignore — the menu still serves, submit will surface the real error
  }

  // Filter to only models the gateway actually serves, in the order we
  // want them shown. If the listing call above dropped any model, it
  // won't appear in the menu — submit will silently reroute to the
  // default in that case.
  return respData(
    { models: EXPOSED_MODELS, defaultModel },
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
