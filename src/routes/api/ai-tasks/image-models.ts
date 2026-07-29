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

  // Single-model rollout: only `gpt-image-2` is exposed in the menu for
  // now, so the wire-up is easy to debug before we re-enable the other
  // Evolink image models. Admin can override via `evolink_image_model`,
  // but the menu still lists just `gpt-image-2` (override applies to
  // the default only). When we're ready to bring the rest back, delete
  // this block and rely on the previous allowlist path.
  const ONLY_MODEL = 'gpt-image-2';
  const defaultModel = configs?.evolink_image_model || ONLY_MODEL;

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
      [ONLY_MODEL]
    );
  } catch {
    // ignore — the menu still serves, submit will surface the real error
  }

  return respData({ models: [ONLY_MODEL], defaultModel });
}

export const Route = createFileRoute('/api/ai-tasks/image-models')({
  server: { handlers: { GET } },
});
