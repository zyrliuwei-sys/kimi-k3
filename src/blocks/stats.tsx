import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';

export function Stats() {
  const stats = m['landing.stats.items']()
    .split('##')
    .map((pair) => pair.split('|||').map((s) => s.trim()));

  return (
    <section className="px-4 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[2rem] bg-neutral-950 px-6 py-14 text-center text-neutral-100 sm:px-12 sm:py-16">
          <div
            aria-hidden
            className="brand-gradient pointer-events-none absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          />
          <Reveal className="relative">
            <h2 className="mx-auto max-w-2xl text-[clamp(1.75rem,3.6vw,2.5rem)] leading-tight font-medium tracking-[-0.02em]">
              {m['landing.stats.title']()}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-neutral-400">
              {m['landing.stats.subtitle']()}
            </p>

            <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-8">
              {stats.map(([num, label]) => (
                <div key={label}>
                  <dt className="text-brand-gradient text-4xl font-semibold tracking-tight sm:text-5xl">
                    {num}
                  </dt>
                  <dd className="mt-2 text-sm text-neutral-400">{label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
