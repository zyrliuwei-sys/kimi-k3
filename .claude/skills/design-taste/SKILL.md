---
name: design-taste
description: "Anti-slop design taste guide for landing pages, marketing blocks, and static content surfaces. Distilled from leonxlnx/taste-skill (MIT), adapted to the shipany-next stack (Next.js 15 + Tailwind v4 + shadcn/ui v4 + lucide). Read before generating any hero, feature row, pricing block, or marketing surface. Triggers automatically from quick-start, new-page, new-static-page, clone-website."
user-invocable: false
---

# Design Taste — Anti-Slop Frontend Guide

> Applies to **landing pages, marketing blocks, portfolio surfaces, static content pages, and any "above-the-fold" visual work.** Does NOT apply to dashboard tables, admin panels, or dense product UI — those follow the existing dashboard patterns, which prioritise legibility over expression.

This guide encodes the patterns that separate intentional design from AI-generated slop. Every rule has a reason. Where this guide conflicts with the shipany-next stack lock (shadcn v4 / lucide / Tailwind 4 / Inter via next/font), **the stack wins** — but the taste rules still apply on top.

---

## 1. The Design Read (before any code)

Before touching JSX, write a one-line **Design Read**:

> *"Reading this as: \<page kind> for \<audience>, with a \<vibe> language, leaning toward \<aesthetic family>."*

Examples:
- *"Reading this as: B2B SaaS landing for technical buyers, restrained minimalist language, leaning shadcn defaults + monochrome with one accent."*
- *"Reading this as: consumer AI tool for design-conscious solo users, playful editorial language, leaning warm neutrals + bento grid + Motion micro-interactions."*

If the brief is genuinely ambiguous, ask **exactly one** clarifying question — never a multi-question dump. If you can infer from context, **do not ask**.

---

## 2. The Three Dials

Set three dial values explicitly in the Design Read. Every layout, motion, and spacing decision is gated by them.

- **DESIGN_VARIANCE** — `1` (perfect symmetry) → `10` (asymmetric chaos)
- **MOTION_INTENSITY** — `1` (static, hover only) → `10` (scroll-pinned cinematic)
- **VISUAL_DENSITY** — `1` (art-gallery whitespace) → `10` (cockpit / data-packed)

| Use case | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| Landing — SaaS mainstream | 7 | 6 | 4 |
| Landing — agency / creative | 9 | 8 | 3 |
| Landing — premium consumer | 7 | 6 | 3 |
| Portfolio — designer | 8 | 7 | 3 |
| Portfolio — developer | 6 | 5 | 4 |
| Editorial / blog | 6 | 4 | 3 |
| Trust-first / public-sector / kids | 3 | 2 | 5 |

Baseline `8 / 6 / 4` when nothing in the brief overrides it.

---

## 3. Stack Discipline (shipany-next specific)

These are LOCKED by the repo. Don't propose swaps unless the user explicitly asks.

- **Framework:** Next.js 15 App Router. Server Components by default. Any component using Motion, scroll listeners, or pointer events MUST be a `"use client"` leaf.
- **Styling:** Tailwind v4 utilities + `dark:` variant. Semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`) over raw colors.
- **Components:** shadcn/ui v4 (Base Nova). **Never ship shadcn in default state** — customise radii, accent color, button shadows, card padding to match the brand brief. Add components via `npx shadcn@latest add`.
- **Icons:** `lucide-react` (locked). Standardise `strokeWidth={1.5}` globally. One icon family. Never hand-roll SVG icon paths.
- **Fonts:** `next/font` with Inter as the repo default. **Override path:** if the brief explicitly asks for a brand-appropriate display font, rotate from `Geist`, `Cabinet Grotesk`, `Satoshi`, `PP Neue Montreal`, `GT Walsheim`. Pair sans with mono (`JetBrains Mono`, `Geist Mono`) — never two competing sans.
- **Animation:** Motion (`motion/react`) for any interaction above `:hover`. **Not `framer-motion`** — the package was renamed, use the new import path.
- **i18n:** Every user-facing string goes through `next-intl`. No hardcoded English in JSX.

---

## 4. Typography

- **Display headlines:** `text-4xl md:text-6xl tracking-tighter leading-none font-semibold`. Control hierarchy with weight + color, not raw scale escalation.
- **Body:** `text-base leading-relaxed text-muted-foreground max-w-[65ch]`.
- **Italic descender clearance (mandatory):** if a display headline uses italic AND the italic word contains `y g j p q`, `leading-none` clips the descender. Use `leading-[1.1]` minimum and add `pb-1` on the wrapper. Audit every italic word in display type before shipping.
- **Emphasis inside a headline:** use italic or bold **of the same font**. Do NOT inject a random serif word into a sans headline (or vice versa) — mixed-family emphasis is amateur.
- **Serif discipline (very discouraged as default):** serif headlines are an AI tell. Use serif ONLY when the brief is explicitly editorial / luxury / publication / heritage AND you can name *why this serif fits this brand*. **Banned as defaults:** `Fraunces`, `Instrument_Serif`. If a serif IS justified, rotate from: PP Editorial New, GT Sectra, Tiempos Headline, Recoleta, Domaine Display.

---

## 5. Color

- **One accent per page.** Saturation `<80%` by default. Lock the accent — a warm-grey site does not suddenly get a blue CTA in section 7.
- **THE LILA RULE:** the AI-purple / blue-glow gradient aesthetic is discouraged as a default. Use neutral bases (zinc / slate / stone) with one high-contrast accent (emerald, electric blue, deep rose, burnt orange). Override allowed when the brand explicitly asks for purple.
- **PREMIUM-CONSUMER PALETTE BAN:** for cookware / wellness / artisan / luxury / heritage briefs, the LLM default is warm beige (`#f5f1ea`, `#fbf8f1`, `#ece6db`) + brass/clay (`#b08947`, `#b6553a`, `#9c6e2a`) + espresso (`#1a1714`). **Every premium-consumer landing the model has ever shipped uses this exact palette.** Banned as default. Reach instead for:
  - *Cold luxury:* silver-grey + chrome + smoke
  - *Forest:* deep green + bone + amber accent
  - *Architectural:* off-white + concrete grey + single saturated accent
- **No pure black (`#000`) or pure white (`#fff`).** Use `zinc-950` / off-white. Pure values kill depth.
- **WCAG AA minimum** for body text, AAA target for hero copy. Verify in both light AND dark mode.

---

## 6. Layout Mechanics (hard rules)

Failing any of these ships broken work.

- **Full-height hero:** `min-h-[100dvh]`, NEVER `h-screen`. `h-screen` jumps on iOS Safari when the address bar collapses.
- **Multi-column layouts:** CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`), NEVER flex percentage math (`w-[calc(33%-1rem)]`).
- **Container width:** `max-w-7xl mx-auto px-4 md:px-6` or `max-w-[1400px]`. Pick one and stick to it across the page.
- **Mobile collapse:** every asymmetric / multi-column layout above `md:` MUST collapse to clean single-column below `md:`. Test at 390px before shipping.
- **Z-index restraint:** only for sticky nav / modals / overlays / fixed grain. Never spam arbitrary `z-50` on regular cards.
- **No "three equal feature cards in a row" as default** — use bento (mixed cell sizes), zig-zag (alternating image-left/image-right), or asymmetric grid. Three identical cards horizontally is the #2 AI-landing tell.

---

## 7. Motion (when MOTION_INTENSITY > 3)

- **Library:** Motion (`import { motion } from "motion/react"`). NOT `framer-motion` (legacy alias).
- **NEVER `window.addEventListener("scroll", ...)`** — runs every scroll frame, jank-prone. Use `useScroll()`, `IntersectionObserver`, or CSS `animation-timeline: view()` instead.
- **NEVER track scroll position in `useState`** — re-renders the React tree per frame. Use `useMotionValue` + `useTransform`.
- **Animate ONLY `transform` and `opacity`** (hardware-accelerated). Never animate `top`, `left`, `width`, `height`.
- **`"use client"` isolation:** any component using Motion is a leaf Client Component. Server layouts wrap it; motion logic doesn't bleed into the page tree.
- **`prefers-reduced-motion` is mandatory** for MOTION > 3. Wrap with `useReducedMotion()` and degrade to static. Infinite loops, parallax, scroll-hijack collapse to instant under reduced motion.

---

## 8. AI Tells — Hard Bans

These are the patterns the model defaults to when trying to "look designed." Every one is a visible AI signature in production tests.

### 8.1 EM-DASH BAN (non-negotiable)

**Zero em-dashes (`—`) or en-dashes (`–`) as separators anywhere visible.** Headlines, eyebrows, pills, body, quotes, attribution, captions, button text, alt text — zero. No "limited use" allowance.

Replace with:
- Period or comma → for sentence breaks
- Line break → in headlines
- Colon → for label : value
- Parentheses → for asides
- Regular hyphen `-` → for ranges, compounds, attribution (` - Name`)

Allowed dash characters on the page: regular hyphen `-` and minus in math (`-5°C`). That's it.

### 8.2 Hero & top-of-page

- NO `V0.6` / `BETA` / `EARLY ACCESS` / `INVITE-ONLY PREVIEW` eyebrows as default. Only when the brief is explicitly a launch / preview status.
- NO div-based fake product UI (fake task list, fake terminal, fake dashboard built from styled `<div>`s). This is the #1 LLM-landing tell. Use a real screenshot, a generated image via `/generate-image`, or none at all.
- NO scroll cues (`Scroll`, `↓ Scroll to explore`, animated mouse-wheel icons) at hero bottom. If the user hasn't scrolled, they're looking at the hero — they know what scroll is.
- NO decoration text strips at hero bottom (`BRAND. MOTION. SPATIAL.`, `DESIGN · BUILD · SHIP`, `ESTD. 2018 · LISBON`). Agency-portfolio cliché.

### 8.3 Eyebrows & micro-meta

- NO section-number eyebrows: `00 / INDEX`, `001 · Capabilities`, `06 · how it works`. Eyebrows should name the topic plainly.
- NO `01 / 4`-style pagination on images / bento tiles.
- NO middle-dot (`·`) spam — max 1 per metadata line.
- NO floating top-right sub-paragraph in section headers (the small explainer paragraph in the upper-right corner with no clear alignment). Either put it under the headline or build a clean 2-column header.
- NO vertical rotated text (`INDEX OF WORK, 2018-2026` rotated 90°). Agency cliché.
- NO locale / weather strips (`LIS 14:23 · 18°C`, `Lisbon, working with founders`) unless the brief is genuinely about a distributed studio / travel brand / physical venue.
- NO decorative status dots on every nav item / list row / badge. Only when conveying real semantic state.

### 8.4 Content — the "Jane Doe" effect

- NO generic names: `John Doe`, `Sarah Chan`, `Jack Su`. Use creative, locale-appropriate names that sound like real customers.
- NO generic avatars (SVG egg, lucide user icon). Use believable photo placeholders (`https://i.pravatar.cc/150?u=<seed>`) or specific styling.
- NO fake-perfect numbers: `99.99%`, `50%`, `1,234,567`, `+1 (555) 123-4567`. Use organic, messy data: `47.2%`, `+1 (312) 847-1928`, `2,847 active`.
- NO startup-slop brand names in testimonials / logo walls: `Acme`, `Nexus`, `SmartFlow`, `Cloudly`, `Vertex`, `Quantum`. Invent contextual, premium-sounding names.
- NO filler verbs: `Elevate`, `Seamless`, `Unleash`, `Next-Gen`, `Revolutionize`, `Empower`, `Supercharge`. Use concrete verbs that name a real action.

### 8.5 Visual & CSS

- NO neon outer glows by default. Use inner borders or subtle tinted shadows.
- NO oversaturated accents — desaturate to harmonise with neutrals.
- NO excessive gradient text on large headlines.
- NO custom mouse cursors (outdated, accessibility-hostile).
- NO grain / noise filters on scrolling containers (continuous GPU repaints destroy mobile FPS). Apply grain ONLY to a fixed, `pointer-events-none` pseudo-element (`fixed inset-0 z-[60] pointer-events-none`).
- NO `<br>`-broken-and-italicized headlines as a default design move (`"for thirty<br><em>years.</em>"`). Headlines should read naturally first.

---

## 9. Image & Visual Assets

- Every page should have at least one real image above the fold (hero visual, product screenshot, brand photography). Pure-text heroes only when the brief is explicitly editorial / manifesto.
- For decorative imagery, generate via `/generate-image`. Pick **one consistent `style`** (e.g. `flat_design`) and reuse it across every call so the page feels cohesive.
- Always include `"no text"` in image-gen prompts — Pollinations otherwise bakes garbled fake captions into the output.
- **Placeholder photos:** `https://picsum.photos/seed/{descriptive-string}/{w}/{h}` (deterministic by seed). NOT generic `https://source.unsplash.com/...` (broken).
- **`next/image priority`** for hero images. LCP < 2.5s is the target.

---

## 10. Dark Mode

- **Mandatory for any consumer-facing page.** Never ship light-only unless the brief is print-emulating editorial.
- Use Tailwind `dark:` variant aligned with shadcn semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`). These swap automatically.
- Respect `prefers-color-scheme: dark`. The repo already has `ThemeProvider` from `next-themes` in the root layout.
- AA contrast minimum for body, AAA for hero. Test in both modes before declaring done.
- Brand accent must stay recognisable across modes. Don't desaturate the brand into oblivion in dark mode.

---

## 11. Reference Vocabulary (know these by name)

Use these as design moves when the dial values call for them. Pattern names — not libraries.

**Hero paradigms:** Asymmetric Split Hero, Editorial Manifesto Hero, Video Mask Hero, Kinetic-Type Hero, Scroll-Pinned Hero.

**Layout & grid:** Bento Grid (Apple-style mixed tile sizes), Masonry, Split-Screen Scroll, Sticky-Stack Sections, Zig-Zag (alternating image-left/right rows).

**Cards & containers:** Parallax Tilt Card, Spotlight Border Card (border lights under cursor), Glassmorphism Panel, Morphing Modal.

**Scroll motion:** Sticky Scroll Stack, Horizontal Scroll Hijack, Zoom Parallax, Scroll Progress Path (SVG line drawing).

**Type effects:** Kinetic Marquee, Text Mask Reveal, Text Scramble, Gradient Stroke.

**Micro-interactions:** Magnetic Button, Directional Hover-Aware Button (fill enters from cursor's side), Skeleton Shimmer, Ripple Click.

---

## 12. Pre-Flight Check (run before declaring done)

This is not optional. Walk every box.

- [ ] Stated the Design Read one-liner before generating
- [ ] Set explicit dial values (VARIANCE / MOTION / DENSITY)
- [ ] **ZERO em-dashes (`—`) or en-dashes (`–`) anywhere visible** (headlines, eyebrows, pills, body, quotes, captions, alt text)
- [ ] No banned hero tells (`V0.6` pills, fake screenshot built from `<div>`s, scroll cue at bottom, decoration text strip)
- [ ] No banned eyebrows (section numbers, `01 / 4` pagination, locale strips, vertical rotated text)
- [ ] No "three equal feature cards in a row" — bento / zig-zag / asymmetric instead
- [ ] One accent color locked across the whole page
- [ ] No generic names / avatars / fake-perfect numbers / startup-slop brand names in testimonials
- [ ] CSS Grid (not flex math) for multi-column
- [ ] Hero uses `min-h-[100dvh]` (never `h-screen`)
- [ ] All motion components are `"use client"` leaves
- [ ] `prefers-reduced-motion` handled if MOTION > 3
- [ ] Page tested in both light and dark mode at 390px / 768px / 1440px
- [ ] At least one real image above the fold (real, generated, or none — never a div-based fake)
- [ ] Lucide icons use consistent `strokeWidth={1.5}`
- [ ] shadcn components customised (radii / shadows / accent) — never default state
- [ ] All visible strings go through `next-intl`

---

## Out of Scope

This guide applies to landing, marketing, pricing, about, portfolio, and static content surfaces. **For dashboard tables, admin panels, multi-step forms, settings pages** — the existing dashboard patterns (`AppLayout`, predictable single-accent shadcn cards, dense data) take priority. Taste rules still apply to typography, spacing, and color even there — but layout vocabulary in dashboards is intentionally conservative.

---

## Attribution

Distilled from [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) (MIT), adapted to the shipany-next stack. The original 87KB skill carries deeper guidance on design systems (Fluent / Carbon / Material / Atlassian), GSAP scroll-pinning skeletons, and a Block Library. Read the source when the brief calls for something this guide doesn't cover.
