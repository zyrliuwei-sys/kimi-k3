import { createFileRoute } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';

import { PlaygroundComingSoon } from './-coming-soon';

export const Route = createFileRoute('/api-playground/tools')({
  component: () => <PlaygroundComingSoon icon={Wrench} namespace="tools" />,
});
