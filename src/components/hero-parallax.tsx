import { useRef } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

import { cn } from '@/lib/utils';

export interface HeroParallaxProduct {
  src: string;
  alt: string;
}

/**
 * A three-row, scroll-reactive image field. It deliberately accepts only
 * content via props so it can serve as a decorative surface in any page.
 */
export function HeroParallax({
  products,
  className,
  decorative = false,
}: {
  products: HeroParallaxProduct[];
  className?: string;
  decorative?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const spring = { stiffness: 90, damping: 24, mass: 0.45 };
  const left = useSpring(
    useTransform(scrollYProgress, [0, 1], ['-11%', '7%']),
    spring
  );
  const right = useSpring(
    useTransform(scrollYProgress, [0, 1], ['7%', '-11%']),
    spring
  );
  const rotateX = useSpring(
    useTransform(scrollYProgress, [0, 0.55, 1], [8, 0, -5]),
    spring
  );
  const rotateZ = useSpring(
    useTransform(scrollYProgress, [0, 0.55, 1], [-2.2, 0, 1.2]),
    spring
  );
  const scale = useSpring(
    useTransform(scrollYProgress, [0, 0.55, 1], [1.08, 1, 1.04]),
    spring
  );
  const prefersReducedMotion = useReducedMotion();

  const rows = Array.from({ length: 3 }, (_, rowIndex) =>
    products.filter((_, index) => index % 3 === rowIndex)
  );

  return (
    <div
      ref={ref}
      aria-hidden={decorative || undefined}
      className={cn(
        'relative h-full w-full overflow-hidden bg-[#e9e9eb] [perspective:1100px] dark:bg-[#111113]',
        className
      )}
    >
      <motion.div
        style={{ rotateX, rotateZ, scale }}
        className="absolute -inset-x-[10%] -inset-y-[7%] flex flex-col gap-2 p-2 [transform-style:preserve-3d]"
      >
        {rows.map((row, rowIndex) => {
          const loop = [...row, ...row];

          return (
            <div key={rowIndex} className="min-h-0 flex-1 overflow-hidden">
              <motion.div
                style={{ x: rowIndex === 1 ? right : left }}
                className="flex h-full w-max"
              >
                <motion.div
                  animate={
                    prefersReducedMotion
                      ? undefined
                      : {
                          x:
                            rowIndex % 2 === 0
                              ? ['0%', '-50%']
                              : ['-50%', '0%'],
                        }
                  }
                  transition={{
                    duration: 42 + rowIndex * 6,
                    ease: 'linear',
                    repeat: Infinity,
                  }}
                  className="flex h-full w-max gap-2"
                >
                  {loop.map((product, index) => (
                    <figure
                      key={`${product.src}-${index}`}
                      className="bg-muted h-full w-[clamp(10rem,17vw,21rem)] shrink-0 overflow-hidden border border-white/75 shadow-[0_12px_28px_rgba(15,23,42,0.16)] dark:border-white/10"
                    >
                      <img
                        src={product.src}
                        alt={decorative ? '' : product.alt}
                        loading={index < 5 ? 'eager' : 'lazy'}
                        decoding="async"
                        onError={(event) => {
                          event.currentTarget.parentElement?.style.setProperty(
                            'display',
                            'none'
                          );
                        }}
                        className="size-full object-cover"
                      />
                    </figure>
                  ))}
                </motion.div>
              </motion.div>
            </div>
          );
        })}
      </motion.div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(233,233,235,0.58),transparent_9%,transparent_91%,rgba(233,233,235,0.58))] dark:bg-[linear-gradient(90deg,rgba(17,17,19,0.6),transparent_9%,transparent_91%,rgba(17,17,19,0.6))]" />
    </div>
  );
}
