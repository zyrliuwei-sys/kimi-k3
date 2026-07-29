import { createFileRoute } from '@tanstack/react-router';
import { Video } from 'lucide-react';

import { PlaygroundComingSoon } from './-coming-soon';

export const Route = createFileRoute('/api-playground/video')({
  component: () => <PlaygroundComingSoon icon={Video} namespace="video" />,
});
