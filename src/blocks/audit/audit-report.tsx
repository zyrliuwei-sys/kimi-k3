import { useMemo, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import {
  batchAsMarkdown,
  type AuditReport,
  type Dimension,
  type Finding,
  type PriorityFix,
  type Section,
} from '@/modules/website-audit';
import type { BenchmarkPayload } from '@/modules/website-audit/benchmark';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { FindingCard } from '@/components/finding-card';
import { GradeBadge } from '@/components/grade-badge';
import { gradeFor, ScoreRing } from '@/components/score-ring';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DIMENSION_KEYS: Array<Exclude<Dimension, 'codeQuality'> | 'codeQuality'> =
  [
    'seo',
    'ui',
    'performance',
    'a11y',
    'aiReadability',
    'codeQuality',
    'content',
  ];

const DIMENSION_I18N: Record<Dimension, () => string> = {
  seo: () => m['audit.report.dimension.seo'](),
  ui: () => m['audit.report.dimension.ui'](),
  performance: () => m['audit.report.dimension.performance'](),
  a11y: () => m['audit.report.dimension.a11y'](),
  aiReadability: () => m['audit.report.dimension.aiReadability'](),
  codeQuality: () => m['audit.report.dimension.codeQuality'](),
  content: () => m['audit.report.dimension.content'](),
};

// ─── Top-level view ──────────────────────────────────────────────────────

export function AuditReportView({
  report,
  benchmark,
  onRerun,
  className,
}: {
  report: AuditReport;
  benchmark: BenchmarkPayload | null;
  onRerun?: () => void;
  className?: string;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const allFindings = useMemo(() => collectFindings(report), [report]);
  const priorityIds = useMemo(
    () => report.priorities.map((p) => p.findingId),
    [report]
  );

  async function copyAllPrompts() {
    try {
      const md = batchAsMarkdown(allFindings, {
        url: report.url,
        locale: report.locale,
        onlyIds: priorityIds,
      });
      await navigator.clipboard.writeText(md);
      setCopiedAll(true);
      toast.success(m['audit.finding.copied']());
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopiedJson(true);
      toast.success(m['audit.finding.copied']());
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Hero summary header */}
      <header className="bg-muted/50 flex items-start gap-4 rounded-xl p-4">
        <ScoreRing
          score={report.overall.score}
          grade={report.overall.grade}
          size={92}
          strokeWidth={9}
          sublabel={m['audit.report.overall']()}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-sm font-semibold">
              {report.finalUrl || report.url}
            </h3>
            <span className="text-muted-foreground text-[11px] tabular-nums">
              · {report.durationMs}ms
            </span>
          </div>
          <p className="text-foreground/85 text-[13px] leading-relaxed">
            {report.summary}
          </p>
          {benchmark && benchmark.overall.sample >= 10 ? (
            <p className="text-muted-foreground text-[11px]">
              {m['audit.report.benchmark.line']({
                p25: benchmark.overall.p25,
                p50: benchmark.overall.p50,
                p75: benchmark.overall.p75,
                n: benchmark.overall.sample,
              })}
            </p>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue="priorities">
        <TabsList
          variant="line"
          className="h-auto w-full overflow-x-auto p-0 text-xs"
        >
          <TabsTrigger value="priorities">
            {m['audit.report.priorities']()}
          </TabsTrigger>
          {DIMENSION_KEYS.map((dim) => {
            const section = report.sections[dim];
            if (!section) return null;
            return (
              <TabsTrigger key={dim} value={dim}>
                {DIMENSION_I18N[dim]()}
                <span className="text-muted-foreground ml-1 tabular-nums">
                  {section.score}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="priorities" className="mt-4">
          <PriorityList
            priorities={report.priorities}
            findingLookup={makeFindingLookup(report)}
          />
        </TabsContent>

        {DIMENSION_KEYS.map((dim) => {
          const section = report.sections[dim];
          if (!section) return null;
          return (
            <TabsContent key={dim} value={dim} className="mt-4">
              <SectionView
                dim={dim}
                section={section}
                benchmark={
                  benchmark?.perDimension?.[dim]
                    ? {
                        p25: benchmark.perDimension[dim].p25,
                        p50: benchmark.perDimension[dim].p50,
                        p75: benchmark.perDimension[dim].p75,
                      }
                    : null
                }
              />
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="flex items-center gap-2 border-t pt-3">
        <Button onClick={copyAllPrompts} variant="outline" size="sm">
          {copiedAll ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {m['audit.finding.copy_all']()}
        </Button>
        <Button onClick={copyJson} variant="outline" size="sm">
          {copiedJson ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          JSON
        </Button>
        {onRerun ? (
          <Button onClick={onRerun} variant="ghost" size="sm">
            <RefreshCw className="size-3.5" />
            {m['landing.hero.cta_audit']()}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ─── One dimension tab ───────────────────────────────────────────────────

function SectionView({
  dim,
  section,
  benchmark,
}: {
  dim: Dimension;
  section: Section;
  benchmark: { p25: number; p50: number; p75: number } | null;
}) {
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GradeBadge grade={section.grade} size="md" />
          <div>
            <h4 className="text-sm font-semibold">{DIMENSION_I18N[dim]()}</h4>
            {section.summary ? (
              <p className="text-muted-foreground text-xs">{section.summary}</p>
            ) : null}
          </div>
        </div>
        {benchmark ? (
          <p className="text-muted-foreground text-right text-[10px] tabular-nums">
            {m['audit.report.benchmark.line']({ ...benchmark, n: 0 })}
          </p>
        ) : null}
      </header>

      {section.findings.length === 0 ? (
        <p className="bg-muted/50 text-muted-foreground rounded-lg p-4 text-center text-sm">
          {m['audit.finding.no_findings']()}
        </p>
      ) : (
        <div className="space-y-3">
          {section.findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Priorities tab ───────────────────────────────────────────────────────

function PriorityList({
  priorities,
  findingLookup,
}: {
  priorities: PriorityFix[];
  findingLookup: (id: string) => Finding | undefined;
}) {
  if (priorities.length === 0) {
    return (
      <p className="bg-muted/50 text-muted-foreground rounded-lg p-4 text-center text-sm">
        {m['audit.finding.no_findings']()}
      </p>
    );
  }

  return (
    <ol className="space-y-2.5">
      {priorities.map((p, i) => {
        const f = findingLookup(p.findingId);
        if (!f) return null;
        return (
          <li key={p.findingId} className="flex gap-3">
            <span className="bg-foreground/5 text-muted-foreground mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <FindingCard finding={f} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function collectFindings(report: AuditReport): Finding[] {
  const out: Finding[] = [];
  for (const dim of DIMENSION_KEYS) {
    const section = report.sections[dim];
    if (!section) continue;
    out.push(...section.findings);
  }
  return out;
}

function makeFindingLookup(
  report: AuditReport
): (id: string) => Finding | undefined {
  const all = collectFindings(report);
  const map = new Map<string, Finding>();
  for (const f of all) map.set(f.id, f);
  return (id: string) => map.get(id);
}

// `gradeFor` re-exported for downstream use cases (e.g. free-form score cards).
export { gradeFor };
