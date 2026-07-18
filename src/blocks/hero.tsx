import { ArrowRight, BarChart3, Download, Sparkles, Wand2 } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-20 sm:pt-36 sm:pb-28">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        {/* Left */}
        <div className="max-w-2xl">
          <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-[#7c3aed]" />
            {m['landing.hero.eyebrow']()}
          </span>

          <h1 className="mt-6 text-[clamp(2.5rem,6vw,4.75rem)] leading-[1.02] font-medium tracking-[-0.02em]">
            {m['landing.hero.headline_prefix']()}{' '}
            <span className="text-brand-gradient">
              {m['landing.hero.headline_gradient']()}
            </span>
          </h1>

          <p className="text-foreground/65 mt-6 max-w-xl text-lg leading-relaxed sm:text-xl">
            {m['landing.hero.subheadline']()}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href="/api-playground"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'brand-gradient h-12 gap-2 rounded-full px-6 text-[15px] font-medium text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] hover:opacity-95'
              )}
            >
              {m['landing.hero.cta_api']()}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/compare"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'border-foreground/15 bg-card/60 h-12 gap-2 rounded-full px-6 text-[15px] font-medium backdrop-blur'
              )}
            >
              <BarChart3 className="size-4" />
              {m['landing.hero.cta_compare']()}
            </Link>
            <Link
              href="/cheat-sheet"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'h-12 gap-2 rounded-full px-6 text-[15px] font-medium'
              )}
            >
              <Download className="size-4" />
              {m['landing.hero.cta_cheat']()}
            </Link>
          </div>

          <p className="text-foreground/50 mt-6 text-sm">
            {m['landing.hero.proof']()}
          </p>
        </div>

        {/* Right — official interface screenshot */}
        <HeroShot />
      </div>
    </section>
  );
}

function HeroShot() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="brand-gradient absolute -inset-6 rounded-[2.5rem] opacity-[0.16] blur-3xl"
      />
      <div className="border-foreground/10 bg-card relative rounded-[1.75rem] border p-3 shadow-[0_40px_90px_-40px_rgba(13,11,8,0.45)] sm:p-4">
        {/* window bar */}
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="text-foreground/40 ml-2 text-[11px] font-medium">
            kimi.com
          </span>
          <span className="bg-foreground/5 text-foreground/45 ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            live
          </span>
        </div>

        {/* screenshot — drop the real capture at /public/hero-kimik3.png */}
        <div className="bg-muted/40 aspect-[16/11] w-full overflow-hidden rounded-[1.25rem]">
          <img
            src="/hero-kimik3.png"
            alt={m['landing.hero.shot_alt']()}
            className="h-full w-full object-cover object-top"
            loading="eager"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        </div>
      </div>

      {/* annotation — "this is the official UI, we simplify it for you" */}
      <div className="absolute -bottom-6 left-3 sm:-left-6">
        <div className="border-foreground/10 bg-card flex items-center gap-3 rounded-2xl border p-3 pr-4 shadow-[0_24px_60px_-22px_rgba(13,11,8,0.55)]">
          <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-xl">
            <Wand2 className="size-4 text-white" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">
              {m['landing.hero.shot_badge_title']()}
            </div>
            <div className="text-foreground/60 text-[11px]">
              {m['landing.hero.shot_badge_text']()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
