import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';
import { buttonVariants } from '@/components/ui/button';

export function Start() {
  const examples = m['landing.start.examples']()
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <section className="px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Reveal className="text-center">
          <h2 className="text-[clamp(2rem,4.2vw,3rem)] leading-[1.08] font-medium tracking-[-0.02em]">
            {m['landing.start.title']()}
          </h2>
          <p className="text-foreground/60 mx-auto mt-5 max-w-xl text-lg leading-relaxed">
            {m['landing.start.description']()}
          </p>
        </Reveal>

        <Reveal delay={80}>
          {/* prompt input */}
          <div className="border-foreground/10 bg-card mt-10 flex items-center gap-2 rounded-2xl border p-2.5 pl-5 shadow-[0_20px_60px_-30px_rgba(13,11,8,0.4)] sm:pl-6">
            <span className="text-foreground/45 flex-1 truncate text-left text-[15px]">
              {m['landing.start.placeholder']()}
            </span>
            <Link
              href="/sign-up"
              className={cn(
                buttonVariants(),
                'h-11 gap-2 rounded-xl px-5 text-sm'
              )}
            >
              {m['landing.start.button']()}
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {/* example chips */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {examples.map((ex) => (
              <Link
                key={ex}
                href="/sign-up"
                className="border-foreground/10 bg-card/60 text-foreground/65 hover:border-foreground/20 hover:text-foreground rounded-full border px-4 py-2 text-sm transition-colors"
              >
                {ex}
              </Link>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
