import { useRef, type ReactNode } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

import { cn } from '@/lib/utils';

export type TimelineItem = {
  /** A compact label shown on the rail, for example “01 / Compare”. */
  label: string;
  /** The section kicker. */
  eyebrow: string;
  /** The visible section heading. */
  title: string;
  /** The content associated with this point in the timeline. */
  content: ReactNode;
  /** An optional id connected to the heading for deep links and landmarks. */
  id?: string;
};

type TimelineProps = {
  items: TimelineItem[];
  className?: string;
  'aria-label'?: string;
};

/**
 * A restrained, scroll-reactive editorial timeline. It takes all copy as
 * props, which keeps it suitable for any block without coupling it to i18n.
 */
export function Timeline({
  items,
  className,
  'aria-label': ariaLabel,
}: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ['start end', 'end start'],
  });
  const lineProgress = useSpring(
    useTransform(scrollYProgress, [0.08, 0.92], [0, 1]),
    { stiffness: 100, damping: 28, mass: 0.32 }
  );

  if (items.length === 0) return null;

  return (
    <section
      ref={timelineRef}
      aria-label={ariaLabel}
      className={cn('relative', className)}
    >
      <div
        aria-hidden="true"
        className="absolute top-3 bottom-3 left-3 w-px bg-black/[0.1] md:left-[11rem] dark:bg-white/15"
      />
      <motion.div
        aria-hidden="true"
        style={{
          scaleY: reduceMotion ? 1 : lineProgress,
          transformOrigin: 'top',
        }}
        className="absolute top-3 bottom-3 left-3 w-px bg-[#0071e3] md:left-[11rem] dark:bg-sky-300"
      />

      <div className="relative space-y-18 sm:space-y-24">
        {items.map((item, index) => (
          <TimelineEntry
            key={item.id ?? item.title}
            item={item}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}

function TimelineEntry({ item, index }: { item: TimelineItem; index: number }) {
  return (
    <motion.section
      aria-labelledby={item.id}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{
        duration: 0.55,
        delay: index * 0.04,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-5 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-x-10"
    >
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute top-1.5 left-1.5 size-[7px] -translate-x-1/2 rounded-full border-2 border-white bg-[#0071e3] shadow-[0_0_0_4px_rgba(0,113,227,0.1)] md:top-3 md:right-[-4px] md:left-auto md:translate-x-0 dark:border-[#050505] dark:bg-sky-300 dark:shadow-[0_0_0_4px_rgba(125,211,252,0.12)]"
        />
        <div className="sticky top-28 hidden pr-9 text-right md:block">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-[#0071e3] uppercase dark:text-sky-300">
            {item.label}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#6e6e73] dark:text-white/50">
            {item.eyebrow}
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase md:hidden dark:text-sky-300">
          {item.label} · {item.eyebrow}
        </p>
        <h2
          id={item.id}
          className="text-[clamp(1.8rem,3.2vw,3rem)] leading-[1.02] font-semibold tracking-[-0.06em] text-[#1d1d1f] dark:text-white"
        >
          {item.title}
        </h2>
        <div className="mt-7 text-[16px] leading-8 text-[#6e6e73] dark:text-white/60">
          {item.content}
        </div>
      </div>
    </motion.section>
  );
}
