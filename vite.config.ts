import { readFileSync } from 'node:fs';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

import { loadEnvFiles } from './src/lib/env';

// Populate process.env from .env.local / .env.{NODE_ENV} / .env for the
// dev server and build process (Vite only exposes VITE_* via import.meta.env;
// server code reads secrets from process.env). In production, env comes
// from the actual host/container environment.
loadEnvFiles();

// Cloudflare Workers build (pnpm cf:build / cf:deploy): stub out unused DB
// drivers — mysql2 crashes workerd at module evaluation (node:net,
// node:process requires); postgres.js runs fine under nodejs_compat but is
// dead weight when the backend is D1. Which driver the bundle keeps follows
// wrangler.jsonc `vars.DATABASE_PROVIDER` (the runtime truth on workerd) —
// d1 stubs both, postgresql keeps postgres.js for the Hyperdrive binding.
const isCloudflareBuild = (process.env.NITRO_PRESET || '').includes(
  'cloudflare'
);
const driverStub = new URL('./src/core/db/driver-stub.ts', import.meta.url)
  .pathname;

// Prefer wrangler.jsonc over the build-time env, which can be polluted by
// .env.local (e.g. DATABASE_PROVIDER=sqlite for local dev).
function workersDbProvider(): string {
  try {
    const raw = readFileSync(
      new URL('./wrangler.jsonc', import.meta.url),
      'utf8'
    );
    const m = raw.match(/"DATABASE_PROVIDER"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    // no wrangler.jsonc yet (fresh clone) — fall through
  }
  return process.env.DATABASE_PROVIDER || 'd1';
}

const workersDb = isCloudflareBuild ? workersDbProvider() : '';
const keepPostgres = workersDb === 'postgresql' || workersDb === 'postgres';

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
    alias: isCloudflareBuild
      ? {
          mysql2: driverStub,
          ...(keepPostgres ? {} : { postgres: driverStub }),
        }
      : {},
  },
  plugins: [
    // MDX must run before the react plugin so JSX in compiled MDX gets transformed.
    { enforce: 'pre', ...mdx({ providerImportSource: '@mdx-js/react' }) },
    tailwindcss(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      outputStructure: 'message-modules',
      cookieName: 'PARAGLIDE_LOCALE',
      strategy: ['url', 'cookie', 'baseLocale'],
      urlPatterns: [
        // API endpoints are never locale-prefixed.
        {
          pattern: '/api/:path(.*)?',
          localized: [
            ['en', '/api/:path(.*)?'],
            ['zh', '/api/:path(.*)?'],
          ],
        },
        // Bare locale homes match without a trailing-slash redirect.
        {
          pattern: '/',
          localized: [
            ['zh', '/zh'],
            ['en', '/'],
          ],
        },
        // "as-needed" prefix: zh under /zh, en (default) unprefixed.
        {
          pattern: '/:path(.*)?',
          localized: [
            ['zh', '/zh/:path(.*)?'],
            ['en', '/:path(.*)?'],
          ],
        },
      ],
    }),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro({
      // Security headers applied to every response. These are the minimum
      // a SaaS that accepts payments should ship:
      //   - HSTS forces HTTPS for 2 years, blocking downgrade attacks
      //   - X-Frame-Options: DENY blocks clickjacking on /pricing + checkout
      //   - X-Content-Type-Options: nosniff blocks MIME-confusion attacks
      //   - Referrer-Policy prevents leaking the path (incl. tokens) to other origins
      //   - Permissions-Policy disables device APIs the app doesn't use
      //   - CSP is a permissive starter — tighten after watching browser
      //     console for blocked resources. shadcn/Tailwind inject inline
      //     styles, so style-src includes 'unsafe-inline' by design.
      routeRules: {
        '/**': {
          headers: {
            'Strict-Transport-Security':
              'max-age=63072000; includeSubDomains; preload',
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy':
              'camera=(), microphone=(), geolocation=(), interest-cohort=()',
            'Content-Security-Policy': [
              "default-src 'self'",
              // Scripts: 'unsafe-inline' covers TanStack Start hydration,
              // 'unsafe-eval' covers React Query devtools in dev (prod tree-
              // shakes them out, so these are mostly inert there).
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
              // Styles: Tailwind + shadcn rely on inline styles.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Images: R2/S3 public buckets + base64 inline attachments.
              "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.r2.dev https://*.amazonaws.com",
              // Fonts: @fontsource (bundled, served from self) + Google Fonts.
              "font-src 'self' data: https://fonts.gstatic.com",
              // XHR/fetch: AI providers, Stripe API, Replicate, Resend,
              // your own API routes. The wildcard covers unknown AI providers
              // you might enable later; tighten once you've finalized the list.
              "connect-src 'self' https://api.stripe.com https://api.evolink.ai https://api.openai.com https://*.amazonaws.com https://*.r2.cloudflarestorage.com https://*.r2.dev https://api.resend.com https://api.replicate.com https://generativelanguage.googleapis.com https://api.fal.ai https://api.kie.ai",
              // Stripe Elements / checkout iframes.
              'frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com',
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        },
      },
    }),
  ],
});
