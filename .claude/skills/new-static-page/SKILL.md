---
name: new-static-page
description: "Create a static content page (privacy policy, refund policy, cookies, about, etc.) as MDX in the (pages) route group. Use when the user asks for a legal page, info page, static page, or says 'add a page for...', 'I need a refund policy', 'create an about page'."
argument-hint: "<page type and any specific details>"
user-invocable: true
---

# New Static Page — $ARGUMENTS

Create a static MDX content page based on the user's description.

> **Taste guard:** static pages are body copy with a heading hierarchy — typography and language discipline matter more than layout. Before writing the MDX, skim `.claude/skills/design-taste/SKILL.md` sections 4 (Typography), 8.1 (**em-dash ban — zero `—` or `–` anywhere visible**), and 8.4 (Jane Doe content — no generic example names, fake addresses, or placeholder dates). For an "About" page specifically, also apply sections 5 (Color) and 11 (Reference Vocabulary) if you compose any custom blocks beyond plain prose.

## Step 1: Determine Page Details

From "$ARGUMENTS", figure out:
- **Page type:** privacy policy, terms of service, refund policy, cookies policy, about, FAQ, contact, etc.
- **Route slug:** e.g., `refund-policy`, `cookies`, `about`, `faq`
- **Content specifics:** any details the user mentioned (e.g., "30-day refund window", "we use Google Analytics cookies")

## Step 2: Create the MDX File

Create the file at `src/app/[locale]/(pages)/<slug>/page.mdx`.

All pages in the `(pages)` route group automatically get:
- Back link to homepage
- `prose` typography styling
- Clean centered layout (max-w-3xl)

**MDX template:**

```mdx
# Page Title

*Last updated: YYYY-MM-DD*

## Section 1

Content here...

## Section 2

- List item 1
- List item 2

## Contact

If you have questions, please contact us at the email address provided on our website.
```

## Step 3: Generate Content

Write professional, complete content in Markdown. Guidelines:

- **Pure Markdown** — no JSX imports needed, the layout handles everything
- **Be thorough** — cover all standard sections for that page type
- **Use standard Markdown** — `#` for headings, `-` for lists, `*text*` for emphasis
- **Keep it generic enough** to work for any SaaS but specific enough to be useful
- **Include "Last updated" date** and a "Contact" section

### Content guidelines by type:

**Refund Policy:** cancellation process, refund timeframe, eligible/ineligible items, how to request
**Cookie Policy:** what cookies are used, types (essential, analytics, marketing), how to manage, third-party cookies
**About:** company mission, what the product does, team info placeholder
**FAQ:** common questions about the service, billing, accounts, data
**Contact:** email, support hours, response time expectations

## Step 4: Verify

Run `pnpm build` to verify.

## Step 5: Report

Tell the user:
- Page URL: `/<slug>`
- File location: `src/app/[locale]/(pages)/<slug>/page.mdx`
- Suggest adding a link in the landing page footer

## Rules

1. **MDX files only** — no `.tsx` pages in `(pages)/`
2. **Pure Markdown content** — no React imports needed (the layout wraps everything)
3. **`(pages)` route group** — shared layout with back link + prose typography
4. **Slug format** — lowercase, hyphenated (e.g., `refund-policy`, not `refundPolicy`)
5. **`pnpm build` must pass** after creating the page
