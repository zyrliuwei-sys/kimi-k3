import { useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';

import { tDynamic } from '@/core/i18n/dynamic';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  useCreateAudit,
  type CreateAuditResponse,
} from '@/hooks/use-create-audit';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { AuditProgress } from './audit-progress';
import { AuditReportView } from './audit-report';

type Step = 'input' | 'progress' | 'report' | 'error';

const ERROR_KEY_MAP: Record<string, string> = {
  invalid_url: 'audit.modal.errors.invalid_url',
  protocol_blocked: 'audit.modal.errors.ssrf',
  ssrf: 'audit.modal.errors.ssrf',
  dns_lookup_failed: 'audit.modal.errors.ssrf',
  private_ip_blocked: 'audit.modal.errors.ssrf',
  unreachable: 'audit.modal.errors.unreachable',
  too_many_redirects: 'audit.modal.errors.unreachable',
  body_too_large: 'audit.modal.errors.too_large',
  not_html: 'audit.modal.errors.not_html',
  audit_llm_unavailable: 'audit.modal.errors.llm_unavailable',
  audit_llm_timeout: 'audit.modal.errors.timeout',
  audit_llm_invalid_json: 'audit.modal.errors.llm_invalid',
  input_too_large: 'audit.modal.errors.input_too_large',
  insufficient_credits: 'audit.modal.errors.insufficient_credits',
};

export function AuditModal({
  open,
  onOpenChange,
  defaultUrl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-fill the URL field — useful for the demo CTA. */
  defaultUrl?: string;
}) {
  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [result, setResult] = useState<CreateAuditResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string>('');
  const createMutation = useCreateAudit();

  function reset() {
    setStep('input');
    setUrl(defaultUrl ?? '');
    setResult(null);
    setErrorCode('');
    createMutation.reset();
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const cleaned = normalizeUrlInput(url.trim());
    if (!cleaned) return;
    setUrl(cleaned); // reflect the normalized form back so the user sees it
    setStep('progress');
    setResult(null);
    setErrorCode('');
    try {
      const r = await createMutation.mutateAsync({ url: cleaned });
      setResult(r);
      setStep('report');
    } catch (err: any) {
      // api-client throws ApiError; its message is the respErr code from the server.
      const code =
        err instanceof ApiError
          ? err.message
          : String(err?.message || 'unknown');
      setErrorCode(code);
      setStep('error');
    }
  }

  function handleRerun() {
    setStep('input');
    setResult(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m['audit.modal.title']()}</DialogTitle>
          <DialogDescription className="text-xs">
            {m['audit.modal.subtitle']()}
          </DialogDescription>
        </DialogHeader>

        {step === 'input' ? (
          <InputStep
            url={url}
            setUrl={setUrl}
            onSubmit={handleSubmit}
            onPickDemo={(demo) => setUrl(demo)}
          />
        ) : null}

        {step === 'progress' ? (
          <AuditProgress variant={result?.cached ? 'cached' : 'analyzing'} />
        ) : null}

        {step === 'report' && result ? (
          <AuditReportView
            report={result.report}
            benchmark={result.benchmark}
            onRerun={handleRerun}
          />
        ) : null}

        {step === 'error' ? (
          <ErrorStep code={errorCode} onRetry={handleRerun} />
        ) : null}

        <DialogFooter showCloseButton={false}>
          <Button variant="outline" onClick={close}>
            {step === 'report' ? 'Close' : m['audit.modal.cancel']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────

function InputStep({
  url,
  setUrl,
  onSubmit,
  onPickDemo,
}: {
  url: string;
  setUrl: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onPickDemo: (v: string) => void;
}) {
  const submitting = false; // input is enabled until Progress mounts
  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <label
          htmlFor="audit-url"
          className="text-foreground/80 text-xs font-medium"
        >
          {m['audit.modal.url_label']()}
        </label>
        <input
          id="audit-url"
          type="text"
          autoFocus
          placeholder={m['audit.modal.url_placeholder']()}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border-foreground/15 bg-background placeholder:text-foreground/40 focus:border-foreground/30 focus:ring-foreground/10 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() => onPickDemo('https://stripe.com')}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          <span aria-hidden>👀</span> {m['audit.modal.demo_url']()}
        </button>
        <span className="text-muted-foreground">
          {url.trim()
            ? m['audit.modal.cost']({ n: 5 })
            : m['audit.modal.cost_free']()}
        </span>
      </div>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={!url.trim()} size="default">
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowRight className="size-3.5" />
          )}
          {m['audit.modal.start']()}
        </Button>
      </div>
    </form>
  );
}

function ErrorStep({ code, onRetry }: { code: string; onRetry: () => void }) {
  const i18nKey = ERROR_KEY_MAP[code] ?? 'audit.modal.errors.unknown';
  // `renderErrorMessage` lives below — kept at module scope so Paraglide
  // can statically trace the keys, despite the runtime dispatch.
  return (
    <div className="bg-destructive/5 ring-destructive/20 space-y-3 rounded-lg p-4 ring-1">
      <div className="text-destructive flex items-start gap-2">
        <X className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {m['audit.modal.errors.title']()}
          </p>
          <p className="text-foreground/80 mt-1 text-xs">
            {renderErrorMessage(code)}
          </p>
          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
            {code}
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onRetry} variant="outline" size="sm">
          {m['audit.modal.start']()}
        </Button>
      </div>
    </div>
  );
}

// Re-export so consumers (AuditTrigger) can render the pre-filled demo flow.
export { cn };

/**
 * Render the user-facing error message for a runtime-resolved error code.
 *
 * `tDynamic` opts the bundle out of tree-shaking for these few keys —
 * acceptable here because error rendering is a cold path and the keys
 * aren't predictable statically. The 5-credit fallback in
 * `insufficient_credits` matches the default cost on the server.
 */
function renderErrorMessage(code: string): string {
  const fallback = tDynamic('audit.modal.errors.unknown');
  const i18nKey = ERROR_KEY_MAP[code] ?? 'audit.modal.errors.unknown';
  if (i18nKey === 'audit.modal.errors.insufficient_credits') {
    return m['audit.modal.errors.insufficient_credits']({ n: 5 });
  }
  return tDynamic(i18nKey) || fallback;
}

/**
 * Normalize user input:
 *   - trim whitespace
 *   - prepend `https://` if no protocol present (covers "stripe.com" input)
 *   - return "" if the result is clearly invalid
 *
 * Important: we DON'T use `<input type="url">` because its HTML5 validation
 * rejects non-protocol strings with a native browser tooltip that bypasses
 * our nice i18n'd error handling.
 */
function normalizeUrlInput(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(javascript|data|file):/i.test(trimmed)) return ''; // refuse
  // Strip leading "//" (protocol-relative) — uncommon but cheap to handle.
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  // Otherwise treat as a bare host (no protocol) → default to https.
  return `https://${trimmed}`;
}
