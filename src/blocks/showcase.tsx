import { motion } from 'motion/react';

import { tDynamic } from '@/core/i18n/dynamic';
import { m } from '@/paraglide/messages.js';

const CASES = [
  {
    img: '/imgs/generated/showcase-report-summary-1787567151951.png',
    titleKey: 'landing.showcase.case_1.title',
    descKey: 'landing.showcase.case_1.desc',
    layout: 'md:row-span-2',
    mediaLayout: 'bottom',
  },
  {
    img: '/imgs/generated/showcase-idea-code-1787567412935.png',
    titleKey: 'landing.showcase.case_2.title',
    descKey: 'landing.showcase.case_2.desc',
    layout: 'xl:col-span-2',
    mediaLayout: 'side',
  },
  {
    img: '/imgs/generated/showcase-notes-plan-1787568951365.png',
    titleKey: 'landing.showcase.case_3.title',
    descKey: 'landing.showcase.case_3.desc',
    layout: 'xl:col-span-2',
    mediaLayout: 'side',
  },
];

/** A compact bento gallery for the product outcomes shown below the Hero. */
export function Showcase() {
  return (
    <section id="showcase" className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {m['landing.showcase.title']()}
          </h2>
          <p className="text-muted-foreground mt-5 text-left leading-relaxed">
            {m['landing.showcase.description']()}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-[17rem_17rem] xl:grid-cols-3 xl:grid-rows-[17rem_17rem]">
          {CASES.map((item, index) => (
            <ShowcaseCard key={item.img} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseCard({
  item,
  index,
}: {
  item: (typeof CASES)[number];
  index: number;
}) {
  const title = tDynamic(item.titleKey);

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.22 }}
      transition={{ duration: 0.45, delay: index * 0.06 }}
      className={`group border-border/75 bg-card/80 relative isolate min-h-[23rem] overflow-hidden rounded-[1.75rem] border shadow-[0_1px_1px_rgb(0_0_0_/_0.03),0_14px_35px_rgb(20_18_30_/_0.05)] transition-shadow duration-500 hover:shadow-[0_2px_3px_rgb(0_0_0_/_0.04),0_24px_55px_rgb(20_18_30_/_0.11)] md:min-h-0 ${item.layout}`}
    >
      <div
        className={`relative z-20 max-w-sm p-6 sm:p-7 ${
          item.mediaLayout === 'side' ? 'md:max-w-[47%]' : ''
        }`}
      >
        <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-[0.2em] uppercase">
          Case {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.025em]">
          {title}
        </h3>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {tDynamic(item.descKey)}
        </p>
      </div>

      <div
        className={`absolute inset-x-5 top-[10.25rem] bottom-0 flex items-center justify-center overflow-hidden rounded-t-xl border border-b-0 border-black/[0.06] bg-[#f0f1f4] shadow-[0_-8px_28px_rgb(29_29_31_/_0.07)] md:inset-x-6 md:top-[10.5rem] dark:border-white/10 dark:bg-white/[0.04] ${
          item.mediaLayout === 'side'
            ? 'md:inset-y-6 md:right-6 md:bottom-6 md:left-[48%] md:rounded-xl md:border'
            : ''
        }`}
      >
        <img
          src={item.img}
          alt={title}
          width={960}
          height={600}
          loading="lazy"
          className="h-full w-full object-contain"
        />
      </div>

      <span
        aria-hidden
        className="bg-primary/70 absolute -right-16 -bottom-20 size-40 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-20"
      />
    </motion.article>
  );
}
