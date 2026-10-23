import { createFileRoute } from '@tanstack/react-router';

import { staticPageRouteOptions } from './-static-page';

export const Route = createFileRoute('/(pages)/kimi-k3-1')(
  staticPageRouteOptions('kimi-k3-1')
);
