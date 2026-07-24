import { ArrowUpRight, PlayCircle, Sparkles } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-20 sm:pt-32 sm:pb-24">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left — pitch */}
        <div className="text-center lg:text-left">
          {/* unofficial disclaimer badge (prominent) */}
          <span className="border-foreground/10 bg-card/80 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-[#7c3aed]" />
            {m['landing.hero.eyebrow']()}
          </span>

          <h1 className="mt-6 font-serif text-[clamp(2.4rem,5.6vw,4rem)] leading-[1.02] font-medium tracking-[-0.02em]">
            {m['landing.hero.headline_prefix']()}{' '}
            <span className="text-brand-gradient">
              {m['landing.hero.headline_gradient']()}
            </span>{' '}
            <span className="text-foreground/55 font-normal">
              — {m['landing.hero.headline_suffix']()}
            </span>
          </h1>

          <p className="text-foreground/65 mx-auto mt-6 max-w-2xl text-left text-base leading-relaxed sm:text-lg lg:mx-0">
            {m['landing.hero.subheadline']()}
          </p>

          {/* core action area — 2 CTAs side by side */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Link
              href="/api-playground"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-11 gap-2 px-6 text-[0.95rem]'
              )}
            >
              {m['landing.hero.cta_api']()}
              <ArrowUpRight className="size-4" />
            </Link>
            <Link
              href="/compare"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'h-11 px-6 text-[0.95rem]'
              )}
            >
              {m['landing.hero.cta_compare']()}
            </Link>
          </div>
        </div>

        {/* Right — official Kimi K3 unveiling video (click-to-play) */}
        <div className="relative">
          <div
            aria-hidden
            className="brand-gradient pointer-events-none absolute -inset-4 -z-10 rounded-[1.75rem] opacity-20 blur-2xl"
          />
          <div className="border-foreground/10 bg-card relative aspect-video overflow-hidden rounded-2xl border shadow-[0_30px_80px_-40px_rgba(13,11,8,0.5)]">
            <iframe
              className="absolute inset-0 size-full"
              src="https://www.youtube-nocookie.com/embed/bn0atstgavo?rel=0&modestbranding=1"
              title="Meet Kimi K3 — Moonshot AI (official)"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <p className="text-foreground/45 mt-3 flex items-center justify-end gap-1.5 text-right text-xs">
            <PlayCircle className="size-3.5" />
            {m['landing.hero.shot_caption']()}
          </p>
        </div>
      </div>
    </section>
  );
}
