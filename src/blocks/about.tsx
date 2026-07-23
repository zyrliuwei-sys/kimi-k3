import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';

/**
 * Brand explainer block. Tells visitors what kimik3 is, where it sits relative
 * to Moonshot AI, and why the workspace exists. Doubles as the homepage's
 * main body copy — it carries most of the keyword density for "kimik3" so the
 * landing page reads as a single coherent answer to the brand query.
 */
export function About() {
  const paragraphs = [
    m['landing.about.body_1'](),
    m['landing.about.body_2'](),
    m['landing.about.body_3'](),
    // No-op fallback so the split never produces an empty array if a locale
    // forgets a body_3 key during translation. (m[...]() returns '' for missing
    // keys; the filter keeps the real paragraphs.)
  ].filter(Boolean);

  return (
    <section id="about" className="px-4 py-24 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <Reveal className="text-center">
          <h2 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
            {m['landing.about.title']()}
          </h2>
          <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
            {m['landing.about.subtitle']()}
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div className="text-foreground/75 mx-auto mt-12 max-w-2xl space-y-6 text-[15.5px] leading-[1.75]">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
