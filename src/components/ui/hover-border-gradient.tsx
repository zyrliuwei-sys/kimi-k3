'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

/**
 * Aceternity-style `HoverBorderGradient` — a button that paints a moving
 * gradient highlight around its border on hover.
 *
 * The original Aceternity UI implementation rotated a single radial
 * gradient around the perimeter using `setInterval`, then snapped to a
 * solid brand highlight on hover. We keep that animation but switch the
 * highlight to the project's `brand-gradient` (purple → blue) so the
 * component reads as part of the kimik3 design system. The inner surface
 * uses `bg-sidebar` so the button sits naturally inside the sidebar.
 *
 * Used by the playground sidebar nav (Chat / Image) where the lorka-style
 * pop wants a more decorative swallow than the default SidebarMenuButton.
 */
type Direction = 'TOP' | 'LEFT' | 'BOTTOM' | 'RIGHT';

const MOVING_BG: Record<Direction, string> = {
  TOP: 'radial-gradient(20% 50% at 50% 0%, hsl(0 0% 100%) 0%, rgba(255,255,255,0) 100%)',
  LEFT: 'radial-gradient(16% 50% at 0% 50%, hsl(0 0% 100%) 0%, rgba(255,255,255,0) 100%)',
  BOTTOM: 'radial-gradient(20% 50% at 50% 100%, hsl(0 0% 100%) 0%, rgba(255,255,255,0) 100%)',
  RIGHT: 'radial-gradient(16% 50% at 100% 50%, hsl(0 0% 100%) 0%, rgba(255,255,255,0) 100%)',
};

// Brand purple → blue gradient (matches the playground "New chat" /
// generating-progress bar). Renders as a linear gradient through the
// button center; the rotating radial sits behind it for the moving
// wash effect.
const HIGHLIGHT =
  'linear-gradient(90deg, rgb(168,85,247) 0%, rgb(99,102,241) 50%, rgb(59,130,246) 100%)';

const DIRECTIONS: Direction[] = ['TOP', 'LEFT', 'BOTTOM', 'RIGHT'];

export type HoverBorderGradientProps = {
  children: React.ReactNode;
  /** Classes for the outer (rotating gradient wrapper) container. */
  containerClassName?: string;
  /** Classes for the inner content surface. */
  className?: string;
  /** Render element. Defaults to `button`. */
  as?: keyof React.JSX.IntrinsicElements;
  /** Seconds per radial step. Default 1.5s. */
  duration?: number;
  /** Disables the rotating idle animation but keeps the hover highlight. */
  disableIdleAnimation?: boolean;
} & React.HTMLAttributes<HTMLElement>;

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = 'button',
  duration = 1.5,
  disableIdleAnimation = false,
  ...props
}: HoverBorderGradientProps) {
  const [hovered, setHovered] = React.useState(false);
  const [direction, setDirection] = React.useState<Direction>('TOP');

  const rotateDirection = (current: Direction): Direction => {
    const idx = DIRECTIONS.indexOf(current);
    return DIRECTIONS[(idx + 1) % DIRECTIONS.length];
  };

  React.useEffect(() => {
    if (hovered || disableIdleAnimation) return;
    const id = setInterval(() => {
      setDirection((prev) => rotateDirection(prev));
    }, duration * 1000);
    return () => clearInterval(id);
  }, [hovered, duration, disableIdleAnimation]);

  return (
    <Tag
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative isolate flex h-full w-full items-center justify-center overflow-hidden rounded-full p-[1.5px] transition-opacity duration-200',
        containerClassName
      )}
      {...props}
    >
      {/* Rotating radial sits behind the solid brand-gradient border.
          On hover, the radial fades in and the brand fills the whole
          border — the original Aceternity "moving line" effect. */}
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-full"
        style={{ opacity: hovered ? 1 : 0, transition: `opacity ${duration * 0.4}s` }}
      >
        <motion.div
          className="absolute inset-0 rounded-full"
          initial={{ background: MOVING_BG[direction] }}
          animate={{ background: MOVING_BG[direction] }}
          transition={{ ease: 'linear', duration }}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 z-0 rounded-full"
        style={{
          background: HIGHLIGHT,
          opacity: hovered ? 1 : 0.55,
          transition: `opacity ${duration * 0.4}s`,
        }}
      />
      <div
        className={cn(
          'relative z-10 flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm transition-colors',
          className
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
