// Figures for the /kimi-k3-1 guide page. All copy arrives via props so the
// en/zh MDX files can share the same drawings.

// Deterministic PRNG so server and client render identical "lit" experts.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function pickIndices(count: number, total: number, seed: number) {
  const rand = seeded(seed);
  const picked = new Set<number>();
  // Runs at module load (Worker cold start) — must always terminate.
  const target = Math.min(count, total);
  while (picked.size < target) picked.add(Math.floor(rand() * total));
  return picked;
}

// Dot positions forming a crescent, trimmed to exactly `total` dots
// (one dot per routed expert). Tightens the grid until enough dots fit.
function crescentDots(total: number) {
  const cx = 300;
  const cy = 260;
  const r = 230;
  const cutX = cx + 110;
  const cutY = cy - 60;
  const cutR = r * 0.8;
  for (let spacing = 16; spacing >= 6; spacing -= 0.25) {
    const dots: { x: number; y: number }[] = [];
    let row = 0;
    for (let y = cy - r; y <= cy + r; y += spacing, row++) {
      for (let x = cx - r; x <= cx + r + spacing; x += spacing) {
        const px = x + (row % 2 ? spacing / 2 : 0);
        const inMoon = (px - cx) ** 2 + (y - cy) ** 2 <= r * r;
        const inCut = (px - cutX) ** 2 + (y - cutY) ** 2 <= cutR * cutR;
        if (inMoon && !inCut) dots.push({ x: px, y });
      }
    }
    if (dots.length >= total) {
      // Drop the extra dots closest to the inner edge so the outline stays clean.
      return dots
        .map((d) => ({ ...d, k: Math.hypot(d.x - cutX, d.y - cutY) }))
        .sort((a, b) => b.k - a.k)
        .slice(0, total);
    }
  }
  return [];
}

const COVER_DOTS = crescentDots(896);
const COVER_LIT = pickIndices(16, COVER_DOTS.length, 31415);

export function KimiK31Cover({
  eyebrow,
  title,
  subtitle,
  chips,
  caption,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  chips: string[];
  caption: string;
}) {
  return (
    <figure className="not-prose my-8">
      <div className="relative overflow-hidden rounded-2xl bg-[#0a0f24] text-white ring-1 ring-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_50%,rgba(56,189,248,0.18),transparent_60%)]" />
        <svg
          viewBox="0 0 600 520"
          className="absolute top-1/2 -right-24 h-[130%] -translate-y-1/2 opacity-60 sm:right-0 sm:h-[115%] sm:opacity-100"
          aria-hidden="true"
        >
          <ellipse
            cx="300"
            cy="260"
            rx="285"
            ry="70"
            fill="none"
            stroke="rgba(148,163,184,0.25)"
            strokeWidth="1"
            transform="rotate(-18 300 260)"
          />
          {COVER_DOTS.map((d, i) =>
            COVER_LIT.has(i) ? (
              <g key={i}>
                <circle cx={d.x} cy={d.y} r="7" fill="rgba(34,211,238,0.25)" />
                <circle cx={d.x} cy={d.y} r="3" fill="#67e8f9" />
              </g>
            ) : (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r="1.9"
                fill="rgba(165,180,252,0.45)"
              />
            )
          )}
        </svg>
        <div className="relative max-w-[62%] p-6 sm:max-w-[55%] sm:p-10">
          <div className="text-xs font-medium tracking-[0.2em] text-cyan-300/90 uppercase">
            {eyebrow}
          </div>
          <div className="mt-3 text-5xl font-semibold tracking-tight sm:text-7xl">
            {title}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
            {subtitle}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200 ring-1 ring-white/15"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="text-muted-foreground mt-2 text-center text-xs">
        {caption}
      </figcaption>
    </figure>
  );
}

const GRID_COLS = 32;
const GRID_ROWS = 28; // 32 × 28 = 896 routed experts
const GRID_LIT = pickIndices(16, GRID_COLS * GRID_ROWS, 2718);

export function KimiMoeDiagram({
  inputTitle,
  inputDetail,
  routerTitle,
  routerDetail,
  expertsTitle,
  expertsDetail,
  sharedTitle,
  sharedDetail,
  outputTitle,
  outputDetail,
  stats,
  caption,
}: {
  inputTitle: string;
  inputDetail: string;
  routerTitle: string;
  routerDetail: string;
  expertsTitle: string;
  expertsDetail: string;
  sharedTitle: string;
  sharedDetail: string;
  outputTitle: string;
  outputDetail: string;
  stats: { value: string; label: string }[];
  caption: string;
}) {
  const node = 'border-border bg-background rounded-xl border p-3 text-center';
  const arrow =
    'text-muted-foreground flex items-center justify-center text-lg md:px-1';
  return (
    <figure className="not-prose my-8">
      <div className="border-border bg-muted/30 rounded-2xl border p-4 sm:p-6">
        <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          <div className={`${node} md:w-32`}>
            <div className="text-foreground text-sm font-semibold">
              {inputTitle}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              {inputDetail}
            </div>
          </div>
          <div className={arrow}>
            <span className="md:hidden">↓</span>
            <span className="hidden md:inline">→</span>
          </div>
          <div className={`${node} md:w-28`}>
            <div className="text-foreground text-sm font-semibold">
              {routerTitle}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              {routerDetail}
            </div>
          </div>
          <div className={arrow}>
            <span className="md:hidden">↓</span>
            <span className="hidden md:inline">→</span>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className={node}>
              <svg
                viewBox={`0 0 ${GRID_COLS * 8} ${GRID_ROWS * 8}`}
                className="mx-auto w-full max-w-[280px]"
                role="img"
                aria-label={expertsDetail}
              >
                {Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => (
                  <rect
                    key={i}
                    x={(i % GRID_COLS) * 8}
                    y={Math.floor(i / GRID_COLS) * 8}
                    width="6"
                    height="6"
                    rx="1.5"
                    className={
                      GRID_LIT.has(i)
                        ? 'fill-primary'
                        : 'fill-muted-foreground/20'
                    }
                  />
                ))}
              </svg>
              <div className="text-foreground mt-2 text-sm font-semibold">
                {expertsTitle}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {expertsDetail}
              </div>
            </div>
            <div className={`${node} flex items-center justify-center gap-3`}>
              <span className="flex gap-1.5">
                <span className="bg-primary size-3 rounded-sm" />
                <span className="bg-primary size-3 rounded-sm" />
              </span>
              <span className="text-foreground text-sm font-semibold">
                {sharedTitle}
              </span>
              <span className="text-muted-foreground text-xs">
                {sharedDetail}
              </span>
            </div>
          </div>
          <div className={arrow}>
            <span className="md:hidden">↓</span>
            <span className="hidden md:inline">→</span>
          </div>
          <div className={`${node} md:w-28`}>
            <div className="text-foreground text-sm font-semibold">
              {outputTitle}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              {outputDetail}
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-foreground text-xl font-semibold tabular-nums">
                {s.value}
              </div>
              <div className="text-muted-foreground text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-muted-foreground mt-2 text-center text-xs">
        {caption}
      </figcaption>
    </figure>
  );
}

export function KimiBenchmarkChart({
  title,
  items,
  caption,
}: {
  title: string;
  items: { label: string; value: number; source: string }[];
  caption: string;
}) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  return (
    <figure className="not-prose my-8">
      <div className="border-border bg-muted/30 rounded-2xl border p-4 sm:p-6">
        <div className="text-foreground mb-4 text-sm font-semibold">
          {title}
        </div>
        <div className="space-y-2">
          {sorted.map((item) => (
            <div
              key={item.label}
              title={`${item.label}: ${item.value}% · ${item.source}`}
              className="group hover:bg-background grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3 rounded-md px-1 py-1 sm:grid-cols-[10rem_1fr_3.5rem]"
            >
              <div className="text-muted-foreground group-hover:text-foreground truncate text-xs sm:text-sm">
                {item.label}
              </div>
              <div className="relative h-2.5">
                <div className="border-border absolute inset-y-[-4px] left-1/4 border-l border-dashed" />
                <div className="border-border absolute inset-y-[-4px] left-1/2 border-l border-dashed" />
                <div className="border-border absolute inset-y-[-4px] left-3/4 border-l border-dashed" />
                <div
                  className="bg-primary relative h-full rounded-r-[4px] opacity-85 group-hover:opacity-100"
                  style={{ width: `${item.value}%` }}
                />
              </div>
              <div className="text-foreground text-right text-xs font-medium tabular-nums sm:text-sm">
                {item.value}%
              </div>
            </div>
          ))}
        </div>
        <div className="text-muted-foreground mt-2 grid grid-cols-[7.5rem_1fr_3rem] gap-3 px-1 text-[10px] sm:grid-cols-[10rem_1fr_3.5rem]">
          <span />
          <span className="flex justify-between tabular-nums">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </span>
          <span />
        </div>
      </div>
      <figcaption className="text-muted-foreground mt-2 text-center text-xs">
        {caption}
      </figcaption>
    </figure>
  );
}
