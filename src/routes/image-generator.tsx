import { createFileRoute } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus } from 'lucide-react';

import { usePlaygroundStore } from '@/lib/playground-store';
import { m } from '@/paraglide/messages.js';
import {
  ImagePlayground,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import {
  IMAGE_GENERATOR_CANONICAL,
  IMAGE_GENERATOR_DESCRIPTION,
  IMAGE_GENERATOR_STRUCTURED_DATA,
  IMAGE_GENERATOR_TITLE,
  ImageGeneratorSeoContent,
} from '@/components/image-generator-seo-content';
import { PlaygroundShell } from '@/components/playground-shell';

type ImageGeneratorSearch = {
  prompt?: string;
  autoSubmit?: true;
};

export const Route = createFileRoute('/image-generator')({
  validateSearch: (search: Record<string, unknown>): ImageGeneratorSearch => ({
    prompt: typeof search.prompt === 'string' ? search.prompt : undefined,
    // Returning false here serializes it as `?autoSubmit=false`, creating a
    // needless redirect/canonical duplicate for the bare route. Keep the
    // parameter only for the one URL-driven submit state we support.
    autoSubmit: search.autoSubmit === '1' ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: IMAGE_GENERATOR_TITLE },
      { name: 'description', content: IMAGE_GENERATOR_DESCRIPTION },
      { property: 'og:title', content: IMAGE_GENERATOR_TITLE },
      { property: 'og:description', content: IMAGE_GENERATOR_DESCRIPTION },
      { property: 'og:url', content: IMAGE_GENERATOR_CANONICAL },
    ],
    links: [{ rel: 'canonical', href: IMAGE_GENERATOR_CANONICAL }],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify(IMAGE_GENERATOR_STRUCTURED_DATA),
      },
    ],
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
    <>
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
      <ImageGeneratorSeoContent />
    </>
  );
}
