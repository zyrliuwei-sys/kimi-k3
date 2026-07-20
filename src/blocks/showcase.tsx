import { useState } from 'react';
import { Play, X } from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { m } from '@/paraglide/messages.js';

/**
 * Concept-demo showcase. The 3 images are AI-generated "motion result frames"
 * (public/showcase/case-{1,2,3}.png), clearly labeled "示例演示 / Concept demo"
 * — there is no real motion video behind the play button, so the lightbox
 * shows the still frame + a note that actual output may vary. Swap in real
 * customer videos when the generation pipeline ships.
 */
const CASES = [
  {
    img: '/showcase/case-1.png',
    titleKey: 'landing.showcase.case_1.title',
    descKey: 'landing.showcase.case_1.desc',
  },
  {
    img: '/showcase/case-2.png',
    titleKey: 'landing.showcase.case_2.title',
    descKey: 'landing.showcase.case_2.desc',
  },
  {
    img: '/showcase/case-3.png',
    titleKey: 'landing.showcase.case_3.title',
    descKey: 'landing.showcase.case_3.desc',
  },
];

export function Showcase() {
  const [open, setOpen] = useState<number | null>(null);
  const active = open !== null ? CASES[open] : null;

  return (
    <section id="showcase" className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {m['landing.showcase.title']()}
          </h2>
          <p className="text-muted-foreground mt-5">
            {m['landing.showcase.description']()}
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CASES.map((c, i) => (
            <button
              key={c.img}
              type="button"
              onClick={() => setOpen(i)}
              className="group text-left"
            >
              <div className="bg-card border-foreground/10 relative overflow-hidden rounded-2xl border">
                <img
                  src={c.img}
                  alt={tDynamic(c.titleKey)}
                  className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <span className="bg-background/80 text-foreground/70 absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-medium backdrop-blur">
                  {m['landing.showcase.demo_badge']()}
                </span>
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="brand-gradient grid size-14 place-items-center rounded-full shadow-lg transition-transform group-hover:scale-110">
                    <Play className="size-6 translate-x-0.5 text-white" />
                  </span>
                </span>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold">
                {tDynamic(c.titleKey)}
              </h3>
              <p className="text-foreground/60 mt-1 text-sm leading-relaxed">
                {tDynamic(c.descKey)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={active.img}
              alt={tDynamic(active.titleKey)}
              className="max-h-[70vh] w-full rounded-xl object-contain"
            />
            <div className="bg-card border-foreground/10 mt-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">
                  {tDynamic(active.titleKey)}
                </h3>
                <span className="text-foreground/55 bg-muted rounded-full px-2.5 py-1 text-[10px] font-medium">
                  {m['landing.showcase.demo_badge']()}
                </span>
              </div>
              <p className="text-foreground/65 mt-1.5 text-sm leading-relaxed">
                {tDynamic(active.descKey)}
              </p>
              <p className="text-foreground/40 mt-2 text-xs">
                {m['landing.showcase.lightbox_note']()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="bg-background/80 hover:bg-background absolute -top-3 -right-3 grid size-9 place-items-center rounded-full backdrop-blur"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
