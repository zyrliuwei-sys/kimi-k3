import { createFileRoute } from '@tanstack/react-router';

import { originFromRequest } from '@/lib/url';

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => {
        const base = originFromRequest(request);
        const body = [
          'User-Agent: *',
          'Allow: /',
          'Disallow: /admin',
          'Disallow: /settings',
          'Disallow: /api/',
          'Disallow: /*?*',
          '',
          `Sitemap: ${base}/sitemap.xml`,
          '',
        ].join('\n');
        return new Response(body, {
          headers: { 'Content-Type': 'text/plain' },
        });
      },
    },
  },
});
