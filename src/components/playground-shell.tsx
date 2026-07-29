'use client';

import { AppSidebar, type NavItem } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

/**
 * `PlaygroundShell` mirrors `AppLayout` but **skips the auth gate**.
 *
 * The lorka-style `/api-playground/*` UX (sidebar + multi-session chat + an
 * Image tab) is reachable anonymously — sending a message pops a sign-in
 * dialog instead of bouncing the whole page. This is a marketing UX crutch:
 * anonymous visitors can see the product, but the API endpoints that
 * actually cost credits / use credits still require auth and return 401.
 *
 * Slots that differ from `AppLayout`:
 *   - **No `requirePermission`** — playground is not permission-gated.
 *   - **No `UserMenu` footer** — anonymous users have no profile to show.
 *     Sign-in is exposed through `headerCta` / send-time dialog instead.
 *   - **No redirect-on-mount effect** — visitors land directly on the page.
 */
export function PlaygroundShell({
  children,
  navItems,
  brand,
  brandHref = '/api-playground',
  headerCta,
  sessionList,
  upgradeCard,
}: {
  children: React.ReactNode;
  navItems: NavItem[];
  brand: React.ReactNode;
  brandHref?: string;
  headerCta?: React.ReactNode;
  sessionList?: React.ReactNode;
  upgradeCard?: React.ReactNode;
}) {
  return (
    // h-svh + overflow-hidden locks the shell to the viewport so each
    // playground page scrolls inside its OWN track (the image wall, the
    // chat thread) instead of growing the window scrollbar.
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar
        brand={brand}
        brandHref={brandHref}
        navItems={navItems}
        headerCta={headerCta}
        sessionList={sessionList}
        upgradeCard={upgradeCard}
      />
      {/* min-w-0: let the inset shrink below its content's min-content width —
          otherwise wide tables stretch the page and force horizontal scroll
          instead of scrolling inside their own overflow-x-auto wrappers */}
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          {headerCta && (
            <div className="flex items-center gap-1 px-4">{headerCta}</div>
          )}
        </header>
        {/* min-h-0 lets this shrink below its content so pages with their
            own scroll track (image wall, chat thread) scroll internally. */}
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
