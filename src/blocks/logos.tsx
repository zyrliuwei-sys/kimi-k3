import { m } from '@/paraglide/messages.js';

export function Logos() {
  const brands = m['landing.logos.brands']()
    .split('|')
    .map((b) => b.trim());

  return (
    <section className="px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="text-foreground/45 text-center text-sm font-medium tracking-wide">
          {m['landing.logos.title']()}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 sm:gap-x-14">
          {brands.map((brand) => (
            <span
              key={brand}
              className="text-foreground/35 hover:text-foreground/60 text-lg font-semibold tracking-tight transition-colors sm:text-xl"
            >
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
