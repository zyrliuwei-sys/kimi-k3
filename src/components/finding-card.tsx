import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import {
  cursorDeepLink,
  normalizeCursorPrompt,
  type Finding,
  type Severity,
} from '@/modules/website-audit';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

const SEVERITY_STYLES: Record<
  Severity,
  { badge: string; left: string; ring: string }
> = {
  critical: {
    badge: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
    left: 'bg-rose-500',
    ring: 'ring-rose-500/20',
  },
  high: {
    badge:
      'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',
    left: 'bg-orange-500',
    ring: 'ring-orange-500/20',
  },
  medium: {
    badge:
      'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
    left: 'bg-amber-500',
    ring: 'ring-amber-500/20',
  },
  low: {
    badge: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
    left: 'bg-sky-500',
    ring: 'ring-sky-500/20',
  },
};

const SEVERITY_I18N: Record<Severity, () => string> = {
  critical: () => m['audit.finding.severity.critical'](),
  high: () => m['audit.finding.severity.high'](),
  medium: () => m['audit.finding.severity.medium'](),
  low: () => m['audit.finding.severity.low'](),
};

/**
 * Single finding card: title, severity chip, evidence block, fix description,
 * and the two "Copy Cursor prompt" / "Open in Cursor" buttons that drive the
 * product's "Cursor-ready" differentiator.
 */
export function FindingCard({ finding }: { finding: Finding }) {
  const [copied, setCopied] = useState(false);
  const style = SEVERITY_STYLES[finding.severity];
  const cleanedPrompt = normalizeCursorPrompt(finding.cursorPrompt);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(cleanedPrompt);
      setCopied(true);
      toast.success(m['audit.finding.copied']());
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  function openInCursor() {
    if (typeof window === 'undefined') return;
    window.location.href = cursorDeepLink(cleanedPrompt);
  }

  return (
    <article
      className={cn(
        'bg-card text-card-foreground ring-foreground/10 relative rounded-lg p-4 ring-1',
        style.ring
      )}
    >
      <div
        className={cn(
          'absolute top-4 bottom-4 left-0 w-1 rounded-r',
          style.left
        )}
      />

      <header className="flex items-start justify-between gap-3 pl-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">{finding.title}</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            <code className="bg-muted rounded px-1.5 py-0.5 text-[11px]">
              {finding.id}
            </code>
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ring-1',
            style.badge
          )}
        >
          {SEVERITY_I18N[finding.severity]()}
        </span>
      </header>

      {finding.evidence ? (
        <div className="mt-3 pl-3">
          <p className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
            {m['audit.finding.evidence']()}
          </p>
          <pre className="bg-muted/60 text-foreground/85 max-h-32 overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap">
            {finding.evidence}
          </pre>
        </div>
      ) : null}

      {finding.fix ? (
        <div className="mt-3 pl-3">
          <p className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
            {m['audit.finding.fix']()}
          </p>
          <p className="text-foreground/90 text-[13px] leading-relaxed">
            {finding.fix}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2 pl-3">
        <button
          type="button"
          onClick={copyPrompt}
          className="bg-muted hover:bg-muted/70 text-foreground/90 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {m['audit.finding.copy_prompt']()}
        </button>
        <button
          type="button"
          onClick={openInCursor}
          className="bg-foreground text-background hover:bg-foreground/90 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-opacity"
        >
          <ExternalLink className="size-3.5" />
          {m['audit.finding.open_cursor']()}
        </button>
      </div>
    </article>
  );
}
