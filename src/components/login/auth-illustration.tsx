import { Quote, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { MeshGradient } from '@/components/login/mesh-gradient';

/**
 * Right-column decorative panel for the sign-in page. Renders an Aceternity-
 * style layered illustration:
 *
 *   ┌───────────────────────────────────────┐
 *   │  [ badge ]   [ badge ]   [ badge ]    │  ← feature pills
 *   │                                       │
 *   │  HEADING                              │
 *   │  Subheading text spanning a couple   │
 *   │  of lines…                            │
 *   │                                       │
 *   │  ┌───────────────────────────────┐   │
 *   │  │  " testimonial quote … "       │   │  ← floating glass card
 *   │  │  — Author                       │   │
 *   │  │    Company                      │   │
 *   │  └───────────────────────────────┘   │
 *   │                                       │
 *   │  ░ mesh gradient background ░        │
 *   └───────────────────────────────────────┘
 *
 * Pure presentational; all copy is passed in as props (the caller pulls it
 * from `m['auth.signin.*']`).
 */

type AuthIllustrationProps = {
  heading: string;
  subheading: string;
  badges: string[];
  testimonial?: {
    quote: string;
    author: string;
    company: string;
  };
  className?: string;
};

export function AuthIllustration({
  heading,
  subheading,
  badges,
  testimonial,
  className,
}: AuthIllustrationProps) {
  return (
    <div
      className={cn(
        'relative hidden h-full w-full overflow-hidden md:flex',
        // Base panel uses the project surface tokens so it adapts to light/dark.
        'bg-muted text-foreground',
        className
      )}
    >
      {/* WebGL animated mesh — sits behind everything. */}
      <MeshGradient className="absolute inset-0" />

      {/* Soft vignette so the floating card reads against the bright blobs. */}
      <div
        aria-hidden="true"
        className="to-background/40 dark:to-background/60 absolute inset-0 bg-gradient-to-b from-transparent via-transparent"
      />

      <div className="relative z-10 flex h-full w-full flex-col justify-between gap-8 p-8 lg:p-12">
        {/* Top row: feature pills. */}
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              key={badge}
              className="bg-background/60 text-foreground/80 border-foreground/10 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur"
            >
              <Sparkles className="text-brand-gradient size-3" />
              {badge}
            </span>
          ))}
        </div>

        {/* Middle: heading + subheading. */}
        <div className="max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">
            {heading}
          </h2>
          <p className="text-foreground/70 mt-3 text-sm leading-relaxed lg:text-base">
            {subheading}
          </p>
        </div>

        {/* Bottom: floating testimonial card. */}
        {testimonial && (
          <div className="bg-background/70 border-foreground/10 max-w-sm rounded-2xl border p-5 shadow-[0_24px_60px_-32px_rgba(13,11,8,0.45)] backdrop-blur-xl">
            <Quote className="text-foreground/40 mb-2 size-4" />
            <p className="text-foreground/85 text-sm leading-relaxed">
              {testimonial.quote}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-foreground/70 font-medium">
                {testimonial.author}
              </span>
              <span className="text-foreground/40">·</span>
              <span className="text-foreground/60">{testimonial.company}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
