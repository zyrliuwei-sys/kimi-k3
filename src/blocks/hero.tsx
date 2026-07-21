import { ArrowUpRight, Info, Sparkles } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { HeroChat } from '@/blocks/hero-chat';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-20 sm:pt-32 sm:pb-24">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
      />

      {/* decorative background: a faded "official interface" browser frame
          (CSS placeholder — swap for a real screenshot later). It sits behind
          the header, blurred and dimmed so the foreground stays readable. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-20 left-1/2 w-[min(960px,92vw)] -translate-x-1/2 opacity-[0.3] blur-[2px] dark:opacity-[0.18]"
      >
        <OfficialInterfaceMock />
      </div>

      <div className="relative mx-auto max-w-3xl text-center">
        {/* unofficial disclaimer badge (prominent) */}
        <span className="border-foreground/10 bg-card/80 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
          <Sparkles className="size-3.5 text-[#7c3aed]" />
          {m['landing.hero.eyebrow']()}
        </span>

        <h1 className="mt-6 text-[clamp(2.1rem,5.2vw,3.75rem)] leading-[1.05] font-medium tracking-[-0.02em]">
          {m['landing.hero.headline_prefix']()}{' '}
          <span className="text-brand-gradient">
            {m['landing.hero.headline_gradient']()}
          </span>{' '}
          <span className="text-foreground/65 font-normal">
            — {m['landing.hero.headline_suffix']()}
          </span>
        </h1>

        <p className="text-foreground/65 mx-auto mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">
          {m['landing.hero.subheadline']()}
        </p>

        {/* core action area — 3 CTAs side by side */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
          <Link
            href="/cheat-sheet"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'h-11 px-6 text-[0.95rem]'
            )}
          >
            {m['landing.hero.cta_cheat']()}
          </Link>
        </div>

        {/* caption tying the background mockup to the story */}
        <p className="text-foreground/45 mx-auto mt-5 inline-flex items-center gap-1.5 text-xs">
          <Info className="size-3.5" />
          {m['landing.hero.shot_caption']()}
        </p>
      </div>

      {/* the hero centerpiece — live chat (the simplified experience) */}
      <div
        id="upload"
        className="relative mx-auto mt-12 max-w-3xl scroll-mt-24"
      >
        <HeroChat />
      </div>

      <p className="text-foreground/50 mx-auto mt-8 max-w-2xl text-center text-sm">
        {m['landing.hero.proof']()}
      </p>
    </section>
  );
}

/** A stylized browser frame representing the (complex) official KimiK3
 *  interface. Decorative only — rendered faded behind the hero header. */
function OfficialInterfaceMock() {
  return (
    <div className="border-foreground/10 bg-card/60 overflow-hidden rounded-xl border shadow-2xl backdrop-blur">
      {/* browser chrome */}
      <div className="flex items-center gap-2 border-b border-inherit px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-yellow-400/70" />
        <span className="size-2.5 rounded-full bg-green-400/70" />
        <div className="bg-background/60 text-foreground/40 ml-3 flex-1 truncate rounded-md px-3 py-1 text-left text-[11px]">
          {m['landing.hero.shot_label']()}
        </div>
      </div>
      {/* fake dense interface body — deliberately busy to sell "we simplify it" */}
      <div className="space-y-2.5 p-4">
        <div className="flex gap-3">
          <div className="bg-foreground/8 h-16 w-1/4 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="bg-foreground/10 h-3 w-2/3 rounded" />
            <div className="bg-foreground/8 h-3 w-full rounded" />
            <div className="bg-foreground/8 h-3 w-5/6 rounded" />
          </div>
        </div>
        <div className="bg-foreground/8 h-3 w-full rounded" />
        <div className="bg-foreground/8 h-3 w-4/5 rounded" />
        <div className="flex gap-2 pt-1">
          <div className="bg-foreground/10 h-6 w-20 rounded-md" />
          <div className="bg-foreground/8 h-6 w-16 rounded-md" />
          <div className="bg-foreground/8 h-6 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}
