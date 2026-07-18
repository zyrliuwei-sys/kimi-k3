import { Sparkles } from 'lucide-react';

import { m } from '@/paraglide/messages.js';

export function AboutKimik3() {
  const items = m['landing.about.items']()
    .split('##')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((card) => {
      const [title, desc] = card.split('|||').map((x) => x.trim());
      return { title: title ?? '', desc: desc ?? '' };
    });

  return (
    <section className="relative px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-[#7c3aed]" />
            {m['landing.about.eyebrow']()}
          </span>
          <h2 className="mt-6 text-[clamp(2rem,4vw,3rem)] font-medium tracking-[-0.02em]">
            {m['landing.about.title']()}
          </h2>
          <div className="text-foreground/65 mt-5 space-y-4 text-left text-[15px] leading-relaxed sm:text-base">
            <p>{m['landing.about.intro_1']()}</p>
            <p>{m['landing.about.intro_2']()}</p>
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {items.map((it, i) => (
            <div
              key={i}
              className="border-foreground/10 bg-card/60 hover:border-foreground/20 rounded-2xl border p-5 transition-colors"
            >
              <h3 className="text-[15px] font-semibold">{it.title}</h3>
              <p className="text-foreground/60 mt-2 text-sm leading-relaxed">
                {it.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
