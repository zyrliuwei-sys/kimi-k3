---
name: quick-start
description: "Build a complete SaaS project from a brief, reference URL, or content source. Handles everything: project config, pixel-perfect landing page (cloned from reference or generated), content extraction, dashboard pages, module wiring. Use when the user says they want to build something, gives a reference URL, provides a GitHub repo, or describes a product idea. Triggers on: 'new project', 'build a site for...', 'make it look like...', 'clone this...', 'I want to build...', any URL + product description combo."
argument-hint: "<what to build — product brief, reference URL, content source URL, or all three>"
user-invocable: true
---

# Quick Start — $ARGUMENTS

You are building a complete SaaS project. Parse the user's input to determine which mode to run:

## Input Parsing

From "$ARGUMENTS", extract:

- **App name** — the product name (required; ask if not provided)
- **App description** — what the product does
- **Reference URL** — a website whose visual design/layout to replicate (optional)
- **Content source** — where to get text/images: a URL, a GitHub repo, or the user's description (optional; falls back to user's description)
- **Domain** — production URL if known (default: `http://localhost:3000`)
- **Features** — what the user wants to build (helps decide modules + dashboard pages)

## Mode Selection

Based on what the user provided, automatically select the right mode:

### Mode A: Reference Site + Content Source
**Triggers:** User provided a reference URL (and optionally a separate content source)
**Example:** "做一个 AI 写作工具叫 WriteAI，参考 jasper.ai 的网站风格，内容参考 https://github.com/xxx/yyy 的 README"
**Action:** Full pipeline — extract reference site's design, extract content from source, generate pixel-perfect landing page with swapped content, wire up modules.

### Mode B: Reference Site Only
**Triggers:** User provided a reference URL but no separate content source
**Example:** "参考 linear.app 做一个项目管理工具"
**Action:** Extract reference site's design AND content structure, rewrite content based on user's product description, generate pixel-perfect landing page.

### Mode C: Description Only
**Triggers:** No reference URL, just a product description
**Example:** "做一个 AI 壁纸生成器，叫 WallpaperAI，用户输入提示词生成壁纸，按月订阅"
**Action:** Generate a polished landing page from scratch using modern SaaS design patterns, wire up modules.

---

## Phase 0: Project Config (all modes)

### 0.1 Ask the user what they need

Before doing anything, ask the user these questions (skip any already answered in "$ARGUMENTS"):

1. **App name and description** — "What's the product called? One sentence describing what it does."
2. **Database** — "Do you need a database? If yes, which one?"
   - **SQLite** (default) — zero setup, good for prototyping and small apps. Data stored in a local file.
   - **PostgreSQL** — production-grade, recommended for most SaaS apps.
   - **MySQL** — if the user already has a MySQL instance or preference.
   - **None** — skip database setup entirely (static site, no auth/payment features).
3. **Domain** — "Do you have a domain? Or just localhost for now?"

If the user doesn't specify, default to **SQLite** and move on — don't block on this.

### 0.2 Configure environment

Update `.env.local`:
```env
NEXT_PUBLIC_APP_URL=<domain or http://localhost:3000>
NEXT_PUBLIC_APP_NAME=<App Name>
NEXT_PUBLIC_APP_DESCRIPTION=<description>
DATABASE_PROVIDER=<sqlite|postgres|mysql>
DATABASE_URL=<connection string>
```

Default `DATABASE_URL` values:
- SQLite: `file:data/local.db`
- PostgreSQL: `postgresql://user:pass@localhost:5432/dbname`
- MySQL: `mysql://user:pass@localhost:3306/dbname`

### 0.3 Initialize database schema

Run `pnpm db:setup` — this copies the matching dialect template into `schema.ts` based on `DATABASE_PROVIDER`:

```bash
pnpm db:setup    # reads DATABASE_PROVIDER from .env.local, copies the right template
```

Or manually:
```bash
cp src/config/db/schema.sqlite.ts src/config/db/schema.ts    # SQLite
cp src/config/db/schema.postgres.ts src/config/db/schema.ts  # PostgreSQL
cp src/config/db/schema.mysql.ts src/config/db/schema.ts     # MySQL
```

`schema.ts` is gitignored — it's the user's working copy. The three template files are committed to git as the base schema.

### 0.4 Push schema and initialize

```bash
pnpm db:push                                  # create tables
pnpm rbac:init --admin-email=<email> --admin-password=<password>  # create roles + admin user
```

Ask the user for their admin email and password. If they don't provide one, just run `pnpm rbac:init` without the flags and tell them to create a user via sign-up page, then promote manually.

### 0.5 Update translations

Update `src/config/locale/messages/en/common.json` and `zh/common.json`:
- Set `metadata.title` and `metadata.description` to the app name and description.

Decide which modules to keep based on user's features. Default: keep all. Only remove if the user explicitly doesn't need something.

---

## Phase 1: Reconnaissance (Mode A & B only)

**Prerequisite:** Browser MCP is required. Check for Chrome MCP, Playwright MCP, Browserbase MCP, or Puppeteer MCP. If none are available, ask the user which browser tool they have. This phase cannot proceed without browser automation.

### 1.1 Reference Site Analysis

Navigate to the reference URL with browser MCP.

**Screenshots:**
- Full-page screenshots at desktop (1440px) and mobile (390px)
- Save to `docs/design-references/`

**Design Token Extraction:**

Fonts — Inspect `<link>` tags for Google Fonts or self-hosted fonts. Check computed `font-family` on headings, body, labels. Document every family, weight, style.

Colors — Extract the color palette via computed styles across the page. Run this script:

```javascript
// Run via browser MCP to extract color palette
(function() {
  const els = [...document.querySelectorAll('*')].slice(0, 500);
  const colors = new Set();
  const fonts = new Set();
  els.forEach(el => {
    const cs = getComputedStyle(el);
    [cs.color, cs.backgroundColor, cs.borderColor].forEach(c => {
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colors.add(c);
    });
    fonts.add(cs.fontFamily.split(',')[0].trim().replace(/['"]/g, ''));
  });
  return JSON.stringify({
    colors: [...colors].slice(0, 30),
    fonts: [...fonts].filter(f => f && f !== 'Times New Roman' && f !== 'serif'),
  }, null, 2);
})();
```

**Layout Structure — Map every section from top to bottom:**

```javascript
// Run via browser MCP to extract page sections
(function() {
  const body = document.body;
  const sections = [];
  // Get direct children or semantic sections
  const candidates = [...body.querySelectorAll('header, nav, main, section, footer, [class*="hero"], [class*="feature"], [class*="pricing"], [class*="cta"], [class*="faq"]')];
  candidates.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    sections.push({
      index: i,
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().split(' ').slice(0, 5).join(' '),
      top: Math.round(rect.top + window.scrollY),
      height: Math.round(rect.height),
      background: cs.backgroundColor,
      display: cs.display,
      childCount: el.children.length,
      textPreview: el.textContent?.trim().slice(0, 100),
    });
  });
  return JSON.stringify(sections, null, 2);
})();
```

Document findings as a section list:
```
1. Header/Nav — sticky, height 64px, transparent → solid on scroll
2. Hero — full viewport, gradient bg, heading + subtext + 2 CTAs
3. Logos — client logo bar, grayscale
4. Features — 3-column grid, icon + title + description cards
5. Pricing — 3 tiers, highlight middle, toggle monthly/annual
6. FAQ — accordion
7. CTA — centered, gradient bg
8. Footer — 4-column links + copyright
```

**Interaction Sweep:**

Scroll top-to-bottom slowly, observing:
- Header behavior on scroll (shrink, bg change, shadow)
- Elements animating into view (fade-up, slide-in)
- Scroll-snap points
- Parallax or scroll-driven effects

Click every interactive element:
- Tabs, pills, toggles — record content for EACH state
- Buttons — what happens
- Accordions — open/close behavior

Hover over interactive elements:
- Cards, buttons, links — record what changes (color, scale, shadow)

### 1.2 Content Extraction

**If Mode A (separate content source):**

If content source is a GitHub URL:
- Fetch the README via `https://raw.githubusercontent.com/<owner>/<repo>/main/README.md` (or master)
- Also fetch repo metadata: name, description, stars, topics
- Extract: product name, tagline, feature list, screenshots, code examples

If content source is another URL:
- Navigate to it with browser MCP
- Extract all text content section by section
- Download images
- Structure as: hero text, features, testimonials, FAQ, etc.

**If Mode B (content from reference site itself):**

Extract all text from the reference site, then rewrite it:
- Keep the structure (hero heading, feature titles, pricing tiers)
- Replace the content to match the user's product description
- Maintain the same tone and copywriting style

### 1.3 Asset Collection

Download all images and videos from the reference site:

```javascript
// Run via browser MCP to enumerate assets
JSON.stringify({
  images: [...document.querySelectorAll('img')].map(img => ({
    src: img.src || img.currentSrc,
    alt: img.alt,
    width: img.naturalWidth,
    height: img.naturalHeight,
    position: getComputedStyle(img).position,
  })),
  videos: [...document.querySelectorAll('video')].map(v => ({
    src: v.src || v.querySelector('source')?.src,
    poster: v.poster,
    autoplay: v.autoplay,
    loop: v.loop,
  })),
  backgroundImages: [...document.querySelectorAll('*')].filter(el => {
    const bg = getComputedStyle(el).backgroundImage;
    return bg && bg !== 'none';
  }).map(el => ({
    url: getComputedStyle(el).backgroundImage,
    element: el.tagName + '.' + (el.className?.toString().split(' ')[0] || ''),
  })),
  svgCount: document.querySelectorAll('svg').length,
}, null, 2);
```

For Mode A/B: Download assets from the reference site to `public/images/`. For content-source images (GitHub screenshots, etc.), also download to `public/images/`.

For SVG icons, extract inline SVGs as React components into `src/components/icons.tsx`.

---

## Phase 2: Foundation Build (all modes)

### Mode A & B:

1. **Update fonts** in `src/app/layout.tsx` — configure `next/font/google` or `next/font/local` with the extracted fonts
2. **Update `src/app/globals.css`** — replace color tokens with the reference site's palette:
   - Map to shadcn's variables: `--background`, `--foreground`, `--primary`, `--muted`, etc.
   - Add custom properties for colors that don't fit shadcn tokens
   - Add keyframe animations observed on the reference site
   - Add global patterns (smooth scroll, custom scrollbar, etc.)
3. **Create icon components** in `src/components/icons.tsx` from extracted SVGs
4. Verify: `pnpm build`

### Mode C:

1. Keep the default font (Inter) or pick a modern alternative if the product brief suggests a style
2. Pick a color scheme that fits the product:
   - Developer tools → dark with accent (blue/green/purple)
   - Consumer SaaS → clean white with vibrant accent
   - Creative tools → bold, colorful
   - Enterprise → conservative, trust-building
3. Update `globals.css` color tokens accordingly
4. Verify: `pnpm build`

---

## Phase 3: Page Construction

### 3.1 Landing Page (`src/app/[locale]/page.tsx`)

**Mode A & B — Pixel-perfect from reference:**

For each section identified in Phase 1, extract exact CSS values:

```javascript
// Per-section CSS extraction — run via browser MCP
// Replace SELECTOR with the section's CSS selector
(function(selector) {
  const el = document.querySelector(selector);
  if (!el) return JSON.stringify({ error: 'Not found: ' + selector });
  const props = [
    'fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','color',
    'textTransform','textDecoration','backgroundColor','background',
    'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'margin','marginTop','marginRight','marginBottom','marginLeft',
    'width','height','maxWidth','minWidth','maxHeight','minHeight',
    'display','flexDirection','justifyContent','alignItems','gap',
    'gridTemplateColumns','gridTemplateRows',
    'borderRadius','border','boxShadow','overflow',
    'position','top','right','bottom','left','zIndex',
    'opacity','transform','transition','cursor',
    'objectFit','backdropFilter'
  ];
  function extractStyles(element) {
    const cs = getComputedStyle(element);
    const styles = {};
    props.forEach(p => {
      const v = cs[p];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') styles[p] = v;
    });
    return styles;
  }
  function walk(element, depth) {
    if (depth > 4) return null;
    return {
      tag: element.tagName.toLowerCase(),
      classes: element.className?.toString().split(' ').slice(0, 5).join(' '),
      text: element.childNodes.length === 1 && element.childNodes[0].nodeType === 3
        ? element.textContent.trim().slice(0, 200) : null,
      styles: extractStyles(element),
      images: element.tagName === 'IMG' ? { src: element.src, alt: element.alt } : null,
      children: [...element.children].slice(0, 20).map(c => walk(c, depth + 1)).filter(Boolean),
    };
  }
  return JSON.stringify(walk(el, 0), null, 2);
})('SELECTOR');
```

Build each section as a React component in `src/components/landing/`. Use the extracted CSS values translated to Tailwind classes. Where Tailwind doesn't have an exact match, use arbitrary values: `text-[18px]`, `tracking-[-0.02em]`, `gap-[28px]`.

**For multi-state sections** (tabs, carousels, scroll-driven):
- Identify the interaction model BEFORE building (scroll-driven vs click-driven)
- Click/scroll through each state via browser MCP
- Extract content and styles for EVERY state
- Implement the same interaction mechanism

**Content replacement (Mode A):**
- Keep the exact same component structure and styling
- Replace text content with content from the content source
- Replace images where appropriate (keep decorative/UI images, replace product screenshots)

**Content rewrite (Mode B):**
- Keep exact structure and styling
- Rewrite text to match the user's product
- Replace product screenshots with placeholders or user-provided images

Assemble all section components in `src/app/[locale]/page.tsx` (replacing the blank default) in the same order as the reference site.

**Mode C — Generated from scratch:**

Build a modern SaaS landing page with these sections:
1. **Header** — logo (app name text), nav links (Features, Pricing), Sign In, Get Started CTA. Use `Link` from `@/core/i18n/navigation`, `LocaleSelector` from `@/components/locale-selector`, `ThemeToggle` from `@/components/theme-toggle`
2. **Hero** — large heading, subtext, 1-2 CTAs, optional hero image/illustration
3. **Features** — 3-6 feature cards with icons, titles, descriptions (from user's brief)
4. **How It Works** — 3-step process or visual flow (if applicable)
5. **Pricing** — tier cards with feature lists, connected to payment module
6. **FAQ** — accordion with common questions
7. **CTA** — final call-to-action section
8. **Footer** — links (Privacy Policy → `/privacy-policy`, Terms → `/terms-of-service`), copyright, social icons

Make it visually polished — use gradients, subtle shadows, proper spacing, animations (fade-in on scroll). Don't generate a "template-looking" page.

### 3.2 Auth Pages

Auth pages (`src/app/[locale]/(auth)/sign-in/page.tsx` and `sign-up/page.tsx`) are already built with:
- shadcn login-03 block styling (Card + Field components)
- i18n translations from `common.sign.*`
- Social login buttons (Google/GitHub) that auto-show based on admin config
- No changes needed unless the user wants a custom design.

### 3.3 Dashboard Pages

Dashboard pages are client-side rendered, using `AppLayout` from `@/components/app-layout`.

Based on the user's features, create dashboard pages:

1. **Dashboard home** (`src/app/[locale]/dashboard/page.tsx`) — already has stats cards (credits, API keys, plan, usage). Customize for the product.

2. **Core product page(s)** — the main feature the user described:
   - `src/app/[locale]/dashboard/<feature>/page.tsx` — use `"use client"`, fetch data from `/api/<feature>`
   - Wire up to existing modules or create new ones with `/new-module` pattern

3. **Update nav items** in `src/app/[locale]/dashboard/layout.tsx` — add entries to the `navItems` array

### 3.4 Legal Pages

Generate legal pages as MDX in the `(pages)` route group:
- Privacy Policy already exists at `src/app/[locale]/(pages)/privacy-policy/page.mdx` — update content for the product
- Terms of Service at `src/app/[locale]/(pages)/terms-of-service/page.mdx` — update content
- Add more if needed (e.g., refund policy) using `/new-static-page` pattern

### 3.5 Module Wiring

Connect landing page elements to modules:

| Landing Page Element | Module Connection |
|---|---|
| Pricing section "Get Started" button | → `/api/payment/checkout` |
| "Sign Up" CTA | → `/sign-up` (auth, locale-aware Link) |
| Pricing toggle (monthly/annual) | Client-side state, pass to checkout |
| Feature usage stats on dashboard | → `/api/credits` for balance |
| User settings | Already wired (`/dashboard/settings`) |
| API key management | Already wired (`/dashboard/api-keys`) |
| Admin panel | Already wired (`/admin`) |
| Privacy/Terms footer links | Already wired (`/privacy-policy`, `/terms-of-service`) |

---

## Phase 4: Responsive & Polish

1. **Test at 3 viewports** — 1440px, 768px, 390px
2. For Mode A/B: match the reference site's responsive behavior (browser MCP at each width)
3. For Mode C: ensure mobile-first responsive design
4. **Scroll animations** — add `IntersectionObserver`-based fade-in for sections
5. Verify: `pnpm build`

---

## Phase 5: Visual QA (Mode A & B only)

Take screenshots of your generated pages and compare with the reference site:

1. Side-by-side at desktop (1440px) — section by section
2. Side-by-side at mobile (390px)
3. For each discrepancy: re-extract CSS from browser MCP, fix the component
4. Test interactions: scroll behavior, hover states, tab switching, animations
5. Verify: `pnpm build`

---

## Completion Report

Report:
- App name and URL configured
- Mode used (A/B/C) and why
- Design tokens extracted (fonts, colors) — or generated
- Sections built (list each component)
- Dashboard pages created
- Modules kept/removed/wired
- Assets downloaded (count)
- Build status
- Remaining TODOs for the user:
  - API keys to configure (Stripe, Resend, etc.)
  - Content to customize
  - `pnpm dev` to start iterating

---

## Rules

1. **Pixel-perfect for Mode A/B.** Don't approximate — extract exact CSS values. Use `text-[18px] leading-[24px]`.
2. **Real content, not placeholders.** Extract actual text and images. Only use placeholders if the user explicitly provides no content.
3. **Foundation before components.** Fonts and colors in globals.css FIRST, then build sections.
4. **Don't skip interaction extraction.** Scroll before clicking. Identify the interaction model before building.
5. **Every state must be captured.** If there are 4 tabs, extract content for all 4.
6. **Use the module system.** Business logic goes in `src/modules/`, not in page components.
7. **Use `envConfigs.app_name`** — never hardcode the app name.
8. **Imports:** `respData`/`respErr` from `@/lib/resp`. `Link`/`useRouter` from `@/core/i18n/navigation`. `getUuid` from `@/lib/hash`.
9. **Dashboard pages are "use client"** — fetch data from API routes, use `useTranslations` for i18n.
10. **`pnpm build` must pass** at every checkpoint.
11. **shadcn/ui v4 (Base Nova)** — no `asChild` prop. Use `className={cn(buttonVariants())}` on Link.
12. **i18n** — all user-facing text should use translation keys. Update `src/config/locale/messages/{en,zh}/` and register new paths in `src/config/locale/index.ts`.
13. **Legal pages** — use MDX in `src/app/[locale]/(pages)/`. Layout is shared.
14. **Static pages** — use `/new-static-page` skill for additional content pages.
15. **For complex landing pages** (Mode A/B with 8+ sections), use worktree agents to build sections in parallel.
