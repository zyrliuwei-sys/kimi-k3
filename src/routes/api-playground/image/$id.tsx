import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';

import { useRouter } from '@/core/i18n/navigation';
import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';

/**
 * `/api-playground/image/$id` — dedicated preview page for a single
 * generated image. Reached by clicking a tile in the My Images grid.
 *
 * The page re-fetches the task by id (cheap, no auth dance because the
 * same cookies work) so the URL is shareable — if you copy the link
 * and send it to another browser session, it'll just 404 cleanly.
 *
 * Layout: image left, prompt + download on the right. Mobile stacks.
 */
export const Route = createFileRoute('/api-playground/image/$id')({
  component: ImagePreviewPage,
});

function ImagePreviewPage() {
  const { id } = Route.useParams();
  const query = useQuery({
    queryKey: ['image-task-preview', id],
    queryFn: () => apiGet<{ task: any }>(`/api/ai-tasks/${id}`),
    enabled: !!id,
    // This endpoint is the existing provider-polling path. Keeping the poll
    // on this page means handing off from the composer never abandons an
    // async generation midway through its lifecycle.
    refetchInterval: (query) => {
      const status = query.state.data?.task?.status;
      return status === 'success' || status === 'failed' ? false : 1500;
    },
    refetchIntervalInBackground: true,
  });

  const t = query.data?.task;
  // Multi-image tasks return several URLs; for n=1 this is a single
  // entry. We render all of them in a column, with the first one as
  // the "primary" download target.
  const urls: string[] =
    t?.taskResult?.imageUrls ??
    (t?.taskResult?.imageUrl ? [t.taskResult.imageUrl] : []) ??
    [];
  const fallbackUrls: string[] =
    t?.taskResult?.imageFallbackUrls ?? t?.imageFallbackUrls ?? [];
  const prompt: string = t?.prompt ?? '';
  const model: string = t?.model ?? '';
  const status: string = t?.status ?? 'processing';
  const isGenerating =
    !query.isError &&
    status !== 'success' &&
    status !== 'failed' &&
    status !== 'canceled';
  const failureMessage =
    t?.taskResult?.error?.message ??
    t?.taskResult?.errorMessage ??
    m['playground.image.failed_unknown']();
  const downloadUrl = `/api/ai-tasks/${encodeURIComponent(id)}/image?download=1`;

  // ESC returns to the My Images grid (the page the user came from).
  // Matches the "Back to grid" link in the top bar — used the same way
  // a modal would dismiss. Not active when the user is typing in a
  // form field, but there are no inputs on this page.
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <div className="bg-background min-h-svh">
      {/* Top bar: back link + status. Stays visible so the user can
          return to the grid even if the image hasn't loaded. */}
      <div className="border-border bg-card/40 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 backdrop-blur">
        <Link
          to="/api-playground/image"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          {m['playground.image.preview_back']()}
        </Link>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          {isGenerating ? <Loader2 className="size-3 animate-spin" /> : null}
          {status === 'success' ? (
            <Check className="size-3 text-emerald-500" />
          ) : null}
          {isGenerating
            ? m['playground.image.generating']()
            : model
              ? `${model}${urls.length > 1 ? ` · ${m['playground.image.preview_count']({ count: urls.length })}` : ''}`
              : ''}
        </span>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        {/* Image column — single image on mobile, stack of n images
            on desktop when the task was a multi-image generation. */}
        <div className="bg-foreground/5 flex-1 overflow-hidden rounded-2xl">
          {query.isLoading || isGenerating ? (
            <div className="relative flex h-[min(68svh,46rem)] min-h-96 items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,hsl(var(--primary)/0.14),transparent_42%)]" />
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative flex max-w-sm flex-col items-center px-6 text-center"
              >
                <div className="bg-background/80 border-border flex size-16 items-center justify-center rounded-2xl border shadow-xl backdrop-blur">
                  <Sparkles className="text-primary size-7 animate-pulse" />
                </div>
                <h1 className="mt-5 text-xl font-semibold tracking-tight">
                  {m['playground.image.generating']()}
                </h1>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {prompt || m['playground.image.preview_unavailable']()}
                </p>
                <div className="bg-border mt-6 h-1.5 w-44 overflow-hidden rounded-full">
                  <motion.div
                    animate={{ x: ['-65%', '155%'] }}
                    transition={{
                      duration: 1.45,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="bg-primary h-full w-2/3 rounded-full"
                  />
                </div>
              </motion.div>
            </div>
          ) : status === 'failed' || status === 'canceled' ? (
            <div className="flex h-96 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-base font-medium">
                {m['playground.image.failed_label']()}
              </p>
              <p className="text-muted-foreground max-w-sm text-sm leading-6">
                {failureMessage}
              </p>
              <Link
                to="/api-playground/image"
                className="border-border hover:bg-muted mt-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              >
                {m['playground.image.preview_back']()}
              </Link>
            </div>
          ) : query.isError || urls.length === 0 ? (
            <div className="flex h-96 flex-col items-center justify-center gap-2 text-center">
              <p className="text-muted-foreground text-sm">
                {m['playground.image.preview_unavailable']()}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => query.refetch()}
              >
                {m['common.error.retry']()}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-4">
              {urls.map((u, i) => (
                <a
                  key={u}
                  href={fallbackUrls[i] || u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-background block w-full overflow-hidden rounded-xl"
                  title={m['playground.image.open_in_new_tab']()}
                >
                  <ImageWithFallback
                    src={u}
                    fallbackSrc={fallbackUrls[i]}
                    alt={prompt || `Generated image ${i + 1}`}
                    className="mx-auto max-h-[80vh] w-auto object-contain"
                  />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: prompt + download. The download button is the
            primary action — a wide button, gradient, with an icon. */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="border-border bg-card sticky top-20 rounded-2xl border p-5">
            <h1 className="text-foreground text-base font-semibold">
              {m['playground.image.preview_title']()}
            </h1>
            {prompt ? (
              <div className="mt-3">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {m['playground.image.preview_prompt_label']()}
                </p>
                <p className="text-foreground mt-1.5 text-sm leading-relaxed">
                  {prompt}
                </p>
              </div>
            ) : null}

            {model ? (
              <div className="mt-4">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {m['playground.image.preview_model_label']()}
                </p>
                <p className="text-foreground mt-1.5 font-mono text-xs">
                  {model}
                </p>
              </div>
            ) : null}

            {urls.length > 0 ? (
              <a
                href={downloadUrl}
                className="brand-gradient mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition-all hover:opacity-95"
              >
                <ArrowDownToLine className="size-4" />
                {m['playground.image.download']()}
              </a>
            ) : null}

            {urls.length > 1 ? (
              <p className="text-muted-foreground mt-3 text-center text-xs">
                {m['playground.image.preview_more_note']({
                  count: urls.length - 1,
                })}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Keep the proxy URL private by default, but never blank a valid R2 image
 * solely because the authenticated proxy had a transient failure. */
function ImageWithFallback({
  src,
  fallbackSrc,
  alt,
  className,
}: {
  src: string;
  fallbackSrc?: string | null;
  alt: string;
  className?: string;
}) {
  const [activeSrc, setActiveSrc] = useState(src);

  useEffect(() => {
    setActiveSrc(src);
  }, [src, fallbackSrc]);

  return (
    <img
      src={activeSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (fallbackSrc && fallbackSrc !== activeSrc) {
          setActiveSrc(fallbackSrc);
        }
      }}
    />
  );
}
