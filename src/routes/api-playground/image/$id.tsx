import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowDownToLine, ArrowLeft, Loader2 } from 'lucide-react';

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
  });

  const t = query.data?.task;
  // Multi-image tasks return several URLs; for n=1 this is a single
  // entry. We render all of them in a column, with the first one as
  // the "primary" download target.
  const urls: string[] =
    t?.taskResult?.imageUrls ??
    (t?.taskResult?.imageUrl ? [t.taskResult.imageUrl] : []) ??
    [];
  const prompt: string = t?.prompt ?? '';
  const model: string = t?.model ?? '';

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
        <span className="text-muted-foreground text-xs">
          {model ? `${model} · ` : ''}
          {urls.length > 1
            ? m['playground.image.preview_count']({ count: urls.length })
            : ''}
        </span>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        {/* Image column — single image on mobile, stack of n images
            on desktop when the task was a multi-image generation. */}
        <div className="bg-foreground/5 flex-1 overflow-hidden rounded-2xl">
          {query.isLoading ? (
            <div className="flex h-96 items-center justify-center">
              <Loader2 className="text-muted-foreground size-8 animate-spin" />
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
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-background block w-full overflow-hidden rounded-xl"
                  title={m['playground.image.open_in_new_tab']()}
                >
                  <img
                    src={u}
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
                href={urls[0]}
                download
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
