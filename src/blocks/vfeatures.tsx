import {
  ArrowUpRight,
  Check,
  MessageSquare,
  Search,
  Sparkles,
} from 'lucide-react';

import { m } from '@/paraglide/messages.js';
import { Reveal } from '@/components/reveal';

function parseFeatures() {
  return m['landing.vfeatures.items']()
    .split('##')
    .map((pair) => pair.split('|||').map((s) => s.trim()));
}

const TITLES = ['workspaces', 'builder', 'memory', 'collab'] as const;

export function VFeatures() {
  const features = parseFeatures();

  return (
    <section id="features" className="px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2rem,4.2vw,3rem)] leading-[1.08] font-medium tracking-[-0.02em]">
            {m['landing.vfeatures.title']()}
          </h2>
          <p className="text-foreground/60 mt-5 text-lg leading-relaxed">
            {m['landing.vfeatures.description']()}
          </p>
        </Reveal>

        <div className="mt-16 space-y-16 sm:space-y-24">
          {features.map(([title, desc], i) => {
            const slug = TITLES[i % TITLES.length];
            const reversed = i % 2 === 1;
            return (
              <Reveal key={title}>
                <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
                  <div className={reversed ? 'lg:order-2' : ''}>
                    <h3 className="text-2xl font-medium tracking-tight sm:text-3xl">
                      {title}
                    </h3>
                    <p className="text-foreground/60 mt-4 max-w-md text-lg leading-relaxed">
                      {desc}
                    </p>
                  </div>
                  <div className={reversed ? 'lg:order-1' : ''}>
                    <MockPanel slug={slug} />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MockPanel({ slug }: { slug: (typeof TITLES)[number] }) {
  if (slug === 'workspaces') return <WorkspacesMock />;
  if (slug === 'builder') return <BuilderMock />;
  if (slug === 'memory') return <MemoryMock />;
  return <CollabMock />;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="brand-gradient absolute -inset-4 rounded-[1.75rem] opacity-[0.07] blur-2xl"
      />
      <div className="border-foreground/10 bg-card relative rounded-[1.5rem] border p-5 shadow-[0_30px_70px_-40px_rgba(13,11,8,0.45)]">
        {children}
      </div>
    </div>
  );
}

function WorkspacesMock() {
  const ws = m['landing.vfeatures.mock_workspaces']()
    .split('|')
    .map((s) => s.trim());
  return (
    <Panel>
      <div className="flex gap-2">
        <div className="bg-muted/50 hidden w-32 shrink-0 space-y-1.5 rounded-xl p-2.5 sm:block">
          {ws.map((w, idx) => (
            <div
              key={w}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${idx === 0 ? 'bg-card font-medium shadow-sm' : 'text-foreground/50'}`}
            >
              <span className="brand-gradient size-4 rounded" />
              <span className="truncate">{w}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 space-y-2.5">
          {ws.slice(0, 3).map((w, idx) => (
            <div
              key={w}
              className="border-foreground/10 bg-muted/30 rounded-xl border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{w}</span>
                <span className="text-foreground/40 text-[10px]">
                  {idx + 1} active
                </span>
              </div>
              <div className="bg-foreground/10 mt-2.5 h-1.5 w-3/4 rounded-full" />
              <div className="bg-foreground/10 mt-1.5 h-1.5 w-1/2 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function BuilderMock() {
  return (
    <Panel>
      <div className="bg-muted/40 rounded-xl p-3.5">
        <div className="text-foreground/45 flex items-center gap-2 text-[11px]">
          <Sparkles className="size-3.5 text-[#7c3aed]" />
          {m['landing.vfeatures.mock_prompt']()}
        </div>
      </div>
      <div className="border-foreground/10 bg-card mt-3 space-y-2.5 rounded-xl border p-4">
        <div className="bg-foreground/80 h-2.5 w-1/3 rounded-full" />
        <div className="bg-foreground/12 h-1.5 rounded-full" />
        <div className="bg-foreground/12 h-1.5 w-11/12 rounded-full" />
        <div className="bg-foreground/12 h-1.5 w-9/12 rounded-full" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['#1', '#2', '#3'].map((n, i) => (
            <span
              key={n}
              className="bg-muted text-foreground/55 rounded-md px-2 py-1 text-[10px]"
            >
              {m[
                `landing.vfeatures.mock_chip_${i + 1}` as 'landing.vfeatures.mock_chip_1'
              ]()}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MemoryMock() {
  return (
    <Panel>
      <div className="border-foreground/10 bg-muted/40 flex items-center gap-2 rounded-xl border px-3.5 py-2.5">
        <Search className="text-foreground/45 size-4" />
        <span className="text-foreground/45 text-xs">
          {m['landing.vfeatures.mock_search']()}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-foreground/10 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium">
                {m[
                  `landing.vfeatures.mock_file_${i + 1}` as 'landing.vfeatures.mock_file_1'
                ]()}
              </span>
              <ArrowUpRight className="text-foreground/35 size-3.5" />
            </div>
            <div className="bg-foreground/10 mt-2 h-1.5 w-4/5 rounded-full" />
          </div>
        ))}
      </div>
      <p className="text-foreground/40 mt-3 text-[11px]">
        {m['landing.vfeatures.mock_search_note']()}
      </p>
    </Panel>
  );
}

function CollabMock() {
  return (
    <Panel>
      <div className="border-foreground/10 bg-muted/30 rounded-xl border p-4">
        <div className="bg-foreground/70 h-2 w-2/5 rounded-full" />
        <div className="bg-foreground/10 mt-2 h-1.5 w-3/4 rounded-full" />
      </div>
      <div className="mt-3 space-y-2.5">
        <div className="flex gap-2.5">
          <div className="brand-gradient mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white">
            A
          </div>
          <div className="border-foreground/10 bg-card flex-1 rounded-xl rounded-tl-md border p-2.5">
            <div className="text-foreground/45 flex items-center gap-1.5 text-[10px]">
              <MessageSquare className="size-3" />
              {m['landing.vfeatures.mock_comment_1']()}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <div className="bg-foreground text-background mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
            K
          </div>
          <div className="border-foreground/10 bg-card flex flex-1 items-center gap-2 rounded-xl rounded-tl-md border p-2.5">
            <span className="text-foreground/45 inline-flex items-center gap-1 text-[10px]">
              <Check className="size-3 text-[#0ea5e9]" />
              {m['landing.vfeatures.mock_comment_2']()}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
