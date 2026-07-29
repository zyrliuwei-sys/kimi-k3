import { createFileRoute } from '@tanstack/react-router';

import { Route as PlaygroundRoute } from './api-playground/route';

/**
 * `/api-playground` is now a lorka-style multi-session dashboard with a
 * sidebar nav, an Image tab, and placeholder routes for Video / Search /
 * Tools / History. The actual layout + children live under
 * `./api-playground/` so this file just re-exports the layout route.
 *
 * We can't use `export { Route } from './api-playground/route'` because
 * TanStack Router's route file scanner only recognizes `export const Route`
 * declarations — named re-exports don't trigger route registration.
 */
export const Route = createFileRoute('/api-playground')(
  PlaygroundRoute.options
);
