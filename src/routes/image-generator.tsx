import { createFileRoute } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus } from 'lucide-react';

import { usePlaygroundStore } from '@/lib/playground-store';
import { m } from '@/paraglide/messages.js';
import {
  ImagePlayground,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import { PlaygroundShell } from '@/components/playground-shell';

type ImageGeneratorSearch = {
  prompt?: string;
  autoSubmit?: boolean;
};

export const Route = createFileRoute('/image-generator')({
  validateSearch: (search: Record<string, unknown>): ImageGeneratorSearch => ({
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
    autoSubmit: search.autoSubmit === '1',
  }),
  head: () => ({
    meta: [{ title: 'AI Image Generator | Kimi K3' }],
  }),
  component: ImageGeneratorWorkspace,
});

/**
 * Dedicated image-making workspace. It intentionally keeps the gallery,
 * preview panel, and composer inside one fixed-height shell so users can
 * review a previous generation while writing the next prompt.
 */
function ImageGeneratorWorkspace() {
  const { prompt, autoSubmit } = Route.useSearch();
  const store = usePlaygroundStore();
  if (store.mode !== 'image') store.setMode('image');

  return (
    <PlaygroundShell
      brand="Kimi K3"
      brandHref="/api-playground"
      upgradeCard={<PlaygroundUpgradeCard />}
      navItems={[
        {
          href: '/',
          label: m['playground.nav.home'](),
          icon: Home,
        },
        {
          href: '/api-playground',
          label: m['playground.nav.chat'](),
          icon: MessageSquarePlus,
        },
        {
          href: '/photo-to-anime',
          label: m['playground.nav.image'](),
          icon: Image,
        },
      ]}
    >
      <ImagePlayground
        initialTab="mine"
        initialPrompt={prompt}
        communityPageHref="/photo-to-anime"
        autoPreviewFirst={false}
        autoSubmit={autoSubmit}
      />
    </PlaygroundShell>
  );
}
