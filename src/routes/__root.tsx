/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { ThemeProvider } from 'next-themes';

import { envConfigs } from '@/config';
import { getQueryClient } from '@/lib/query-client';
import { getLocale } from '@/paraglide/runtime.js';
import { GoogleAnalytics } from '@/components/analytics/google-analytics';
import { MicrosoftClarity } from '@/components/analytics/microsoft-clarity';
import { Plausible } from '@/components/analytics/plausible';
import { CustomerService } from '@/components/customer-service';
import { GoogleOneTap } from '@/components/google-one-tap';
import { Toaster } from '@/components/ui/sonner';

import '@fontsource-variable/dm-sans';
import '@fontsource/libre-baskerville';
import '@fontsource/libre-baskerville/400-italic.css';
import '@fontsource/libre-baskerville/700.css';
import '@/styles/globals.css';

// Analytics IDs live in the DB config (1h-cached service). Fetched via a
// server function so drizzle/db code never reaches the client bundle.
const getAnalyticsConfigs = createServerFn().handler(async () => {
  const { getAllConfigs } = await import('@/modules/config/service');
  const configs = await getAllConfigs();
  return {
    gaId: configs.google_analytics_id?.trim() || '',
    plausibleDomain: configs.plausible_domain?.trim() || '',
    plausibleSrc: configs.plausible_src?.trim() || '',
    crispWebsiteId:
      configs.crisp_enabled === 'true'
        ? configs.crisp_website_id?.trim() || ''
        : '',
    tawkPropertyId:
      configs.tawk_enabled === 'true'
        ? configs.tawk_property_id?.trim() || ''
        : '',
    tawkWidgetId:
      configs.tawk_enabled === 'true'
        ? configs.tawk_widget_id?.trim() || ''
        : '',
  };
});

export const Route = createRootRoute({
  loader: () => getAnalyticsConfigs(),
  head: () => {
    // head() runs on the SSR server AND again on the client during hydration.
    // On the client, app_url falls back to the localhost dev default when
    // VITE_APP_URL wasn't inlined into the client bundle at build — which would
    // emit a second, localhost set of hreflang links. Prefer the live origin
    // on the client so it always matches; the server uses the configured URL.
    const appUrl =
      (typeof window !== 'undefined' && window.location?.origin) ||
      envConfigs.app_url ||
      '';
    const locale = getLocale();
    const imageUrl = `${appUrl}/seo/og.png`;
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'saashub-verification', content: '0ew2a9pav93w' },
        { name: 'stackscope-claim', content: '2fpl5ars' },
        // Route-specific title, description, og:url, and canonical tags are
        // intentionally declared by each public route. Keeping them here
        // would make every page look like the homepage to crawlers.
        // Open Graph fields that genuinely apply site-wide stay at the root.
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'kimik3' },
        { property: 'og:image', content: imageUrl },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:locale', content: locale },
        // Twitter / X
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: imageUrl },
      ],
      links: [
        // Google Search uses the favicon declared on the homepage. Keep these
        // URLs stable and provide a raster fallback: it is easier for image
        // crawlers to process than relying on SVG support alone.
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        {
          rel: 'icon',
          href: '/favicon-48x48.png',
          type: 'image/png',
          sizes: '48x48',
        },
        {
          rel: 'icon',
          href: '/favicon-32x32.png',
          type: 'image/png',
          sizes: '32x32',
        },
        {
          rel: 'apple-touch-icon',
          href: '/apple-touch-icon.png',
          sizes: '180x180',
        },
        { rel: 'manifest', href: '/site.webmanifest' },
        // Preconnect + DNS prefetch to the upstream image gateway. Saves
        // ~200-400ms of TLS handshake on the very first generation submit
        // (DNS + TCP + TLS round-trip otherwise happens inside the
        // POST /api/ai-tasks request).
        { rel: 'preconnect', href: 'https://api.evolink.ai' },
        { rel: 'dns-prefetch', href: 'https://api.evolink.ai' },
      ],
    };
  },
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootComponent() {
  const analytics = Route.useLoaderData();

  return (
    <QueryClientProvider client={getQueryClient()}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <Outlet />
        <Toaster position="top-center" richColors />
        <GoogleOneTap />
        {analytics?.gaId ? (
          <GoogleAnalytics measurementId={analytics.gaId} />
        ) : null}
        {analytics?.plausibleDomain ? (
          <Plausible
            domain={analytics.plausibleDomain}
            src={analytics.plausibleSrc || undefined}
          />
        ) : null}
        <MicrosoftClarity projectId="y4qjrzezd3" />
        <CustomerService
          tawkPropertyId={analytics?.tawkPropertyId || undefined}
          tawkWidgetId={analytics?.tawkWidgetId || undefined}
        />
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <a href="/" className="text-sm underline underline-offset-4">
        Back to home
      </a>
    </div>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Oops</h1>
      <p className="text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      {import.meta.env.DEV && error instanceof Error && (
        <pre className="bg-muted mt-2 max-w-lg overflow-auto rounded p-4 text-xs">
          {error.message}
        </pre>
      )}
      <button
        type="button"
        onClick={reset}
        className="text-sm underline underline-offset-4"
      >
        Try again
      </button>
    </div>
  );
}
