'use client';

import * as React from 'react';

import { usePathname } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  AceternitySidebar,
  AceternitySidebarBody,
  AceternitySidebarLink,
} from '@/components/ui/aceternity-sidebar';

/**
 * `PlaygroundShell` — the lorka-style `/api-playground/*` layout.
 *
 * Uses the Aceternity-style collapsible sidebar (hover to expand, hover
 * off to collapse) instead of the shadcn `Sidebar` that `app-layout.tsx`
 * uses. The body of the sidebar is split into a top scrollable section
 * (brand + nav + session list) and a bottom pinned one (upgrade card).
 *
 * The shell is anonymous-friendly — sending a message pops a sign-in
 * dialog instead of bouncing the whole page. Auth-gated API endpoints
 * still 401 when the user is unauthenticated.
 */

/** `NavItem` re-declared locally so this file doesn't pull the whole
 * `app-sidebar` machinery (which is now unused on the playground). */
interface NavItemShape {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function PlaygroundShell({
  children,
  navItems,
  brand,
  brandHref = '/api-playground',
  sessionList,
  upgradeCard,
}: {
  children: React.ReactNode;
  navItems: NavItemShape[];
  brand: React.ReactNode;
  brandHref?: string;
  sessionList?: React.ReactNode;
  upgradeCard?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // First nav item matches by exact path so the root (e.g. /api-playground)
  // doesn't highlight whenever on /api-playground/image; the rest match
  // by prefix so sub-routes light up their parent entry.
  const isActiveHref = (href: string) =>
    href === navItems[0]?.href
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/');

  return (
    // h-svh + overflow-hidden locks the shell to the viewport so each
    // playground page scrolls inside its OWN track (the image wall, the
    // chat thread) instead of growing the window scrollbar.
    <div className="flex h-svh w-full overflow-hidden">
      <AceternitySidebar open={open} setOpen={setOpen}>
        <AceternitySidebarBody className="justify-between gap-6">
          {/* Top: brand + nav + session list. min-h-0 lets this column
              shrink below its content's min-height so the upgrade card
              stays pinned when the session list grows long. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <Brand brand={brand} brandHref={brandHref} open={open} />
            <div className="mt-6 flex flex-col gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <AceternitySidebarLink
                    key={item.href}
                    link={{
                      label: item.label,
                      href: item.href,
                      icon: (
                        <Icon className="h-5 w-5 shrink-0 text-neutral-700 dark:text-neutral-200" />
                      ),
                    }}
                    isActive={isActiveHref(item.href)}
                  />
                );
              })}
            </div>
            {sessionList ? (
              <div
                className={cn(
                  'mt-6 flex flex-col gap-1',
                  // Hide chat-history list when the sidebar is collapsed
                  // — collapsed icon-only mode can't fit a row of text.
                  !open && 'hidden'
                )}
              >
                {sessionList}
              </div>
            ) : null}
          </div>
          {/* Bottom: upgrade card pinned. Hidden when collapsed. */}
          {upgradeCard ? (
            <div className={cn('mt-2 shrink-0', !open && 'hidden')}>
              {upgradeCard}
            </div>
          ) : null}
        </AceternitySidebarBody>
      </AceternitySidebar>
      {/* Main content area. min-w-0 lets it shrink below its content's
          min-content width; min-h-0 lets its scroll track work. */}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

/** Brand chip at the top of the sidebar. Shows the full brand text when
 * expanded, just the icon mark when collapsed. Brand value is a ReactNode
 * (e.g. "Kimi K3") so we render it inside a wrapper for consistent
 * typography.
 *
 * The `pl-2` lines the brand text up with the nav icons in
 * `SidebarMenuButton`'s grid (which pads each row with `p-2`), so the
 * "Kimi K3" glyph aligns vertically with the Chat/Image icons below. */
function Brand({
  brand,
  brandHref,
  open,
}: {
  brand: React.ReactNode;
  brandHref: string;
  open: boolean;
}) {
  return (
    <a
      href={brandHref}
      className="relative z-20 flex items-center gap-2 py-2 pl-2 text-base font-semibold tracking-tight text-neutral-900 dark:text-white"
    >
      <span className={cn('overflow-hidden whitespace-pre', !open && 'hidden')}>
        {brand}
      </span>
    </a>
  );
}
