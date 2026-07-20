import { createFileRoute } from '@tanstack/react-router';

import { staticPageRouteOptions } from './-static-page';

export const Route = createFileRoute('/(pages)/kimika-3')(
  staticPageRouteOptions('kimika-3')
);
