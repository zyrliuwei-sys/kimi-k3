---
name: new-page
description: "Create a new page in the dashboard with proper patterns — client component, API integration, nav entry. Use when the user asks to add a page, create a view, build a dashboard section, or says 'I need a page for...'"
argument-hint: "<page name and what it should show/do>"
user-invocable: true
---

# New Page — $ARGUMENTS

Create a new dashboard page based on the user's description.

> **Note:** Dashboard pages prioritise legibility over expression. The taste rules in `.claude/skills/design-taste/SKILL.md` still apply to typography, spacing, color, and the em-dash ban — but the layout vocabulary for dashboards (predictable cards, semantic shadcn tokens, single accent) is intentionally conservative. Skim design-taste sections 4 (Typography), 5 (Color), 8.1 (Em-dash ban), and 8.4 (Jane Doe content) before writing any user-facing strings.

## Step 1: Determine Page Requirements

From "$ARGUMENTS", figure out:
- **Route path:** e.g., `/dashboard/projects`
- **Data source:** Which module service to call? Does it need a new API route?
- **Interactivity:** Is this a read-only list, a CRUD form, or both?
- **Components needed:** Tables, cards, forms, dialogs?

## Step 2: Create API Route (if needed)

If the page needs data from the server, create or verify the API route exists.

**Pattern:** `src/app/api/<feature>/route.ts`

```typescript
import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import * as featureService from '@/modules/<feature>/service';

export async function GET() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return respErr('Unauthorized');

  const data = await featureService.list(session.user.id);
  return respData(data);
}
```

## Step 3: Create the Page

**All dashboard pages are client components** — they fetch data from API routes.

```typescript
// src/app/[locale]/dashboard/<feature>/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export default function FeaturePage() {
  const t = useTranslations();
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch("/api/<feature>").then(r => r.json()).then(res => {
      if (res.code === 0) setData(res.data);
    });
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feature</h1>
        <p className="text-muted-foreground text-sm mt-1">Description</p>
      </div>
      {/* Content */}
    </div>
  );
}
```

## Step 4: Add shadcn Components

Check if the page needs components not yet added. If so:
```bash
npx shadcn@latest add table dialog badge
```

**Remember:** shadcn v4 (Base Nova) does NOT support `asChild`. For Link-as-Button:
```tsx
<Link href="..." className={cn(buttonVariants({ variant: "outline" }))}>
```

## Step 5: Add Translation Keys

Add translation keys for the page:
1. Create or update `src/config/locale/messages/en/dashboard.json` with new keys
2. Create or update `src/config/locale/messages/zh/dashboard.json` with Chinese translations
3. Use `const t = useTranslations()` and `t('dashboard.<feature>.xxx')` in the component

## Step 6: Add Navigation Entry

Update `src/app/[locale]/dashboard/layout.tsx` — add an entry to the `navItems` array:

```typescript
import { SomeIcon } from "lucide-react";

const navItems = [
  // existing items...
  { href: "/dashboard/<feature>", label: t("dashboard.nav.<feature>"), icon: SomeIcon },
];
```

## Step 7: Add Visuals (optional)

If the page has an empty state, a hero header, or a section that would feel sparse with text alone, invoke the `/generate-image` skill once per visual:

- **Empty state** (no data yet): `flat_design` illustration, 600×400, slug like `empty-projects`. Reference it from the empty-state placeholder.
- **Page hero** (above the table/grid): wide background image, 1280×400 or 1600×500, slug like `<feature>-hero`.

The skill saves to `public/imgs/generated/` and returns a `/imgs/generated/<file>.png` URL ready for `<Image src=...>`. Always include `"no text"` in the prompt — Pollinations otherwise bakes garbled fake captions into the image. Skip image generation entirely for pages that are purely tabular or form-driven.

## Step 8: Verify

Run `pnpm build` to verify the page compiles.

## Rules

- **All dashboard pages are `"use client"`** — no server components in the dashboard.
- **Fetch data from API routes** — don't import modules directly in pages.
- **Page layout is inherited** from `AppLayout` via the dashboard layout — sidebar, header, auth guard are automatic.
- **Use `useTranslations`** from `next-intl` for all user-facing text.
- **Use `Link` from `@/core/i18n/navigation`** — locale-aware navigation.
- **Use semantic Tailwind classes** — `bg-card`, `text-muted-foreground`, `border-border`, not raw colors.
- **Import icons from `lucide-react`** — `import { SomeIcon } from "lucide-react"`.
- **Keep pages focused** — one page does one thing.
