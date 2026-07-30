import { createFileRoute } from '@tanstack/react-router';

import { ImagePlayground } from '@/blocks/api-playground';

export const Route = createFileRoute('/api-playground/image')({
  component: ImagePlayground,
});
