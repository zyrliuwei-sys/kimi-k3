import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus, Search, Wrench } from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { usePlaygroundStore } from '@/lib/playground-store';
import { m } from '@/paraglide/messages.js';
import {
  PlaygroundSidebarList,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import { PlaygroundShell } from '@/components/playground-shell';

/**
 * Layout for the lorka-style `/api-playground/*` routes.
 *
 * Children (ChatPlayground, ImagePlayground, VideoPlayground, ComingSoon
 * placeholders) are mounted via `<Outlet />`. The sidebar is mode-aware —
 * `mode` is derived from the URL prefix:
 *   - `/api-playground/image` → `[Image #N]` image tasks
 *   - `/api-playground/video` → `[Video #N]` video tasks
 *   - everything else          → `[Chat #N]` chat rows
 * Nav items highlight the active route via the standard `isActiveHref`
 * prefix logic.
 *
 * The "新建聊天" / "新建图像" / "新建视频" CTA calls
 * `playgroundStore.clearActive()` directly — it's a local-only reset that
 * doesn't touch the URL.
 */
export const Route = createFileRoute('/api-playground')({
  component: PlaygroundLayout,
});

function PlaygroundLayout() {
  const location = useLocation();
  const mode: 'chat' | 'image' | 'video' = (() => {
    if (location.pathname.startsWith('/api-playground/image')) return 'image';
    if (location.pathname.startsWith('/api-playground/video')) return 'video';
    return 'chat';
  })();

  // Keep the store's mode in sync with the URL so non-React callers (e.g.
  // event handlers in the chat block) see the right value without passing
  // it through props.
  const store = usePlaygroundStore();
  if (store.mode !== mode) store.setMode(mode);

  // For the "新建聊天" / "新建图像" / "新建视频" CTA — one per mode.
  // Anonymous users can also see and click this; clearing local state
  // is the safe no-op for them.
  const ctaText =
    mode === 'image'
      ? m['playground.image.new_image']()
      : mode === 'video'
        ? m['playground.video.new_video']()
        : m['playground.chat.new_chat']();
  const cta = (
    <button
      type="button"
      onClick={() => store.clearActive()}
      className="brand-gradient inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.55)] transition-all hover:opacity-95"
    >
      <MessageSquarePlus className="size-4" />
      {ctaText}
    </button>
  );

  // Image mode intentionally drops the left session list — generated
  // images live on the right (My Images tab + the active-result panel
  // that pops above the composer), so a separate history column is
  // duplicate UI. Chat mode keeps the list because multi-session chat
  // genuinely needs it.
  const showHistorySidebar = mode !== 'image';

  return (
    <PlaygroundShell
      brand="Kimi K3"
      brandHref="/api-playground"
      // No header CTA — chat mode gets the in-thread "New chat" reset
      // affordance from <ThreadHeader>, and image/video modes already
      // cover the "start over" action in the composer. The top-right
      // button duplicated the same flow and crowded the header.
      headerCta={undefined}
      sessionList={
        showHistorySidebar ? <PlaygroundSidebarList mode={mode} /> : undefined
      }
      upgradeCard={<PlaygroundUpgradeCard />}
      navItems={[
        {
          // One-click escape back to the marketing landing page. Sits
          // at the very top of the sidebar so it's always within reach,
          // independent of the active playground tab (chat/image/video).
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
        // {
        //   href: '/api-playground/video',
        //   label: m['playground.nav.video'](),
        //   icon: Video,
        // },
        // Search tab is parked for later development.
        // {
        //   href: '/api-playground/search',
        //   label: m['playground.nav.search'](),
        //   icon: Search,
        // },
        // Tools tab is parked for later development.
        // {
        //   href: '/api-playground/tools',
        //   label: m['playground.nav.tools'](),
        //   icon: Wrench,
        // },
      ]}
    >
      <Outlet />
    </PlaygroundShell>
  );
}
