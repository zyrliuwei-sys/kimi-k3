import { createFileRoute } from '@tanstack/react-router';

// Legacy image route → dedicated image-generation workspace.
export const Route = createFileRoute('/api-playground/image')({
  server: {
    handlers: {
      GET: () =>
        new Response(null, {
          status: 301,
          headers: { Location: '/image-generator' },
        }),
    },
  },
});
