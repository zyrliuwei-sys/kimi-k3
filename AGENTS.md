# ShipAny Next — Agent Instructions

This is a **headless SaaS engine** — pre-wired business logic (payments, credits, subscriptions, auth, RBAC) with minimal UI. Users build their product pages on top of it.

## Tech Stack

- **Framework:** Next.js 15 (App Router, React 19, TypeScript strict)
- **UI:** shadcn/ui v4 (Base Nova style, Tailwind CSS 4, oklch colors)
- **Auth:** better-auth with Drizzle adapter
- **Database:** Drizzle ORM — supports PostgreSQL, MySQL, SQLite, Turso, Cloudflare D1
- **All code is self-contained** — no external packages for business logic. Payment, email, storage, AI, auth, and utils are inlined in `src/core/` and `src/lib/`.

## Commands

- `pnpm dev` — Dev server
- `pnpm build` — Production build (always verify after changes)
- `pnpm db:setup` — Copy schema template based on `DATABASE_PROVIDER` (run once after clone)
- `pnpm db:push` — Push schema to database (development — direct sync, may lose data)
- `pnpm db:generate` — Generate SQL migration files (production — safe, reviewable)
- `pnpm db:migrate` — Run pending migrations
- `pnpm db:studio` — Drizzle Studio GUI

### First-time setup

```bash
pnpm install          # install dependencies (postinstall auto-copies sqlite schema)
# edit .env.local     # set DATABASE_PROVIDER, DATABASE_URL, AUTH_SECRET, etc.
pnpm db:setup         # copy the matching schema template (if not sqlite)
pnpm db:push          # create tables
pnpm dev              # start dev server
```

### Schema change workflow

**Development** (fast iteration, ok to lose data):
1. Edit `src/config/db/schema.ts`
2. `pnpm db:push`

**Production** (safe, reversible):
1. Edit `src/config/db/schema.ts`
2. `pnpm db:generate` — creates migration SQL in `/drizzle/`
3. Review the generated SQL — check for destructive operations (DROP COLUMN, etc.)
4. `pnpm db:migrate` — apply to database

**Rule:** Agent should use `db:push` during development. For production deployments, always use `db:generate` + `db:migrate` and ask the user to review the migration before applying.

## Architecture

```
src/
├── core/                        # Infrastructure — every project uses this
│   ├── db/                      # Multi-DB (PostgreSQL, MySQL, SQLite, D1)
│   ├── auth/                    # better-auth (server + client) + RBAC
│   ├── i18n/                    # next-intl (routing, navigation, request)
│   ├── payment/                 # Payment providers (Stripe, PayPal, Creem)
│   ├── email/                   # Email providers (Resend)
│   ├── storage/                 # Storage providers (S3, R2)
│   └── ai/                     # AI providers (Replicate, Gemini, Fal, Kie)
│
├── modules/                     # Business logic — independently removable
│   ├── payment/service.ts       # Checkout, webhook, order + subscription + credit atomicity
│   ├── subscriptions/service.ts # Subscription lifecycle (CRUD, status transitions)
│   ├── credits/service.ts       # FIFO consumption, expiration, revocation, auto-grant
│   ├── apikeys/service.ts       # API key CRUD + validation
│   ├── rbac/service.ts          # Role/permission checks, wildcard matching
│   ├── config/service.ts        # DB key-value config with 1h cache
│   └── ai-tasks/service.ts      # AI task tracking with credit deduction/revocation
│
├── config/
│   ├── index.ts                 # All env vars (app, db, auth, stripe, resend, storage, ai, locale)
│   ├── db/schema.ts             # All table definitions (19 built-in + custom tables)
│   └── locale/                  # i18n locale config + translation JSON files
│       ├── index.ts             # Locales, default locale, message paths
│       └── messages/{en,zh}/    # Translation files per locale
│
├── app/
│   ├── layout.tsx               # Root layout (fonts, html lang)
│   ├── [locale]/                # Locale-aware pages
│   │   ├── layout.tsx           # NextIntlClientProvider + ThemeProvider
│   │   ├── page.tsx             # Homepage
│   │   ├── (auth)/              # Sign-in, sign-up
│   │   └── dashboard/           # Dashboard pages
│   └── api/                     # REST endpoints (NOT under [locale])
│
├── components/ui/               # shadcn/ui (add via `npx shadcn add`)
└── lib/                         # Utilities (hash, resp, cookie, cache, rate-limit, time, env, cn)
```

## Module System

Every module in `src/modules/` is a **standalone service file** that:
- Imports only from `@/core/`, `@/config/`, `@/lib/`, or `drizzle-orm`
- Exports pure functions (no React, no route handlers)
- Can be deleted without breaking other modules

### How modules connect to routes

```
User Request → API Route (src/app/api/*) → Module Service (src/modules/*) → Database
```

API routes are thin wrappers — they check auth, parse params, call the service, return JSON.

### Module dependency rules

- Modules depend on `core/`, `config/`, `lib/`, and `drizzle-orm` — never on other modules' internals
- Exception: `payment/service.ts` calls `credits/` and `subscriptions/` because payment success triggers credit granting and subscription creation. This is the ONE allowed cross-module dependency.
- `ai-tasks/service.ts` calls `credits/` for consumption/revocation. This is the second.
- All other modules are fully independent.

## Key Patterns

### i18n (translations)

**Server components:**
```tsx
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('common');
  return <h1>{t('sign.sign_in_title')}</h1>;
}
```

**Client components:**
```tsx
"use client";
import { useTranslations, useLocale } from 'next-intl';

export function MyForm() {
  const t = useTranslations('common');
  const locale = useLocale();
  return <button>{t('nav.get_started')}</button>;
}
```

**Adding translations:** Add JSON files in `src/config/locale/messages/{en,zh}/`, then register the path in `localeMessagesPaths` in `src/config/locale/index.ts`.

**Locale-aware links:** Use `Link` from `@/core/i18n/navigation` instead of `next/link` for pages — it auto-prefixes the locale.

### Server components (default)

```tsx
import { headers } from "next/headers";
import { getAuth } from "@/core/auth";

export default async function Page() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  // ...
}
```

### Client components (when needed)

```tsx
"use client";
import { useSession } from "@/core/auth/client";
```

### API routes

```ts
import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return respErr('Unauthorized');
  // call module service...
  return respData(result);
}
```

### Database queries

```ts
import { db } from '@/core/db';
import { someTable } from '@/config/db/schema';
import { eq } from 'drizzle-orm';

const rows = await db().select().from(someTable).where(eq(someTable.userId, id));
```

### shadcn/ui v4 (Base Nova)

- **No `asChild` prop.** Use `className={cn(buttonVariants())}` on Link instead.
- Add components: `npx shadcn add button card dialog`
- Theme colors in `src/app/globals.css` as CSS variables (oklch)

## Adding a New Feature

1. **Need new DB tables?** Add to `src/config/db/schema.ts` (under the "Custom tables" section), run `pnpm db:push`
2. **Create module service:** `src/modules/<feature>/service.ts` — pure business logic
3. **Create API route:** `src/app/api/<feature>/route.ts` — thin wrapper calling the service
4. **Create page:** `src/app/[locale]/dashboard/<feature>/page.tsx` — `"use client"`, fetch from API
5. **Add translations:** Update `src/config/locale/messages/{en,zh}/dashboard.json`
6. **Add nav entry:** Update `navItems` in `src/app/[locale]/dashboard/layout.tsx`
7. **Need a static page?** Add MDX at `src/app/[locale]/(pages)/<slug>/page.mdx`

Or use skills: `/new-module`, `/new-page`, `/new-static-page`

## Inlined Modules (src/core/ and src/lib/)

All functionality is self-contained — no external packages needed.

| Location | Key Exports |
|----------|-------------|
| `@/core/payment` | `PaymentManager`, `StripeProvider`, `PayPalProvider`, `CreemProvider` |
| `@/core/email` | `EmailManager`, `ResendProvider` |
| `@/core/storage` | `StorageManager`, `S3Provider`, `R2Provider` |
| `@/core/ai` | `AIManager`, `ReplicateProvider`, `GeminiProvider`, `FalProvider`, `KieProvider` |
| `@/core/auth/rbac` | `matchPermission`, `matchAnyPermission`, `ROLES` |
| `@/core/db` | `db()` singleton, `createDb` (multi-dialect) |
| `@/lib/hash` | `getUuid`, `getSnowId`, `getUniSeq`, `getNonceStr`, `md5` |
| `@/lib/resp` | `respData`, `respOk`, `respErr` |
| `@/lib/cookie` | `getCookie`, `setCookie`, `getCookieFromCtx` |
| `@/lib/rate-limit` | `enforceMinIntervalRateLimit` |
| `@/lib/cache` | `cacheGet`, `cacheSet`, `cacheRemove` |
| `@/lib/time` | `getTimestamp`, `getIsoTimestr` |
| `@/core/i18n/config` | `routing` (locale routing config) |
| `@/core/i18n/navigation` | `Link`, `useRouter`, `usePathname` (locale-aware) |

## Database Schema (19 tables)

**`schema.ts` is gitignored** — it's the user's working copy generated from a template.

Three dialect templates are committed to git:
- `src/config/db/schema.sqlite.ts` — SQLite (default)
- `src/config/db/schema.postgres.ts` — PostgreSQL
- `src/config/db/schema.mysql.ts` — MySQL

**Setup:** Copy the matching template into `schema.ts`, set `DATABASE_PROVIDER` in `.env.local`, run `pnpm db:push`. `drizzle.config.ts` reads the dialect automatically.

Each template exports **strong types** for all tables (`User`, `NewUser`, `Order`, `NewOrder`, etc.) via `$inferSelect` / `$inferInsert`. Use these in service functions instead of `any`.

**Auth:** user, session, account, verification
**Business:** order, subscription, credit, apikey
**RBAC:** role, permission, rolePermission, userRole
**Content:** post, taxonomy, config
**AI:** aiTask, chat, chatMessage

## Environment Variables

```env
# Required
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=My App
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:data/local.db
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Payment (optional — enable when ready)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_SIGNING_SECRET=

# Locale (optional)
NEXT_PUBLIC_DEFAULT_LOCALE=en

# Other optional: RESEND_API_KEY, STORAGE_*, REPLICATE_API_TOKEN
```

## Critical Rules

1. **Don't import between modules** (except the documented payment→credits/subscriptions dependency)
2. **Don't add `"use client"` to server components** — split into server page + client form instead
3. **Don't edit `components/ui/*` manually** — use `npx shadcn add`
4. **Don't hardcode app name** — use `envConfigs.app_name` from `@/config`
5. **Always verify `pnpm build` passes** after making changes
6. **Return `respData`/`respErr`** from API routes (not raw `NextResponse.json`)
