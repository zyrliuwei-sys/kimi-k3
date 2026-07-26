import type { Grade } from '@/modules/website-audit';
import { cn } from '@/lib/utils';

const GRADE_COLORS: Record<Grade, string> = {
  A: 'stroke-emerald-500',
  B: 'stroke-sky-500',
  C: 'stroke-amber-500',
  D: 'stroke-orange-500',
  F: 'stroke-rose-500',
};

/**
 * Circular score ring (0-100). Two stacked circles:
 *   - background track (full sweep at low opacity)
 *   - foreground arc whose dashoffset encodes the score
 *
 * Score rendering lives here so the report's 7 dimensions + overall can share
 * the same visual treatment.
 */
export function ScoreRing({
  score,
  grade,
  size = 96,
  strokeWidth = 8,
  label,
  sublabel,
  className,
}: {
  score: number;
  grade?: Grade;
  size?: number;
  strokeWidth?: number;
  label?: React.ReactNode;
  sublabel?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={cn('inline-flex flex-col items-center', className)}
      style={{ width: size }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn(
              'transition-[stroke-dashoffset] duration-700 ease-out',
              grade ? GRADE_COLORS[grade] : 'stroke-primary'
            )}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{clamped}</span>
          {sublabel ? (
            <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
              {sublabel}
            </span>
          ) : null}
        </div>
      </div>
      {label ? (
        <span className="text-muted-foreground mt-2 text-center text-xs">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Pick a grade letter from a numeric score. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
