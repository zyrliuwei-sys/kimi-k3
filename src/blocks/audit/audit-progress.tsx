import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

interface ProgressStep {
  /** i18n key — when null, step is "completed but unrendered" */
  labelKey:
    | 'audit.modal.step.fetching'
    | 'audit.modal.step.parsing'
    | 'audit.modal.step.analyzing'
    | 'audit.modal.step.cached';
  /** Stable id used as React key */
  id: string;
}

const STEPS: ProgressStep[] = [
  { id: 'fetching', labelKey: 'audit.modal.step.fetching' },
  { id: 'parsing', labelKey: 'audit.modal.step.parsing' },
  { id: 'analyzing', labelKey: 'audit.modal.step.analyzing' },
];

/**
 * Animated progress UI for the audit modal.
 *
 * The current step is opaque; past steps are checked; future steps fade.
 * Why fake a 3-step pipeline: we don't expose actual backend phases, but
 * showing steady motion keeps the user from cancelling during the LLM wait
 * (the dominant latency for this feature).
 */
export function AuditProgress({
  variant = 'analyzing',
}: {
  /** 'analyzing' shows all 3 stages; 'cached' shows just the cache-load line. */
  variant?: 'analyzing' | 'cached';
}) {
  if (variant === 'cached') {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <Loader2 className="text-primary size-7 animate-spin" />
        <p className="text-foreground/80 text-sm">
          {m['audit.modal.step.cached']()}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-6">
      {STEPS.map((step, i) => (
        <Step key={step.id} step={step} index={i} />
      ))}
    </div>
  );
}

function Step({ step, index }: { step: ProgressStep; index: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
        index === 0 ? 'bg-muted/60 text-foreground/85' : 'text-foreground/45'
      )}
    >
      <span className="flex size-6 items-center justify-center">
        {index === 0 ? (
          <Loader2 className="text-primary size-3.5 animate-spin" />
        ) : (
          <span className="bg-foreground/15 size-1.5 rounded-full" />
        )}
      </span>
      <p className="text-sm font-medium">{m[step.labelKey]()}</p>
    </div>
  );
}
