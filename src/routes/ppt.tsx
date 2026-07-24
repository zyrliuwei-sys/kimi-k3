'use client';

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { TEMPLATES, type Template } from '@/modules/ppt/templates';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Header } from '@/blocks/header';

type Step = 1 | 2 | 3;

type SourceKind = 'empty' | 'text' | 'doc_collection';

interface DocCollectionSummary {
  id: string;
  name: string;
  docCount: number;
  totalPages: number;
}

interface TaskRow {
  id: string;
  status: 'queued' | 'outlining' | 'writing' | 'rendering' | 'done' | 'failed';
  progress: number;
  resultUrl: string | null;
  resultBytes: number | null;
  errorMessage: string | null;
  slideCount: number;
  templateId: string;
  title: string;
}

const SLIDE_OPTIONS = [10, 15, 20, 25];

function PptPage() {
  const { data: session, isPending } = useSession();
  const [step, setStep] = useState<Step>(1);
  const [sourceKind, setSourceKind] = useState<SourceKind>('empty');
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState('');
  const [textDraft, setTextDraft] = useState('');
  const [collections, setCollections] = useState<DocCollectionSummary[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('biz-dark');
  const [slideCount, setSlideCount] = useState(15);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load collections for the doc-library source option.
  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet<DocCollectionSummary[]>(
          '/api/doc-library/collection'
        );
        if (!cancelled) {
          setCollections(rows);
          if (rows.length && !selectedCollectionId) {
            setSelectedCollectionId(rows[0].id);
          }
        }
      } catch {
        // Non-fatal — collections list is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user, selectedCollectionId]);

  // Poll the task every 1.2s while it's running.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const row = await apiGet<TaskRow>(`/api/ppt/status?id=${taskId}`);
        if (cancelled) return;
        setTask(row);
        if (row.status === 'done' || row.status === 'failed') return;
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof ApiError ? e.message : 'Polling failed';
          setErrorMsg(msg);
        }
        return;
      }
      timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  async function handleGenerate() {
    if (submitting) return;
    if (!session?.user) {
      toast.error(m['ppt.error.unconfigured']());
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setSubmitError(null);
    setTask(null);

    const body: Record<string, unknown> = {
      title: topic.trim() || 'Untitled presentation',
      topic: topic.trim(),
      prompt: prompt.trim(),
      templateId,
      slideCount,
      sourceType: sourceKind,
    };
    if (sourceKind === 'text') body.sourceText = textDraft;
    if (sourceKind === 'doc_collection') {
      body.sourceCollectionId = selectedCollectionId;
    }

    try {
      const row = await apiPost<TaskRow>('/api/ppt/generate', body);
      setTaskId(row.id);
      setTask(row);
      setStep(3);
    } catch (e: any) {
      // Always log so the user can see the real error in dev tools.
      // eslint-disable-next-line no-console
      console.error('[ppt/generate] failed:', e);
      const status = e?.status;
      let userMsg: string;
      if (status === 402) {
        userMsg = m['ppt.error.payment_required']();
      } else if (status === 503) {
        userMsg = m['ppt.error.unconfigured']();
      } else if (e instanceof ApiError) {
        userMsg = e.message || m['ppt.error.generic']();
      } else {
        userMsg = e?.message || m['ppt.error.generic']();
      }
      setErrorMsg(userMsg);
      setSubmitError(userMsg);
      toast.error(userMsg, { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setStep(1);
    setTaskId(null);
    setTask(null);
    setErrorMsg(null);
    setSubmitError(null);
  }

  if (isPending) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <Loader2 className="text-foreground/55 size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-background flex h-[100dvh] flex-col overflow-hidden">
      <Header />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {m['ppt.title']()}
              </h1>
              <p className="text-foreground/55 mt-1 text-sm">
                {m['ppt.subtitle']()}
              </p>
            </div>
            <Stepper step={step} />
          </div>

          {step === 1 && (
            <Step1
              sourceKind={sourceKind}
              setSourceKind={setSourceKind}
              topic={topic}
              setTopic={setTopic}
              prompt={prompt}
              setPrompt={setPrompt}
              textDraft={textDraft}
              setTextDraft={setTextDraft}
              collections={collections}
              selectedCollectionId={selectedCollectionId}
              setSelectedCollectionId={setSelectedCollectionId}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2
              templateId={templateId}
              setTemplateId={setTemplateId}
              slideCount={slideCount}
              setSlideCount={setSlideCount}
              onBack={() => {
                setStep(1);
                setSubmitError(null);
              }}
              onGenerate={handleGenerate}
              submitting={submitting}
              submitError={submitError}
            />
          )}
          {step === 3 && (
            <Step3
              task={task}
              error={errorMsg}
              onRetry={handleGenerate}
              onReset={handleReset}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Step 1 — Source ──────────────────────────────────────────────────────────

function Step1({
  sourceKind,
  setSourceKind,
  topic,
  setTopic,
  prompt,
  setPrompt,
  textDraft,
  setTextDraft,
  collections,
  selectedCollectionId,
  setSelectedCollectionId,
  onNext,
}: {
  sourceKind: SourceKind;
  setSourceKind: (k: SourceKind) => void;
  topic: string;
  setTopic: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  textDraft: string;
  setTextDraft: (v: string) => void;
  collections: DocCollectionSummary[];
  selectedCollectionId: string;
  setSelectedCollectionId: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="text-foreground/85 mb-3 text-sm font-semibold">
          {m['ppt.step1.title']()}
        </h2>
        <div className="grid gap-2">
          <SourceRadio
            active={sourceKind === 'empty'}
            onClick={() => setSourceKind('empty')}
            label={m['ppt.step1.blank']()}
            desc="Just give us a topic — we'll write the whole deck from scratch."
          />
          <SourceRadio
            active={sourceKind === 'text'}
            onClick={() => setSourceKind('text')}
            label={m['ppt.step1.text']()}
            desc="Paste a topic, outline, or rough draft — we'll structure it into slides."
          />
          <SourceRadio
            active={sourceKind === 'doc_collection'}
            onClick={() => setSourceKind('doc_collection')}
            label={m['ppt.step1.docs']()}
            desc={
              collections.length
                ? `Synthesize across ${collections.length} document collection(s).`
                : m['ppt.step1.no_collections_hint']()
            }
          />
        </div>

        {sourceKind === 'doc_collection' && (
          <div className="mt-4">
            {collections.length === 0 ? (
              <div className="border-foreground/10 bg-card text-foreground/55 rounded-lg border p-4 text-sm">
                {m['ppt.step1.no_collections']()}
                <div className="mt-2">
                  <Link
                    href="/api-playground"
                    className="brand-gradient inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-white"
                  >
                    Go to Documents
                  </Link>
                </div>
              </div>
            ) : (
              <select
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                className="bg-card border-foreground/15 w-full rounded-lg border px-3 py-2 text-sm"
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.docCount} docs · {c.totalPages} pages
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {sourceKind === 'text' && (
          <div className="mt-4">
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="Paste your outline, draft, or just a topic description…"
              rows={6}
              className="bg-card border-foreground/15 placeholder:text-foreground/35 focus:border-foreground/30 w-full rounded-lg border p-3 text-sm outline-none"
            />
          </div>
        )}
      </div>

      <div>
        <div className="space-y-3">
          <Field
            label={m['ppt.step1.topic_label']()}
            required
            help="This becomes the deck title on the cover slide."
          >
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={m['ppt.step1.topic_placeholder']()}
              className="bg-card border-foreground/15 placeholder:text-foreground/35 focus:border-foreground/30 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </Field>
          <Field
            label={m['ppt.step1.prompt_label']()}
            help="Add any focus areas, audience, or constraints."
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={m['ppt.step1.prompt_placeholder']()}
              rows={4}
              className="bg-card border-foreground/15 placeholder:text-foreground/35 focus:border-foreground/30 w-full rounded-lg border p-3 text-sm outline-none"
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end lg:col-span-2">
        <button
          type="button"
          onClick={onNext}
          disabled={!topic.trim()}
          className="brand-gradient inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium text-white shadow-sm disabled:opacity-40"
        >
          Next — Choose template
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function SourceRadio({
  active,
  onClick,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        active
          ? 'border-foreground/30 bg-foreground/[0.04]'
          : 'border-foreground/10 bg-card hover:border-foreground/20'
      )}
    >
      <div
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded-full border-2',
          active ? 'border-foreground bg-foreground' : 'border-foreground/25'
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-foreground/55 mt-0.5 text-xs">{desc}</div>
      </div>
    </button>
  );
}

function Field({
  label,
  help,
  required,
  children,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-foreground/75 mb-1.5 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {help && <p className="text-foreground/45 mt-1 text-[11px]">{help}</p>}
    </div>
  );
}

// ── Step 2 — Template ────────────────────────────────────────────────────────

function Step2({
  templateId,
  setTemplateId,
  slideCount,
  setSlideCount,
  onBack,
  onGenerate,
  submitting,
  submitError,
}: {
  templateId: string;
  setTemplateId: (id: string) => void;
  slideCount: number;
  setSlideCount: (n: number) => void;
  onBack: () => void;
  onGenerate: () => void;
  submitError: string | null;
  submitting: boolean;
}) {
  return (
    <div>
      {submitError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-[10px] font-bold">
            !
          </span>
          <div className="flex-1">
            <div className="font-medium">Generation failed</div>
            <div className="text-foreground/75 dark:text-foreground/80 mt-0.5 text-xs">
              {submitError}
            </div>
          </div>
        </div>
      )}
      <h2 className="text-foreground/85 mb-3 text-sm font-semibold">
        {m['ppt.step2.title']()}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TEMPLATES.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            active={t.id === templateId}
            onClick={() => setTemplateId(t.id)}
          />
        ))}
      </div>

      <div className="mt-8">
        <div className="text-foreground/75 mb-2 text-xs font-medium">
          {m['ppt.step2.slides']({ count: slideCount })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SLIDE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSlideCount(n)}
              className={cn(
                'h-9 rounded-full border px-4 text-sm transition-colors',
                slideCount === n
                  ? 'border-foreground/30 bg-foreground/[0.06] font-semibold'
                  : 'border-foreground/10 bg-card hover:border-foreground/20'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-foreground/65 hover:text-foreground hover:bg-foreground/5 inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={submitting}
          className="brand-gradient inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {submitting ? 'Generating…' : 'Generate deck'}
        </button>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  active,
  onClick,
}: {
  template: Template;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'overflow-hidden rounded-xl border text-left transition-all',
        active
          ? 'border-foreground/40 ring-foreground/30 ring-2'
          : 'border-foreground/10 hover:border-foreground/25'
      )}
    >
      <div
        className="h-24 w-full"
        style={{
          background: `linear-gradient(135deg, ${template.colors.primary}, ${template.colors.secondary})`,
        }}
      >
        <div className="flex h-full items-end gap-1.5 p-3">
          <div
            className="h-1.5 w-12 rounded-full"
            style={{ background: template.colors.accent }}
          />
          <div className="h-1.5 w-8 rounded-full bg-white/50" />
          <div className="h-1.5 w-10 rounded-full bg-white/30" />
        </div>
      </div>
      <div className="bg-card p-3">
        <div className="flex items-center gap-2">
          <div
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: template.swatch }}
          />
          <div className="text-sm font-semibold">{template.name}</div>
        </div>
        <p className="text-foreground/55 mt-1 text-[11px] leading-snug">
          {template.blurb}
        </p>
      </div>
    </button>
  );
}

// ── Step 3 — Generating / Done ─────────────────────────────────────────────

function Step3({
  task,
  error,
  onRetry,
  onReset,
}: {
  task: TaskRow | null;
  error: string | null;
  onRetry: () => void;
  onReset: () => void;
}) {
  const status = task?.status;
  const isDone = status === 'done';
  const isFailed = status === 'failed' || !!error;
  const isRunning =
    !isDone &&
    !isFailed &&
    ['queued', 'outlining', 'writing', 'rendering'].includes(status ?? '');
  const progress = task?.progress ?? 0;

  return (
    <div>
      <div className="border-foreground/10 bg-card rounded-2xl border p-8">
        <div className="flex items-center gap-3">
          {isDone ? (
            <div className="brand-gradient grid size-10 shrink-0 place-items-center rounded-xl text-white">
              <Check className="size-5" />
            </div>
          ) : isFailed ? (
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-500">
              !
            </div>
          ) : (
            <div className="brand-gradient grid size-10 shrink-0 animate-pulse place-items-center rounded-xl text-white">
              <Sparkles className="size-5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold">
              {isDone
                ? m['ppt.step3.done']()
                : isFailed
                  ? m['ppt.step3.failed']()
                  : (status &&
                      m[`ppt.step3.${status}` as 'ppt.step3.queued']()) ||
                    m['ppt.step3.queued']()}
            </div>
            <div className="text-foreground/55 mt-0.5 text-xs">
              {task?.title || 'Working on it…'}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="font-mono text-sm tabular-nums">{progress}%</div>
            {task?.slideCount && (
              <div className="text-foreground/45 text-[10px]">
                {task.slideCount} slides
              </div>
            )}
          </div>
        </div>

        <div className="bg-foreground/10 mt-5 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="brand-gradient h-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {isDone && task?.resultUrl && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={task.resultUrl}
              target="_blank"
              rel="noreferrer"
              className="brand-gradient inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-sm"
            >
              <Download className="size-4" />
              {m['ppt.step3.download']()}
            </a>
            <a
              href={task.resultUrl}
              target="_blank"
              rel="noreferrer"
              className="border-foreground/15 hover:border-foreground/30 hover:bg-foreground/5 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors"
            >
              <ExternalLink className="size-4" />
              {m['ppt.step3.open']()}
            </a>
            <div className="text-foreground/45 ml-auto text-xs">
              {task.resultBytes
                ? `${(task.resultBytes / 1024).toFixed(1)} KB`
                : ''}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="mt-6">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
              {error || task?.errorMessage || m['ppt.error.generic']()}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="brand-gradient inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-white"
              >
                <ArrowLeft className="size-3.5" />
                {m['ppt.step3.retry']()}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="border-foreground/15 hover:border-foreground/30 hover:bg-foreground/5 inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition-colors"
              >
                Start over
              </button>
            </div>
          </div>
        )}
      </div>

      {isRunning && (
        <p className="text-foreground/45 mt-3 text-center text-[11px]">
          You can leave this page — the deck will be ready when you come back.
        </p>
      )}
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const labels = [
    m['ppt.step1.title'](),
    m['ppt.step2.title'](),
    m['ppt.step3.title'](),
  ];
  return (
    <div className="flex items-center gap-2 text-xs">
      {labels.map((label, idx) => {
        const n = (idx + 1) as Step;
        const active = step === n;
        const done = step > n;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-6 items-center justify-center rounded-full font-mono text-[10px]',
                active
                  ? 'brand-gradient text-white shadow-sm'
                  : done
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-foreground/5 text-foreground/40'
              )}
            >
              {done ? <Check className="size-3" /> : n}
            </div>
            <span
              className={cn(
                'hidden sm:inline',
                active ? 'text-foreground font-medium' : 'text-foreground/45'
              )}
            >
              {label.split('—')[1]?.trim() || label}
            </span>
            {idx < 2 && (
              <div
                className={cn(
                  'h-px w-6',
                  step > n ? 'bg-emerald-500/40' : 'bg-foreground/10'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const Route = createFileRoute('/ppt')({
  component: PptPage,
});

// Re-export so the FileText import isn't dropped (used in some code paths).
void FileText;
