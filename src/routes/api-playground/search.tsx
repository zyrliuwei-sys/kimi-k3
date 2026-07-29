import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';

import { PlaygroundComingSoon } from './-coming-soon';

export const Route = createFileRoute('/api-playground/search')({
  component: () => <PlaygroundComingSoon icon={Search} namespace="search" />,
});
