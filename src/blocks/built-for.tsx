import {
  Briefcase,
  Code2,
  Feather,
  Microscope,
  type LucideIcon,
} from 'lucide-react';

import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';

const ICONS: LucideIcon[] = [Briefcase, Microscope, Feather, Code2];

export function BuiltFor() {
  const cards = m['landing.builtfor.cards']()
    .split('##')
    .map((pair) => pair.split('|||').map((s) => s.trim()));

  return (
    <section className="px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2rem,4.2vw,3rem)] leading-[1.08] font-medium tracking-[-0.02em]">
            {m['landing.builtfor.title']()}
          </h2>
          <p className="text-foreground/60 mt-5 text-lg leading-relaxed">
            {m['landing.builtfor.description']()}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {cards.map(([title, desc], i) => {
            const Icon = ICONS[i % ICONS.length] ?? Briefcase;
            return (
              <Reveal key={title} delay={i * 70}>
                <div className="group border-foreground/10 bg-card flex h-full items-start gap-4 rounded-2xl border p-6 transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-36px_rgba(13,11,8,0.45)]">
                  <div className="bg-muted text-foreground/70 group-hover:brand-gradient flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors group-hover:text-white">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="font-medium tracking-tight">{title}</h3>
                    <p className="text-foreground/55 mt-1.5 text-sm leading-relaxed">
                      {desc}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* testimonial */}
        <Reveal delay={120}>
          <figure className="border-foreground/10 bg-card mt-6 rounded-3xl border p-8 text-center sm:p-12">
            <blockquote className="text-foreground/85 mx-auto max-w-3xl text-xl leading-relaxed tracking-tight text-balance sm:text-2xl">
              “{m['landing.builtfor.quote']()}”
            </blockquote>
            <figcaption className="text-foreground/50 mt-6 text-sm">
              <span className="text-foreground/70 font-medium">
                {m['landing.builtfor.quote_author']()}
              </span>
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
