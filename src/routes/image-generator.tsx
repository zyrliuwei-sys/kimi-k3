import { createFileRoute } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus } from 'lucide-react';

import { usePlaygroundStore } from '@/lib/playground-store';
import { m } from '@/paraglide/messages.js';
import {
  ImagePlayground,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import { PlaygroundShell } from '@/components/playground-shell';

const IMAGE_GENERATOR_TITLE =
  'Free AI Image Generator | Kimi K3 - Create Images Online';
const IMAGE_GENERATOR_DESCRIPTION =
  'Generate images free with Kimi K3 AI image generator. Describe your idea and get HD images in seconds. Sign in for your first free image, up to 4 per prompt.';
const IMAGE_GENERATOR_CANONICAL = 'https://www.kimik3.net/image-generator';
const IMAGE_GENERATOR_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Kimi K3 Image Generator',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: IMAGE_GENERATOR_CANONICAL,
  description: IMAGE_GENERATOR_DESCRIPTION,
};

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
        <div className="h-full bg-white dark:bg-[#050505]">
          <ImagePlayground
            initialTab="mine"
            initialPrompt={prompt}
            communityPageHref="/photo-to-anime"
            autoPreviewFirst={false}
            autoSubmit={autoSubmit}
          />
        </div>
      </PlaygroundShell>
    </>
  );
}
