import { createFileRoute } from '@tanstack/react-router';

import { VideoPlayground } from '@/blocks/api-playground';

/**
 * `/api-playground/video` — text-to-video generation tab (Seedance 2.0 via
 * Evolink). The underlying submit endpoint is `POST /api/ai-tasks` with
 * `mediaType: 'video'`; the active task is polled via `GET /api/ai-tasks/$id`.
 */
export const Route = createFileRoute('/api-playground/video')({
  component: VideoPlayground,
});
