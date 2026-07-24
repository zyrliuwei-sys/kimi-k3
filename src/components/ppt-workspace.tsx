'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Loader2, Plus, Sparkles, X } from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { ApiError, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';

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

const QUICK_PROMPTS = [0, 1, 2, 3, 4] as const;
const SLIDE_MIN = 5;
const SLIDE_MAX = 30;

const QUICK_PROMPT_BY_MIME: Record<string, number> = {
  'application/pdf': 0,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 3,
  'application/vnd.ms-excel': 3,
  'text/csv': 3,
};

/**
 * PPT one-click workspace.
 *
 *   1. Hero
 *   2. File dropzone (optional)
 *   3. Text prompt (the only required input)
 *   4. Quick-prompt chips
 *   5. Slide count slider
 *   6. Generate button
 *
 * The template is **not** shown to the user. The backend picks the best
 * template from the prompt via a small K3 classification call, then runs
 * the full generation against it. The user only sees the final .pptx and
 * can choose to regenerate (same prompt → backend may pick a different
 * style on the next run).
 */
export function PptWorkspace() {
  const { data: session, isPending } = useSession();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [prompt, setPrompt] = useState('');
  const [slideCount, setSlideCount] = useState(15);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [autoPickedPrompt, setAutoPickedPrompt] = useState(false);

  useEffect(() => {
    if (!task?.id) return;
    if (task.status === 'done' || task.status === 'failed') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const row = await apiGet<TaskRow>(`/api/ppt/status?id=${task.id}`);
        if (cancelled) return;
        setTask(row);
        if (row.status === 'done' || row.status === 'failed') return;
      } catch {
        return;
      }
      timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [task?.id, task?.status]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function resetForNewRun() {
    setTask(null);
    setError(null);
    setSubmitting(false);
  }

  function handleFilesPicked(list: File[]) {
    if (!list.length) return;
    if (!session?.user) return;
    if (!autoPickedPrompt) {
      const first = list[0];
      const idx = QUICK_PROMPT_BY_MIME[first.type] ?? 0;
      setPrompt(m[`ppt.workspace.prompts.${idx}` as const]());
      setAutoPickedPrompt(true);
    }
    setFiles((prev) => [
      ...prev,
      ...list.map<UploadedFile>((f) => ({
        id: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    ]);
  }

  async function handleGenerate() {
    if (submitting) return;
    if (!session?.user) return;
    if (!prompt.trim()) {
      setError('Tell us what you need in the prompt box first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setTask(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // No templateId sent — backend picks the best fit.
      const row = await apiPost<TaskRow>(
        '/api/ppt/generate',
        {
          title: prompt.trim().slice(0, 80) || 'Untitled presentation',
          topic: prompt.trim(),
          prompt: prompt.trim(),
          slideCount,
          sourceType: 'empty',
        },
        { signal: controller.signal }
      );
      setTask(row);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[ppt/workspace] generate failed:', e);
      let msg: string;
      if (e?.status === 402) {
        msg = "You've used all your free generations — upgrade to keep going.";
      } else if (e?.status === 503) {
        msg =
          'No AI provider is configured yet. Ask an admin to set evolink_api_key in Settings.';
      } else if (e instanceof ApiError) {
        msg = e.message;
      } else {
        msg = e?.message || 'Something went wrong.';
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setTask(null);
    setSubmitting(false);
  }

  function handleRetry() {
    resetForNewRun();
    void handleGenerate();
  }

  if (isPending) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="text-foreground/55 size-5 animate-spin" />
      </div>
    );
  }

  if (task?.status === 'done' && task.resultUrl) {
    return <DoneView task={task} onRetry={handleRetry} />;
  }

  const isGenerating =
    !!task &&
    (task.status === 'queued' ||
      task.status === 'outlining' ||
      task.status === 'writing' ||
      task.status === 'rendering');

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-medium tracking-tight md:text-3xl">
          {m['ppt.workspace.hero.heading']()}
        </h1>
        <p className="text-foreground/55 mx-auto mt-2 max-w-md text-sm">
          {m['ppt.workspace.hero.subheading']()}
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-[10px] font-bold">
            !
          </span>
          <div>
            <div className="font-medium">Generation failed</div>
            <div className="mt-0.5 text-xs">{error}</div>
          </div>
        </div>
      )}

      <FileDropzone
        files={files}
        dragOver={dragOver}
        setDragOver={setDragOver}
        onAdd={(list) => handleFilesPicked(list)}
        onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))}
        onOpenPicker={() => fileInputRef.current?.click()}
        inputRef={fileInputRef}
      />

      <Field label={m['ppt.workspace.prompt.label']()} required>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={m['ppt.workspace.prompt.placeholder']()}
          rows={3}
          className="bg-background border-foreground/15 placeholder:text-foreground/35 focus:border-foreground/30 w-full rounded-lg border p-3 text-sm leading-relaxed outline-none"
        />
      </Field>

      <div>
        <div className="text-foreground/45 mb-2 font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
          {m['ppt.workspace.prompts.title']()}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() =>
                setPrompt(m[`ppt.workspace.prompts.${i}` as const]())
              }
              className="border-foreground/10 bg-card hover:border-foreground/25 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] transition-colors"
            >
              <Sparkles className="text-foreground/40 size-3" />
              {m[`ppt.workspace.prompts.${i}` as const]()}
            </button>
          ))}
        </div>
      </div>

      <Field
        label={`${m['ppt.workspace.slides.label']()} · ${slideCount}`}
        help={m['ppt.workspace.slides.hint']()}
      >
        <input
          type="range"
          min={SLIDE_MIN}
          max={SLIDE_MAX}
          value={slideCount}
          onChange={(e) => setSlideCount(Number(e.target.value))}
          className="bg-foreground/10 accent-foreground/70 w-full"
        />
        <div className="text-foreground/35 mt-1 flex justify-between font-mono text-[10px]">
          <span>5</span>
          <span>15</span>
          <span>30</span>
        </div>
      </Field>

      <div className="flex items-center justify-end gap-2">
        {isGenerating && (
          <Button variant="ghost" onClick={handleCancel}>
            {m['ppt.workspace.cancel']()}
          </Button>
        )}
        <Button
          onClick={handleGenerate}
          disabled={submitting || isGenerating || !prompt.trim()}
          className="min-w-[200px]"
        >
          {submitting || isGenerating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {m['ppt.workspace.generate']()}
        </Button>
      </div>

      {task && task.status !== 'done' && (
        <ProgressPanel task={task} onCancel={handleCancel} />
      )}
    </div>
  );
}

// ── Local types ────────────────────────────────────────────────────────────

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

// ── Sub-views ──────────────────────────────────────────────────────────────

function FileDropzone({
  files,
  dragOver,
  setDragOver,
  onAdd,
  onRemove,
  onOpenPicker,
  inputRef,
}: {
  files: UploadedFile[];
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onOpenPicker: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain,text/markdown"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length) onAdd(list);
          e.target.value = '';
        }}
        className="hidden"
      />
      <div
        onClick={onOpenPicker}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const list = Array.from(e.dataTransfer.files ?? []);
          if (list.length) onAdd(list);
        }}
        className={cn(
          'group border-foreground/15 hover:border-foreground/30 cursor-pointer rounded-2xl border-2 border-dashed p-4 text-center transition-colors',
          dragOver && 'border-foreground/40 bg-foreground/[0.04]'
        )}
      >
        <div className="flex items-center justify-center gap-2">
          <div className="border-foreground/15 bg-card grid size-8 place-items-center rounded-lg">
            <Plus className="text-foreground/55 size-4" />
          </div>
          <div className="text-foreground/75 text-sm font-medium">
            {m['ppt.workspace.upload.label']()}
          </div>
        </div>
        <p className="text-foreground/45 mt-1.5 text-[11px]">
          {m['ppt.workspace.upload.hint']()}
        </p>
      </div>

      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="bg-card border-foreground/10 flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-1.5 text-xs"
            >
              <FileText className="text-foreground/55 size-3" />
              <span className="max-w-[12rem] truncate">{f.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f.id);
                }}
                className="text-foreground/45 hover:text-foreground -mr-0.5 rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

function ProgressPanel({
  task,
  onCancel,
}: {
  task: TaskRow;
  onCancel: () => void;
}) {
  const stepIdx: Record<TaskRow['status'], number> = {
    queued: 0,
    outlining: 1,
    writing: 2,
    rendering: 3,
    done: 3,
    failed: -1,
  };
  const failed = task.status === 'failed';
  const label = failed
    ? task.errorMessage || 'Generation failed'
    : m[`ppt.workspace.progress.${task.status}` as const]();

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        failed
          ? 'border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/40'
          : 'border-foreground/10 bg-card/60'
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-lg text-white',
            failed ? 'bg-red-500' : 'brand-gradient'
          )}
        >
          {failed ? (
            <X className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5 animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-foreground/55 mt-0.5 truncate text-[11px]">
            {task.title}
          </div>
        </div>
        <div className="text-foreground/55 font-mono text-xs tabular-nums">
          {task.progress}%
        </div>
      </div>

      {!failed && (
        <div className="mt-3 flex items-center gap-1">
          {[0, 1, 2, 3].map((i) => {
            const reached = i <= stepIdx[task.status];
            return (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  reached ? 'bg-foreground/60' : 'bg-foreground/10'
                )}
              />
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="text-foreground/45 text-[11px]">
          {failed
            ? m['ppt.workspace.retry']() + ' — or try a different prompt.'
            : 'You can keep working — the deck will be ready when you come back.'}
        </div>
        {!failed ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-foreground/55 hover:text-foreground text-[11px] underline-offset-2 hover:underline"
          >
            {m['ppt.workspace.cancel']()}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DoneView({ task, onRetry }: { task: TaskRow; onRetry: () => void }) {
  return (
    <div className="space-y-6">
      <div className="border-foreground/10 bg-card/40 rounded-2xl border p-5 text-center">
        <div className="brand-gradient mx-auto grid size-12 place-items-center rounded-2xl text-white">
          <Check className="size-6" />
        </div>
        <h2 className="mt-3 text-lg font-semibold">
          {m['ppt.workspace.done.title']()}
        </h2>
        <p className="text-foreground/55 mt-1 truncate text-sm">{task.title}</p>
        {task.resultBytes && (
          <p className="text-foreground/40 mt-0.5 text-[11px]">
            {(task.resultBytes / 1024).toFixed(1)} KB
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <a
            href={task.resultUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="brand-gradient inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white"
          >
            Download .pptx
          </a>
          <a
            href={task.resultUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="border-foreground/15 hover:border-foreground/30 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm"
          >
            Open in new tab
          </a>
          <Button variant="ghost" onClick={onRetry}>
            {m['ppt.workspace.retry']()}
          </Button>
        </div>

        <p className="text-foreground/45 mt-3 text-[11px]">
          Want a different look? Click <strong>Try again</strong> — we&rsquo;ll
          pick a different style each time.
        </p>
      </div>
    </div>
  );
}
