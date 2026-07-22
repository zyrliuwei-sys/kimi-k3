'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

/**
 * Web & Motion — video → video AI replicate.
 *
 * A signed-in user uploads a short source video, clicks 复刻, and polls
 * /api/ai-tasks until the replicated video is ready. Reads i18n directly
 * (it's a block, not a component), so all copy lives in messages/*.json.
 */

const MAX_BYTES = 100 * 1024 * 1024; // 100MB
const POLL_MS = 3000;
const MAX_POLLS = 120; // ~6 min before the client gives up (task keeps running)

type TaskStatus = 'pending' | 'processing' | 'success' | 'failed' | 'canceled';
const TERMINAL: ReadonlyArray<TaskStatus> = ['success', 'failed', 'canceled'];
const isTerminal = (s?: string): boolean =>
  !!s && TERMINAL.includes(s as TaskStatus);

interface TaskState {
  id: string;
  status: TaskStatus;
  videoUrl?: string;
}

/** Upload a video via the existing media upload route → returns its URL. */
async function uploadVideoFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('files', file);
  const res = await fetch('/api/storage/upload-media', {
    method: 'POST',
    body: formData,
  });
  const result = await res.json().catch(() => ({}));
  if (result?.code !== 0 || !result?.data?.results?.length) {
    throw new Error(result?.message || 'Upload failed');
  }
  const r = result.data.results[0];
  if (r.type !== 'video') throw new Error('Please choose a video file');
  return r.url as string;
}

export function WebMotion() {
  const [videoUrl, setVideoUrl] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollCount = useRef(0);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!file.type.startsWith('video/') || file.size > MAX_BYTES) {
      setUploadError(m['web_motion.err_upload']());
      return;
    }
    setUploading(true);
    try {
      const url = await uploadVideoFile(file);
      setVideoUrl(url);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch (e: unknown) {
      setUploadError(
        e instanceof Error ? e.message : m['web_motion.err_upload']()
      );
    } finally {
      setUploading(false);
    }
  }, []);

  const startMutation = useMutation({
    mutationFn: (url: string) =>
      apiPost<{ taskId: string; status: string; videoUrl?: string }>(
        '/api/ai-tasks',
        {
          videoUrl: url,
        }
      ),
    onSuccess: (data) => {
      pollCount.current = 0;
      setTask({
        id: data.taskId,
        status: (data.status as TaskStatus) || 'processing',
        videoUrl: data.videoUrl,
      });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : '';
      if (/insufficient credits/i.test(msg)) {
        toast.error(m['web_motion.err_insufficient']());
      } else if (/not configured/i.test(msg)) {
        toast.error(m['web_motion.err_not_configured']());
      } else {
        toast.error(msg || m['web_motion.err_start']());
      }
    },
  });

  // Poll until terminal (or the attempt cap). Transient provider errors are
  // swallowed so a single blip doesn't abort the loop.
  const pollQuery = useQuery({
    queryKey: ['ai-task', task?.id],
    queryFn: async () => {
      pollCount.current += 1;
      try {
        return await apiGet<{ status: string; videoUrl?: string }>(
          `/api/ai-tasks/${task?.id}`
        );
      } catch {
        return { status: 'processing' };
      }
    },
    enabled: !!task?.id && !isTerminal(task?.status),
    refetchInterval: () => (pollCount.current >= MAX_POLLS ? false : POLL_MS),
  });

  // Fold poll results back into task state; polling auto-disables once terminal.
  useEffect(() => {
    const d = pollQuery.data;
    if (!d) return;
    setTask((t) => {
      if (!t) return t;
      const nextStatus = (d.status as TaskStatus) || t.status;
      if (
        nextStatus === t.status &&
        (d.videoUrl ?? t.videoUrl) === t.videoUrl
      ) {
        return t;
      }
      return { ...t, status: nextStatus, videoUrl: d.videoUrl ?? t.videoUrl };
    });
  }, [pollQuery.data]);

  useEffect(() => {
    if (task?.status === 'failed') toast.error(m['web_motion.err_failed']());
  }, [task?.status]);

  function reset() {
    setTask(null);
    setVideoUrl('');
    setUploadError('');
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    pollCount.current = 0;
  }

  const status = task?.status;
  const busy = uploading || startMutation.isPending || status === 'processing';
  const succeeded = status === 'success' && !!task?.videoUrl;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <div className="mb-8 text-center">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          {m['web_motion.title']()}
        </h1>
        <p className="text-muted-foreground mt-3 text-base">
          {m['web_motion.subtitle']()}
        </p>
      </div>

      <div className="bg-card border-foreground/10 rounded-2xl border p-4 shadow-sm sm:p-6">
        {succeeded ? (
          <ResultView videoUrl={task!.videoUrl!} onReset={reset} />
        ) : (
          <>
            {/* source upload / preview */}
            {preview ? (
              <div className="bg-muted/30 border-foreground/10 relative overflow-hidden rounded-xl border">
                <video
                  src={preview}
                  className="aspect-video w-full object-contain"
                  controls
                />
                {!busy && (
                  <button
                    type="button"
                    onClick={reset}
                    className="bg-background/85 absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur"
                  >
                    <X className="size-3.5" />
                    {m['web_motion.again']()}
                  </button>
                )}
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  'flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
                  dragging
                    ? 'border-[#7c3aed] bg-[#7c3aed]/5'
                    : 'border-foreground/20 bg-muted/30 hover:border-foreground/35'
                )}
              >
                {uploading ? (
                  <Loader2 className="text-foreground/60 size-7 animate-spin" />
                ) : (
                  <span className="brand-gradient grid size-12 place-items-center rounded-2xl">
                    <Upload className="size-5 text-white" />
                  </span>
                )}
                <p className="text-foreground/90 text-base font-semibold">
                  {m['web_motion.upload_title']()}
                </p>
                <p className="text-muted-foreground text-sm">
                  {m['web_motion.upload_drop']()}
                </p>
                <p className="text-muted-foreground/70 text-xs">
                  {m['web_motion.upload_hint']()}
                </p>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />

            {uploadError && (
              <p className="mt-3 text-center text-sm text-amber-600 dark:text-amber-400">
                {uploadError}
              </p>
            )}

            {/* action */}
            <div className="mt-5">
              {status === 'processing' ? (
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <Loader2 className="size-6 animate-spin text-[#7c3aed]" />
                  <p className="text-foreground/90 text-sm font-medium">
                    {m['web_motion.replicating']()}
                  </p>
                  <p className="text-muted-foreground max-w-sm text-xs">
                    {m['web_motion.processing_hint']()}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!videoUrl || busy}
                  onClick={() => startMutation.mutate(videoUrl)}
                  className="brand-gradient inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="size-4" />
                  {m['web_motion.replicate']()}
                </button>
              )}
              <p className="text-muted-foreground/70 mt-3 text-center text-xs">
                {m['web_motion.cost_note']()}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultView({
  videoUrl,
  onReset,
}: {
  videoUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/30 border-foreground/10 overflow-hidden rounded-xl border">
        <video
          src={videoUrl}
          className="aspect-video w-full object-contain"
          controls
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={videoUrl}
          download
          className="brand-gradient inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white"
        >
          <Download className="size-4" />
          {m['web_motion.download']()}
        </a>
        <button
          type="button"
          onClick={onReset}
          className="border-foreground/15 hover:bg-accent inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-6 text-[15px] font-semibold"
        >
          {m['web_motion.again']()}
        </button>
      </div>
    </div>
  );
}
