import { createFileRoute } from '@tanstack/react-router';
import { History } from 'lucide-react';

import { PlaygroundComingSoon } from './-coming-soon';

export const Route = createFileRoute('/api-playground/history')({
  component: () => <PlaygroundComingSoon icon={History} namespace="history" />,
});
