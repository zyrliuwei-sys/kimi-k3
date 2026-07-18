import { Check, ExternalLink, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

interface Plan {
  model: string;
  vendor: string;
  input: string;
  cached: string;
  output: string;
  context: string;
  openWeight: boolean;
  highlight?: boolean;
  footnote?: boolean;
}

// Verified July 2026 — see sources at the bottom of the section.
const PLANS: Plan[] = [
  {
    model: 'Kimi K3',
    vendor: 'Moonshot AI',
    input: '$3.00',
    cached: '$0.30',
    output: '$15.00',
    context: '1M',
    openWeight: true,
    highlight: true,
  },
  {
    model: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    input: '$5.00',
    cached: '$0.50',
    output: '$25.00',
    context: '1M',
    openWeight: false,
  },
  {
    model: 'Claude Sonnet 5',
    vendor: 'Anthropic',
    input: '$2.00*',
    cached: '$0.20*',
    output: '$10.00*',
    context: '1M',
    openWeight: false,
    footnote: true,
  },
  {
    model: 'GPT-5.5',
    vendor: 'OpenAI',
    input: '$5.00',
    cached: '$0.50',
    output: '$30.00',
    context: '1M',
    openWeight: false,
  },
];

const SOURCES = [
  {
    label: 'Kimi K3 — OpenRouter',
    href: 'https://openrouter.ai/moonshotai/kimi-k3',
  },
  {
    label: 'Claude — platform.claude.com',
    href: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  { label: 'GPT-5.5 — openai.com', href: 'https://openai.com/api/pricing/' },
];

export function ComparePricing() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:py-32">
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-40 left-1/2 h-[460px] w-[760px] -translate-x-1/2 rounded-full opacity-[0.14] blur-3xl"
      />
      <div className="relative mx-auto max-w-5xl">
        {/* header */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-[#7c3aed]" />
            {m['landing.compare.eyebrow']()}
          </span>
          <h1 className="mt-6 text-[clamp(2.25rem,5vw,3.5rem)] font-medium tracking-[-0.02em]">
            <span className="text-brand-gradient">KimiK3</span> vs Claude vs GPT
          </h1>
          <p className="text-foreground/65 mt-5 text-lg leading-relaxed">
            {m['landing.compare.description']()}
          </p>
        </div>

        {/* takeaway */}
        <div className="border-foreground/10 bg-card/60 mt-12 flex items-start gap-3 rounded-2xl border p-5 backdrop-blur">
          <span className="brand-gradient mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg">
            <Check className="size-4 text-white" />
          </span>
          <p className="text-foreground/80 text-[15px] leading-relaxed">
            {m['landing.compare.takeaway']()}
          </p>
        </div>

        {/* table */}
        <div className="border-foreground/10 bg-card/40 mt-6 overflow-x-auto rounded-2xl border backdrop-blur">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="text-foreground/50 border-foreground/10 border-b text-xs tracking-wide uppercase">
                <th className="px-5 py-4 font-medium">
                  {m['landing.compare.col_model']()}
                </th>
                <th className="px-4 py-4 font-medium">
                  {m['landing.compare.col_vendor']()}
                </th>
                <th className="px-4 py-4 text-right font-medium">
                  {m['landing.compare.col_input']()}
                  <span className="text-foreground/35 ml-1 normal-case">
                    {m['landing.compare.unit_mtok']()}
                  </span>
                </th>
                <th className="px-4 py-4 text-right font-medium">
                  {m['landing.compare.col_cached']()}
                  <span className="text-foreground/35 ml-1 normal-case">
                    {m['landing.compare.unit_mtok']()}
                  </span>
                </th>
                <th className="px-4 py-4 text-right font-medium">
                  {m['landing.compare.col_output']()}
                  <span className="text-foreground/35 ml-1 normal-case">
                    {m['landing.compare.unit_mtok']()}
                  </span>
                </th>
                <th className="px-4 py-4 text-right font-medium">
                  {m['landing.compare.col_context']()}
                </th>
                <th className="px-5 py-4 text-right font-medium">
                  {m['landing.compare.col_open']()}
                </th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((p) => (
                <tr
                  key={p.model}
                  className={cn(
                    'group border-foreground/8 border-b transition-colors last:border-b-0',
                    p.highlight
                      ? 'bg-[#7c3aed]/[0.06]'
                      : 'hover:bg-foreground/[0.02]'
                  )}
                >
                  <td className="relative px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      {p.highlight && (
                        <span
                          aria-hidden
                          className="brand-gradient absolute top-1/2 left-0 h-7 w-[3px] -translate-y-1/2 rounded-full"
                        />
                      )}
                      <span className="text-[15px] font-semibold">
                        {p.model}
                      </span>
                      {p.highlight && (
                        <span className="brand-gradient rounded-full px-2 py-0.5 text-[10px] font-semibold text-white">
                          {m['landing.compare.badge_value']()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-foreground/55 px-4 py-4 text-sm">
                    {p.vendor}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold tabular-nums">
                    {p.input}
                  </td>
                  <td className="text-foreground/60 px-4 py-4 text-right tabular-nums">
                    {p.cached}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold tabular-nums">
                    {p.output}
                  </td>
                  <td className="text-foreground/70 px-4 py-4 text-right tabular-nums">
                    {p.context}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {p.openWeight ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="size-4" />
                        {m['landing.compare.open_yes']()}
                      </span>
                    ) : (
                      <span className="text-foreground/40 text-sm">
                        {m['landing.compare.open_no']()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* footnote */}
        <p className="text-foreground/45 mt-4 text-xs leading-relaxed">
          *{m['landing.compare.sonnet_note']()}
        </p>

        {/* sources + disclaimer */}
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-foreground/45 text-xs font-medium tracking-wide uppercase">
              {m['landing.compare.sources']()}
            </div>
            <ul className="mt-3 space-y-2">
              {SOURCES.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground/70 hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-foreground/45 sm:border-foreground/10 text-xs leading-relaxed sm:border-l sm:pl-6">
            {m['landing.compare.disclaimer']()}
          </p>
        </div>
      </div>
    </section>
  );
}
