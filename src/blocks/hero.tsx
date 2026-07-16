import { ArrowRight, Sparkles } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-16 sm:pt-36 sm:pb-24">
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

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="https://www.kimi.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-12 gap-2 rounded-full px-7 text-[15px]'
              )}
            >
              {m['landing.hero.cta']()}
              <ArrowRight className="size-4" />
            </a>
            <Link
              href="/#features"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'h-12 gap-2 rounded-full px-7 text-[15px]'
              )}
            >
              {m['landing.hero.secondary']()}
            </Link>
          </div>

          <p className="text-foreground/50 mt-6 text-sm">
            {m['landing.hero.proof']()}
          </p>
        </div>

        {/* Right — chat mockup */}
        <div className="relative">
          <ChatMockup />
        </div>
      </div>
    </section>
  );
}

function ChatMockup() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="brand-gradient absolute -inset-6 rounded-[2rem] opacity-10 blur-2xl"
      />
      <div className="border-foreground/10 bg-card relative rounded-[1.75rem] border p-3 shadow-[0_30px_80px_-30px_rgba(13,11,8,0.35)] sm:p-4">
        {/* window bar */}
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="bg-foreground/15 size-2.5 rounded-full" />
          <span className="text-foreground/40 ml-2 text-[11px] font-medium">
            kimik3
          </span>
        </div>

        <div className="bg-muted/40 space-y-4 rounded-[1.25rem] p-4 sm:p-5">
          {/* user msg */}
          <div className="flex justify-end">
            <div className="bg-foreground text-background max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
              {m['landing.hero.chat_user']()}
            </div>
          </div>

          {/* assistant msg */}
          <div className="flex gap-2.5">
            <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
              <Sparkles className="size-3.5 text-white" />
            </div>
            <div className="max-w-[85%] space-y-2">
              <p className="bg-card rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed shadow-sm">
                {m['landing.hero.chat_assistant']()}
              </p>
              <div className="flex flex-wrap gap-1.5 pl-1">
                {[
                  'landing.hero.tag_1',
                  'landing.hero.tag_2',
                  'landing.hero.tag_3',
                ].map((k) => (
                  <span
                    key={k}
                    className="border-foreground/10 bg-card text-foreground/55 rounded-full border px-2.5 py-1 text-[11px]"
                  >
                    {m[k as 'landing.hero.tag_1']()}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* prompt bar */}
        <div className="border-foreground/10 bg-card mt-3 flex items-center gap-2 rounded-2xl border p-2 pl-4">
          <span className="text-foreground/40 flex-1 truncate text-sm">
            {m['landing.hero.chat_placeholder']()}
          </span>
          <span className="brand-gradient flex size-8 items-center justify-center rounded-xl">
            <ArrowRight className="size-4 text-white" />
          </span>
        </div>
      </div>
    </div>
  );
}
