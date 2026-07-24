import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';

export function Assets() {
  const items = m['landing.assets.items']()
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  // duplicate for a seamless marquee loop
  const row = [...items, ...items];

  return (
    <section className="px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="flex flex-row flex-wrap items-baseline justify-center gap-x-3 text-[clamp(2rem,4.2vw,3rem)] leading-[1.08] font-medium tracking-[-0.02em]">
            <span>{m['landing.assets.title_prefix']()}</span>
            <span className="text-brand-gradient">
              {m['landing.assets.title_gradient']()}
            </span>
          </h2>
          <p className="text-foreground/60 mt-5 text-left text-lg leading-relaxed">
            {m['landing.assets.description']()}
          </p>
        </Reveal>
      </div>

      <div className="marquee-mask relative mt-12 flex overflow-hidden">
        <div className="animate-marquee flex shrink-0 items-center gap-3 pr-3">
          {row.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="border-foreground/10 bg-card text-foreground/70 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium whitespace-nowrap shadow-sm"
            >
              <span className="brand-gradient size-1.5 rounded-full" />
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
