import { Sparkles } from 'lucide-react';

import { m } from '@/paraglide/messages.js';
import { HeroChat } from '@/blocks/hero-chat';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-20 sm:pt-32 sm:pb-24">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
          <Sparkles className="size-3.5 text-[#7c3aed]" />
          {m['landing.hero.eyebrow']()}
        </span>

        <h1 className="mt-6 text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.05] font-medium tracking-[-0.02em]">
          {m['landing.hero.headline_prefix']()}{' '}
          <span className="text-brand-gradient">
            {m['landing.hero.headline_gradient']()}
          </span>
        </h1>

        <p className="text-foreground/65 mx-auto mt-6 max-w-2xl text-lg leading-relaxed sm:text-xl">
          {m['landing.hero.subheadline']()}
        </p>
      </div>

      {/* the hero centerpiece — upload + lead capture */}
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
