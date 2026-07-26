import type { Grade } from '@/modules/website-audit';
import { cn } from '@/lib/utils';

/**
 * A/B/C/D/F grade badge.
 *
 * Color tokens follow the audit rubric:
 *   A (90+) → green
 *   B (80+) → blue
 *   C (70+) → amber
 *   D (60+) → orange
 *   F (<60) → red
 */
const GRADE_STYLES: Record<Grade, string> = {
  A: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  B: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  C: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  D: 'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',
  F: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
};

export function GradeBadge({
  grade,
  className,
  size = 'md',
}: {
  grade: Grade;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'sm'
      ? 'size-6 text-[11px]'
      : size === 'lg'
        ? 'size-12 text-2xl'
        : 'size-9 text-base';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold tabular-nums ring-1',
        sizeClass,
        GRADE_STYLES[grade],
        className
      )}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}
