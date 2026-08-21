import { useState } from 'react';
import { Expand } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/utils';

export type CommunityLayoutGridCard = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
};

/**
 * A top-to-bottom image board for the Community surface. Each frame stays in
 * a clear editorial sequence; hovering or focusing a card reveals its short
 * creative note without taking the visitor away from the generator.
 */
export function CommunityLayoutGrid({
  cards,
  className,
}: {
  cards: CommunityLayoutGridCard[];
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div
      aria-label="Community image collection"
      className={cn(
        'relative h-full w-full overflow-hidden bg-[#e9e9eb] p-1.5 sm:p-2 dark:bg-[#101114]',
        className
      )}
    >
      <div className="grid h-full grid-flow-row grid-cols-1 grid-rows-4 gap-1.5 sm:grid-cols-2 sm:grid-rows-3 sm:gap-2">
        {cards.map((card, index) => (
          <CommunityGridCard
            key={card.id}
            card={card}
            index={index}
            active={activeId === card.id}
            onActivate={() => setActiveId(card.id)}
            onDeactivate={() => setActiveId(null)}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 border border-white/55 dark:border-white/5" />
    </div>
  );
}

function CommunityGridCard({
  card,
  index,
  active,
  onActivate,
  onDeactivate,
}: {
  card: CommunityLayoutGridCard;
  index: number;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  return (
    <motion.button
      type="button"
      layout
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
      className={cn(
        'group relative isolate min-h-0 overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black',
        index === 0 || index === 3 ? 'sm:col-span-2' : 'sm:col-span-1'
      )}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
    >
      <img
        src={card.thumbnail}
        alt={card.title}
        loading={index < 2 ? 'eager' : 'lazy'}
        decoding="async"
        onError={(event) => {
          event.currentTarget.parentElement?.style.setProperty(
            'display',
            'none'
          );
        }}
        className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.045]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_22%,rgba(0,0,0,0.74)_100%)]" />
      <span className="pointer-events-none absolute top-3 left-3 rounded-full border border-white/25 bg-black/25 px-2 py-1 text-[9px] font-semibold tracking-[0.14em] text-white/90 uppercase backdrop-blur-sm">
        {String(index + 1).padStart(2, '0')}
      </span>

      <AnimatePresence initial={false}>
        {active ? (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-x-0 bottom-0 p-4 sm:p-5"
          >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.16em] text-white/65 uppercase">
                  Community study
                </p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.045em] text-white sm:text-xl">
                  {card.title}
                </h3>
                <p className="mt-1.5 max-w-lg text-xs leading-5 text-white/75 sm:text-sm">
                  {card.description}
                </p>
              </div>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur-sm">
                <Expand className="size-3.5" />
              </span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}
