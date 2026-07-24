import { tDynamic } from '@/core/i18n/dynamic';
import { m } from '@/paraglide/messages.js';

/**
 * Concept-demo showcase. The 3 images are decorative illustrations matching
 * each case's text — no video, no overlay controls, no click affordance.
 * Swap in real product illustrations when the generation pipeline ships.
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
  return (
    <section id="showcase" className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {m['landing.showcase.title']()}
          </h2>
          <p className="text-muted-foreground mt-5 text-left">
            {m['landing.showcase.description']()}
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CASES.map((c) => (
            <div key={c.img} className="text-left">
              <div className="bg-card border-foreground/10 overflow-hidden rounded-2xl border">
                <img
                  src={c.img}
                  alt={tDynamic(c.titleKey)}
                  width={640}
                  height={400}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover"
                />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold">
                {tDynamic(c.titleKey)}
              </h3>
              <p className="text-foreground/60 mt-1 text-left text-sm leading-relaxed">
                {tDynamic(c.descKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
