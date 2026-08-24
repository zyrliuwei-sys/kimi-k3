import type { CSSProperties, ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

export type ImageStreamHeroImage = {
  src: string;
  alt: string;
};

type ImageStreamHeroProps = {
  images: ImageStreamHeroImage[];
  children?: ReactNode;
  className?: string;
  /** Load the first stream image immediately when this hero is above the fold. */
  eagerFirstImage?: boolean;
};

const STREAM_LANES = [
  {
    className: 'left-[-15%] w-[43%] sm:left-[-5%] sm:w-[30%]',
    transform:
      'perspective(1100px) rotateY(27deg) rotateZ(-3deg) translateZ(-90px)',
    duration: 40,
    direction: -1,
  },
  {
    className: 'left-1/2 w-[43%] -translate-x-1/2 sm:w-[29%]',
    transform: 'perspective(1100px) translateZ(38px)',
    duration: 48,
    direction: 1,
  },
  {
    className: 'right-[-15%] w-[43%] sm:right-[-5%] sm:w-[30%]',
    transform:
      'perspective(1100px) rotateY(-27deg) rotateZ(3deg) translateZ(-90px)',
    duration: 43,
    direction: -1,
  },
] as const;

const streamMask: CSSProperties = {
  maskImage:
    'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
  WebkitMaskImage:
    'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
};

/**
 * A compact, animated image corridor intended for editorial image-gallery
 * headers. The stream stays decorative; all actionable content is supplied
 * through children above it.
 */
export function ImageStreamHero({
  images,
  children,
  className,
  eagerFirstImage = false,
}: ImageStreamHeroProps) {
  const prefersReducedMotion = useReducedMotion();

  if (images.length === 0) return null;

  const lanes = STREAM_LANES.map((_, laneIndex) =>
    images.filter(
      (_, imageIndex) => imageIndex % STREAM_LANES.length === laneIndex
    )
  );

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden bg-[#080c14] shadow-[0_28px_72px_rgba(6,11,23,0.18)]',
        className
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(62,91,141,0.42),transparent_34%),linear-gradient(135deg,#0b1522_0%,#05070b_48%,#101d2b_100%)]" />

        <div
          className="absolute inset-x-0 top-1/2 h-[150%] -translate-y-1/2"
          style={streamMask}
        >
          {lanes.map((laneImages, laneIndex) => {
            const lane = STREAM_LANES[laneIndex];
            const repeatedImages = [...laneImages, ...laneImages];

            return (
              <div
                key={laneIndex}
                className={cn('absolute top-0', lane.className)}
                style={{ transform: lane.transform }}
              >
                <motion.div
                  animate={
                    prefersReducedMotion
                      ? undefined
                      : {
                          y:
                            lane.direction === 1
                              ? ['-50%', '0%']
                              : ['0%', '-50%'],
                        }
                  }
                  transition={{
                    duration: lane.duration,
                    ease: 'linear',
                    repeat: Infinity,
                  }}
                  style={{ willChange: 'transform' }}
                >
                  <div className="space-y-3 px-2 py-3 sm:space-y-4 sm:px-3 sm:py-4">
                    {repeatedImages.map((image, imageIndex) => (
                      <figure
                        key={`${image.src}-${imageIndex}`}
                        className="overflow-hidden rounded-[1.1rem] border border-white/10 bg-white/[0.07] p-1 shadow-[0_16px_42px_rgba(0,0,0,0.34)] sm:rounded-[1.35rem]"
                      >
                        <div className="aspect-[4/5] overflow-hidden rounded-[0.85rem] bg-[#111827] sm:rounded-[1.05rem]">
                          <img
                            src={image.src}
                            alt=""
                            aria-hidden="true"
                            loading={
                              eagerFirstImage &&
                              laneIndex === 1 &&
                              imageIndex === 0
                                ? 'eager'
                                : 'lazy'
                            }
                            decoding="async"
                            className="size-full object-cover"
                          />
                        </div>
                      </figure>
                    ))}
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(4,7,12,0.1)_30%,rgba(3,5,9,0.8)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#05070b]/85 via-[#05070b]/22 to-transparent" />
      </div>

      {children && <div className="relative z-10 h-full">{children}</div>}
    </section>
  );
}
