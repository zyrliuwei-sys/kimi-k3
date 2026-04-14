# ShipAny Next

A headless SaaS engine for building AI-powered products with Claude Code. Pre-wired business logic (payments, credits, subscriptions, auth, RBAC, i18n) with minimal UI — you build your product pages on top.

## Quick Start

```bash
pnpm install
pnpm db:push
pnpm rbac:init --admin-email=admin@example.com --admin-password=your-password
pnpm dev
```

## Features

- **Auth** — Email/password + Google/GitHub OAuth via better-auth
- **Payment** — Stripe, PayPal, Creem (checkout, subscriptions, webhooks)
- **Credits** — FIFO consumption, expiration, auto-grant on signup
- **RBAC** — Roles, permissions, wildcard matching
- **API Keys** — CRUD + validation
- **i18n** — English + Chinese via next-intl, locale-aware routing
- **Admin** — User management, role assignment, system settings
- **Dashboard** — Client-side rendered, shadcn sidebar
- **MDX Pages** — Privacy policy, terms of service, extensible via skill
- **Database** — SQLite (dev) / PostgreSQL / MySQL via Drizzle ORM
- **All code self-contained** — no external packages for business logic

## Tech Stack

- Next.js 15 (App Router, React 19, TypeScript)
- shadcn/ui v4 (Base Nova style, Tailwind CSS 4)
- better-auth + Drizzle ORM
- next-intl for i18n

## Project Structure

```
src/
├── core/           # Infrastructure (db, auth, payment, email, storage, ai, i18n)
├── modules/        # Business logic (payment, credits, subscriptions, apikeys, rbac)
├── config/         # Environment, DB schema, locale translations
├── app/
│   ├── [locale]/   # Pages (landing, auth, dashboard, admin, legal)
│   └── api/        # REST endpoints
├── components/     # Shared UI (app-layout, app-sidebar, user-menu, shadcn)
└── lib/            # Utilities (hash, resp, cookie, cache, rate-limit)
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm db:setup` | Copy schema template for chosen database |
| `pnpm db:push` | Push schema to database (dev) |
| `pnpm db:generate` | Generate migration SQL (production) |
| `pnpm db:migrate` | Run migrations (production) |
| `pnpm db:studio` | Drizzle Studio GUI |
| `pnpm rbac:init` | Create roles + permissions + optional admin user |
| `pnpm rbac:assign` | Assign role to user |

## Claude Code Skills

| Skill | What it does |
|-------|-------------|
| `/quick-start` | Build a complete SaaS from a brief or reference URL |
| `/new-module` | Create a backend module (service + API) |
| `/new-page` | Create a dashboard page (client component + nav) |
| `/new-static-page` | Create an MDX content page (legal, about, FAQ) |

## Environment Variables

```env
# Required
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=My App
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:data/local.db
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Optional
NEXT_PUBLIC_DEFAULT_LOCALE=en
STRIPE_SECRET_KEY=
RESEND_API_KEY=
REPLICATE_API_TOKEN=
```

## License

MIT
