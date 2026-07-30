'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Aceternity-style `NoiseBackground` — a coloured gradient (multi-stop
 * conic) laced with an SVG turbulence noise overlay. Designed to wrap a
 * single child (usually a button) so the child reads as a "cut-out" on
 * top of the noisily-coloured slab.
 *
 * Used by the image playground's segmented Community / My Images tab
 * switcher — the gradient runs across the same hue family as the
 * community wall behind it, so the floating pill blends with the page
 * instead of competing with it.
 *
 * `gradientColors` is required (no default) — the component always
 * pays for a gradient, callers should pick colours intentionally.
 */
export function NoiseBackground({
  children,
  containerClassName,
  gradientColors,
  noiseOpacity = 0.5,
  noiseBlendMode = 'overlay',
  className,
}: {
  children: React.ReactNode;
  /** Outer wrapper classes — set shape, padding, size here. */
  containerClassName?: string;
  /** Two or more stops. The component builds a conic gradient through
   *  them. Three stops (the Aceternity demo default) read as a smooth
   *  rainbow; two stops reads as a 2-colour split. Empty array = no
   *  gradient layer (only the noise overlay renders). */
  gradientColors: string[];
  /** Strength of the SVG noise overlay. 0 disables it. */
  noiseOpacity?: number;
  /** CSS mix-blend-mode for the noise overlay. Aceternity demos use
   *  "overlay" on dark walls and "soft-light" on light ones. */
  noiseBlendMode?: React.CSSProperties['mixBlendMode'];
  /** Classes applied to the noise + gradient composition layer. */
  className?: string;
}) {
  // Stable id so multiple NoiseBackground instances on the same page
  // don't collide on the SVG filter id.
  const id = React.useId();
  const filterId = `noise-${id}`;
  const gradientId = `gradient-${id}`;

  const hasGradient = gradientColors.length >= 1;
  const stops = gradientColors.length >= 2 ? gradientColors : [
    gradientColors[0],
    gradientColors[0],
  ];

  // Conic gradient centred on the element. The colours are evenly spaced
  // around the circle so each stop shows the same arc length.
  const conic = `conic-gradient(${
    stops
      .map((c, i) => `${c} ${(i / stops.length) * 360}deg ${((i + 1) / stops.length) * 360}deg`)
      .join(', ')
  })`;

  return (
    <div
      className={cn('relative isolate', containerClassName)}
    >
      {/* Gradient layer — sits behind the child. Skipped when no colours
          are passed so the component can be used as a pure noise slab. */}
      {hasGradient ? (
        <div
          className={cn('absolute inset-0 -z-10 rounded-[inherit]', className)}
          style={{ background: conic }}
        />
      ) : null}
      {/* Noise layer — same SVG filter pattern Aceternity uses, scaled
          via SVG to tile across the element. feTurbulence + feColorMatrix
          turns the noise into a neutral grey overlay; the parent
          mix-blend-mode + opacity controls how strongly it shows. */}
      <svg
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[inherit]"
        style={{ mixBlendMode: noiseBlendMode, opacity: noiseOpacity }}
      >
        <filter id={filterId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${filterId})`} />
      </svg>
      {/* Hidden but kept for parity with the original Aceternity demo
          (kept so an SVG inspector can see the gradient stops). No
          effect on rendering. */}
      <svg className="hidden" aria-hidden>
        <defs>
          <linearGradient id={gradientId}>
            {stops.map((c, i) => (
              <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
      </svg>
      {/* The actual content sits above the gradient/noise layers. */}
      {children}
    </div>
  );
}
