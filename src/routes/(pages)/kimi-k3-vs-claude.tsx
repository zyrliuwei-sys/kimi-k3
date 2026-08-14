import { createFileRoute } from '@tanstack/react-router';

import { staticPageRouteOptions } from './-static-page';

export const Route = createFileRoute('/(pages)/kimi-k3-vs-claude')(
  staticPageRouteOptions('kimi-k3-vs-claude')
);
