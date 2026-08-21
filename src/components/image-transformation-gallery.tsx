import { useState } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { CanvasRevealEffect } from '@/components/canvas-reveal-effect';

interface Transformation {
  accent: string;
  colors: Array<[number, number, number]>;
  description: string;
  image: string;
  label: string;
  title: string;
}

const transformations: Transformation[] = [
  {
    label: 'Portrait study',
    title: 'Polished studio portrait',
    description: 'A soft editorial portrait with luminous detail.',
    image: '/imgs/generated/ai-portrait-studio.png',
    accent: 'text-sky-100',
    colors: [
      [125, 211, 252],
      [224, 242, 254],
    ],
  },
  {
    label: 'Golden hour pet',
    title: 'Storybook companion',
    description: 'Turn a familiar pet photo into a warm keepsake.',
    image: '/imgs/generated/ai-pet-storybook.png',
    accent: 'text-amber-100',
    colors: [
      [253, 230, 138],
      [254, 243, 199],
    ],
  },
  {
    label: 'Travel scene',
    title: 'Cinematic cityscape',
    description: 'Reframe a travel memory with film-like atmosphere.',
    image: '/imgs/generated/ai-city-cinematic.png',
    accent: 'text-violet-100',
    colors: [
      [196, 181, 253],
      [147, 197, 253],
    ],
  },
];

export function ImageTransformationGallery() {
  return (
    <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-3 sm:gap-5">
      {transformations.map((transformation, index) => (
        <TransformationCard
          key={transformation.title}
          transformation={transformation}
          raised={index === 1}
        />
      ))}
    </div>
  );
}

function TransformationCard({
  transformation,
  raised,
}: {
  transformation: Transformation;
  raised: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <figure
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={
        'group relative isolate min-h-[21rem] overflow-hidden rounded-[26px] border border-white/80 bg-slate-950 shadow-[0_1px_1px_rgba(0,0,0,0.04),0_18px_48px_rgba(31,41,55,0.18)] transition-transform duration-500 ease-out hover:-translate-y-1 sm:min-h-[24rem] ' +
        (raised ? 'sm:translate-y-5' : '')
      }
    >
      <img
        src={transformation.image}
        alt={transformation.title}
        width={1122}
        height={1402}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.045]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.04)_25%,rgba(2,6,23,0.78)_100%)]" />

      <AnimatePresence>
        {hovered ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="absolute inset-0 bg-slate-950/56 backdrop-blur-[1px]"
          >
            <CanvasRevealEffect
              animationSpeed={3.2}
              colors={transformation.colors}
              dotSize={1.65}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.05, ease: 'easeOut' }}
              >
                <Sparkles
                  className={'mx-auto size-6 ' + transformation.accent}
                />
                <p
                  className={
                    'mt-4 text-xs font-semibold tracking-[0.18em] uppercase ' +
                    transformation.accent
                  }
                >
                  AI transformation
                </p>
                <h3 className="mt-3 text-2xl leading-tight font-semibold tracking-[-0.045em] text-white">
                  {transformation.title}
                </h3>
                <p className="mx-auto mt-3 max-w-[24ch] text-sm leading-6 text-white/72">
                  {transformation.description}
                </p>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <figcaption className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 p-5 text-white">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.17em] text-white/65 uppercase">
            {transformation.label}
          </p>
          <p className="mt-1 text-[17px] font-medium tracking-[-0.03em]">
            {transformation.title}
          </p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-md transition-transform duration-300 group-hover:rotate-45">
          <ArrowUpRight className="size-4" />
        </span>
      </figcaption>
    </figure>
  );
}
