# GalleryBackground (lorka.ai/image community wall) Specification

## Overview

- **Source:** https://www.app.lorka.ai/image
- **Target file:** `src/blocks/api-playground.tsx` → `GalleryBackground`
- **Screenshot:** `docs/design-references/lorka-image-desktop-full.png`
- **Interaction model:** **user-scrolled** (native scroll on an inner container).
  NOT an auto-scrolling marquee. No Lenis, no scroll-snap
  (`scrollBehavior: auto`, `scrollSnapType: none`).

## DOM Structure

```
main (sidebar-inset, bg-background, m-8px, rounded-xl, shadow-sm)
└── div.relative.flex.flex-1.flex-col.overflow-hidden
    ├── tab bar (absolutely floated, top-center, z above wall)
    ├── div.flex-1.outline-none.overflow-hidden
    │   └── div.no-scrollbar.h-full.overflow-y-auto.overscroll-y-none.pb-32   ← SCROLL TRACK
    │       └── div.min-h-screen
    │           ├── div.relative.w-full   ← masonry canvas, explicit px height
    │           │   └── 47 × div.absolute.cursor-pointer.overflow-hidden      ← tiles
    │           │       └── div.group/card.relative.size-full
    │           │           ├── img.object-cover (position:absolute, inset:0)
    │           │           └── div.pointer-events-none.absolute.inset-0.flex.items-center
    │           │                  .justify-center.bg-black/0.transition-all.duration-300
    │           │                  .group-hover/card:bg-black/20
    │           │               └── svg (action icon, revealed on hover)
    │           └── CTA end-cap ("Your turn to create")
    └── composer (absolute bottom-center)
```

## Computed Styles

### Masonry canvas (`div.relative.w-full`)

- position: relative; width: 100%
- height: explicit px (3212px at 1440 / 47 tiles) — computed from packed column heights

### Tile wrapper

- position: absolute
- inset driven by `top` + `left` (measured `inset: "0px 944px 2800.27px 0px"` → they set all four)
- width: 232px (desktop 1440)
- overflow: hidden
- borderRadius: **0px** (no rounding — tiles butt together)
- cursor: pointer
- transform: matrix(1,0,0,1,0,0) (identity — layer promotion only)

### Tile image

- position: absolute; inset: 0
- width/height: 100% of wrapper
- objectFit: cover
- maxWidth: 100%
- **No filter, no mix-blend-mode, no glow.** Images render clean.

### Hover overlay

- `absolute inset-0 flex items-center justify-center`
- backgroundColor: `rgba(0,0,0,0)` → `rgba(0,0,0,0.20)` on card hover
- transition: `all 300ms`
- pointer-events: none; centered SVG icon revealed

## Grid Metrics (measured)

| Viewport | Container W | Columns | Column lefts          | Tile W | Gap |
| -------- | ----------- | ------- | --------------------- | ------ | --- |
| 1440px   | 1176px      | **5**   | 0, 236, 472, 708, 944 | 232px  | 4px |
| 768px    | 504px       | **3**   | 0, 169, 339           | 165px  | 4px |
| 390px    | 390px       | **2**   | 0, 197                | 193px  | 4px |

- Horizontal gap: **4px**, vertical gap: **4px** (col0 rows: y=0 h=412 → next y=416)
- **Packing:** shortest-column-first (greedy). Verified — tiles do not go in
  round-robin order; e.g. col0 gets a 412px tile then the next col0 tile starts
  at 416 while other columns are still on their first tile.
- Tile height = `tileW / aspectRatio`, from the filename ratio:
  - `9_16` → 232×412, `2_3` → 232×348, `4_5` → 232×290, `1_1` → 232×232,
    `3_2` → 232×155, `16_9` → 232×130

## Aspect ratio distribution (from 47-image catalog)

`2_3` dominates (32 of 47), then `9_16` ×6, `3_2` ×4, `16_9` ×2, `4_5` ×1, `1_1` ×1.

## Tab bar (floating, above the wall)

- Wrapper: `pointer-events-auto relative inline-flex h-10 items-center rounded-xl bg-sidebar/80 px-1 backdrop-blur-sm select-none`
  - height 40px, padding 0 4px, borderRadius 24px
  - backgroundColor `oklab(0.985 … / 0.8)`, backdropFilter `blur(8px)`
- Tab button: `relative z-10 inline-flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium`
  - height 32px, padding 0 14px, fontSize 14px/20px, weight 500, gap 6px, borderRadius 24px
  - active `text-foreground`, inactive `text-muted-foreground`
- Labels: `Community` · `Quick Actions` · `My Images` (each with a leading icon)

## CTA end-cap (below the wall, inside the scroll track)

- Heading: `P`, `text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl`
  → 30px/36px, weight 700, letterSpacing -0.75px
  - Text: **"Your turn to create"**
- Sub: `mt-3 max-w-xs text-center text-sm leading-relaxed text-muted-foreground`
  → 14px/22.75px, maxWidth 320px, marginTop 12px
  - Text: **"Everything you just scrolled through was made with a single prompt."**
- Button: `mt-8`, height 40px, padding 0 12px, borderRadius 18px, fontSize 14px,
  weight 500, gap 8px, `bg-white border`, shadow `0 1px 2px rgba(0,0,0,0.05)`,
  transition `0.15s cubic-bezier(0.4,0,0.2,1)`
  - Text: **"Start creating"**

## Scroll track

- `no-scrollbar h-full overflow-y-auto overscroll-y-none pb-32`
- paddingBottom 128px (clears the floating composer)
- scrollbar hidden, overscroll contained

## Assets

Reuse the 46 existing local images in `public/gallery/` (`poll-00..28.jpg`,
`u-12..35.jpg`). Do NOT hotlink lorka's `/galleries/image/*.webp`. Assign
aspect ratios matching lorka's distribution so the packed layout has the same
rhythm.

## Deltas from the current implementation

| Current                                  | Target                                 |
| ---------------------------------------- | -------------------------------------- |
| 6 auto-scrolling columns, CSS keyframes  | user-scrolled packed masonry           |
| `pointer-events-none`, purely decorative | interactive tiles with hover overlay   |
| `rounded-md` tiles, `gap-1`              | 0 radius, exactly 4px gap              |
| glow filter + `mix-blend-mode: screen`   | clean images, no filter                |
| fixed 6 columns at all widths            | 5 / 3 / 2 responsive                   |
| wall sits behind form panels             | wall IS the page; composer floats over |
| no CTA                                   | CTA end-cap after the wall             |
| no tab bar                               | floating Community / Quick / My Images |
