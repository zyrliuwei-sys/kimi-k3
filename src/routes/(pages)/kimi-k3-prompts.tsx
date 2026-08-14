import { createFileRoute } from '@tanstack/react-router';

import { staticPageRouteOptions } from './-static-page';

export const Route = createFileRoute('/(pages)/kimi-k3-prompts')(
  staticPageRouteOptions('kimi-k3-prompts')
);
