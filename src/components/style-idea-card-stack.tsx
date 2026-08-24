'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

export type StyleIdeaCard = {
  title: string;
  prompt: string;
};

/**
 * A quiet, editorial card stack for prompt examples. Only the leading idea
 * carries full detail; the two cards behind it keep the next directions in
 * view without turning a long list into visual noise.
 */
export function StyleIdeaCardStack({
  ideas,
  className,
}: {
  ideas: readonly StyleIdeaCard[];
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = ideas.length;

  useEffect(() => {
    if (paused || total < 2) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % total);
    }, 5800);

    return () => window.clearInterval(timer);
  }, [paused, total]);

  if (!total) return null;

  const setRelativeCard = (offset: number) => {
    setActiveIndex((current) => (current + offset + total) % total);
  };

  return (
    <div
      className={cn('mx-auto w-full max-w-3xl', className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative h-[26rem] sm:h-[24rem]">
        {[2, 1, 0].map((stackIndex) => {
          const idea = ideas[(activeIndex + stackIndex) % total];
          const isLeading = stackIndex === 0;

          return (
            <motion.article
              key={idea.title}
              aria-hidden={!isLeading}
              initial={{ opacity: 0, y: 32, scale: 0.94 }}
              animate={{
                opacity: 1 - stackIndex * 0.22,
                scale: 1 - stackIndex * 0.035,
                y: stackIndex * 17,
              }}
              transition={{
                type: 'spring',
                stiffness: 260,
                damping: 26,
                mass: 0.75,
              }}
              className={cn(
                'absolute inset-x-0 top-0 overflow-hidden rounded-[1.75rem] border p-6 sm:rounded-[2rem] sm:p-8',
                isLeading
                  ? 'border-black/[0.09] bg-white shadow-[0_16px_42px_rgb(0_0_0_/_0.08)] dark:border-white/10 dark:bg-[#151515]'
                  : 'border-black/[0.06] bg-[#f5f5f7] shadow-[0_8px_20px_rgb(0_0_0_/_0.035)] dark:border-white/[0.07] dark:bg-white/[0.06]'
              )}
              style={{ zIndex: 3 - stackIndex }}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-semibold tracking-[0.18em] text-[#0071e3] uppercase dark:text-sky-300">
                  Style{' '}
                  {String(((activeIndex + stackIndex) % total) + 1).padStart(
                    2,
                    '0'
                  )}
                </span>
                {isLeading ? (
                  <span className="text-[11px] font-medium text-[#86868b] dark:text-white/45">
                    {activeIndex + 1} / {total}
                  </span>
                ) : null}
              </div>

              <h3 className="mt-5 text-[clamp(1.55rem,3vw,2.15rem)] leading-[1.05] font-semibold tracking-[-0.05em] text-[#1d1d1f] dark:text-white">
                {idea.title}
              </h3>
              <p className="mt-6 rounded-2xl bg-[#f5f5f7] p-4 text-[15px] leading-7 text-[#515154] sm:p-5 sm:text-base dark:bg-black/25 dark:text-white/65">
                {idea.prompt}
              </p>
            </motion.article>
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-between gap-5 px-1">
        <div
          className="flex items-center gap-2"
          aria-label="Choose a style idea"
        >
          {ideas.map((idea, index) => (
            <button
              key={idea.title}
              type="button"
              aria-label={`Show ${idea.title}`}
              aria-current={activeIndex === index ? 'true' : undefined}
              onClick={() => setActiveIndex(index)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-4 focus-visible:outline-none',
                activeIndex === index
                  ? 'w-7 bg-[#1d1d1f] dark:bg-white'
                  : 'w-1.5 bg-black/20 hover:bg-black/35 dark:bg-white/25 dark:hover:bg-white/45'
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous style idea"
            onClick={() => setRelativeCard(-1)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-black/[0.08] text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-4 focus-visible:outline-none dark:border-white/10 dark:text-white dark:hover:bg-white/10"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next style idea"
            onClick={() => setRelativeCard(1)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-black/[0.08] text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-4 focus-visible:outline-none dark:border-white/10 dark:text-white dark:hover:bg-white/10"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
