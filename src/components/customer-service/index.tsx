import { Tawk } from './tawk';

/**
 * Customer-service chat widgets — renders enabled providers.
 * Config data is passed as props (fetched via the root-route loader).
 *
 * Crisp was removed: the default chat bubble (tropical-island avatar) sat
 * in the bottom-right of every page and we don't ship it. The Crisp
 * config keys (`crisp_enabled`, `crisp_website_id`) still live in admin
 * settings — restore by re-adding `<Crisp websiteId={crispWebsiteId} />`
 * and the prop below.
 */
export function CustomerService({
  tawkPropertyId,
  tawkWidgetId,
}: {
  tawkPropertyId?: string;
  tawkWidgetId?: string;
}) {
  return (
    <>
      {tawkPropertyId && tawkWidgetId ? (
        <Tawk propertyId={tawkPropertyId} widgetId={tawkWidgetId} />
      ) : null}
    </>
  );
}
