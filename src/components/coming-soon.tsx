import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

interface ComingSoonProps {
  eyebrow: string;
  title: string;
  description: string;
  /** label for the "Coming soon" pill */
  comingSoonLabel: string;
  /** label for the "Back to home" link */
  backHomeLabel: string;
  icon?: ComponentType<{ className?: string }>;
  children?: ReactNode;
  className?: string;
}

/**
 * Pure presentational shell for not-yet-built pages.
 * All content arrives via props — no i18n reads inside.
 */
export function ComingSoon({
  eyebrow,
  title,
  description,
  comingSoonLabel,
  backHomeLabel,
  icon: Icon,
  children,
  className,
}: ComingSoonProps) {
  return (
    <section
      className={cn('relative overflow-hidden px-4 py-28 sm:py-36', className)}
    >
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[640px] -translate-x-1/2 rounded-full opacity-[0.16] blur-3xl"
      />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
        {Icon ? (
          <span className="brand-gradient mb-7 grid size-14 place-items-center rounded-2xl shadow-[0_18px_40px_-18px_rgba(124,58,237,0.7)]">
            <Icon className="size-6 text-white" />
          </span>
        ) : null}

        <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
          {eyebrow}
          <span className="bg-foreground/20 size-1 rounded-full" />
          <span className="text-foreground/50">{comingSoonLabel}</span>
        </span>

        <h1 className="mt-6 text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] font-medium tracking-[-0.02em]">
          {title}
        </h1>

        <p className="text-foreground/65 mt-5 max-w-xl text-lg leading-relaxed">
          {description}
        </p>

        {children ? <div className="mt-8 w-full">{children}</div> : null}

        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'lg' }),
            'mt-8 h-11 gap-2 rounded-full px-6 text-[15px] font-medium'
          )}
        >
          <ArrowLeft className="size-4" />
          {backHomeLabel}
        </Link>
      </div>
    </section>
  );
}
