import { createFileRoute } from '@tanstack/react-router';

import { ChatPlayground } from '@/blocks/api-playground';

export const Route = createFileRoute('/api-playground/')({
  component: ChatPlayground,
});
