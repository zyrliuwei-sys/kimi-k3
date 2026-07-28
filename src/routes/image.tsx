import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, ImageIcon, Loader2, Sparkles } from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { getLocale } from '@/paraglide/runtime.js';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';

/**
 * /image — standalone image generation page (图片生成器 / Image Generator).
 *
 * Self-contained: doesn't share state with the chat playground. Uses
 * the same `/api/playground/generate-image` endpoint (sync wait, up
 * to 3 min) but the page is its own route so a broken image-gen
 * integration can't take the chat UI down.
 *
 * Flow:
 *   1. User types prompt + hits Generate
 *   2. POST /api/playground/generate-image (sync, up to 3 min)
 *   3. On success → render <img src={url} /> with a "Download" button
 *   4. On error / 504 / 401 / 400 → show toast + inline error message
 */

export const Route = createFileRoute('/image')({
  head: () => {
    const isZh = getLocale() === 'zh';
    return {
      meta: [
        { title: isZh ? '图片生成器 · kimik3' : 'Image Generator · kimik3' },
        {
          name: 'description',
          content: isZh
            ? '用文字描述生成图片，由 Evolink gpt-image-2 驱动。'
            : 'Generate an image from a text prompt, powered by Evolink gpt-image-2.',
        },
      ],
    };
  },
  component: ImagePage,
});

function ImagePage() {
  const { data: session, isPending } = useSession();
  // Labels follow the active locale — the page is reachable from the
  // playground's "Generate Image" entry, so it should speak the user's
  // language the moment they land here.
  const isZh = getLocale() === 'zh';
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; prompt: string } | null>(
    null
  );

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/playground/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Match the server's 3-min budget plus a little network slack.
        signal: AbortSignal.timeout(300_000),
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.code !== 0) {
        throw new Error(data?.message || `Request failed (${res.status})`);
      }
      const url: string | undefined = data?.data?.url;
      if (typeof url !== 'string' || !url) {
        throw new Error(
          isZh ? '服务商未返回图片地址' : 'Provider returned no image url'
        );
      }
      setResult({ url, prompt: trimmed });
    } catch (e: any) {
      if (
        e?.name === 'AbortError' ||
        /aborted|timeout/i.test(e?.message || '')
      ) {
        setError(
          isZh
            ? '图片生成已取消，或在 5 分钟后超时。'
            : 'Image generation was cancelled or timed out after 5 minutes.'
        );
      } else {
        const base = isZh ? '图片生成失败' : 'Image generation failed.';
        setError(e?.message ? `${base} ${e.message}` : base);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `${result.prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_') || 'image'}.png`;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
          <div className="mb-8 text-center">
            <div className="bg-foreground/5 mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
              <Sparkles className="text-foreground/70 size-6" />
            </div>
            <h1 className="mb-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {isZh ? '图片生成器' : 'Image Generator'}
            </h1>
            <p className="text-foreground/60 text-sm sm:text-base">
              {isZh
                ? '由 Evolink 驱动 · 模型：'
                : 'Powered by Evolink · model: '}
              <code className="bg-foreground/5 rounded px-1.5 py-0.5 font-mono text-xs">
                gpt-image-2
              </code>
            </p>
          </div>

          {/* Sign-in gate — image gen costs the provider real money. */}
          {isPending ? (
            <div className="text-foreground/50 flex items-center justify-center gap-2 py-12 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {isZh ? '加载中…' : 'Loading…'}
            </div>
          ) : !session?.user ? (
            <div className="border-foreground/10 bg-card rounded-2xl border p-8 text-center">
              <p className="text-foreground/70 mb-4 text-sm">
                {isZh
                  ? '登录后即可生成图片，每次请求消耗积分。'
                  : 'Sign in to generate images. Each request costs credits.'}
              </p>
              <Link
                href="/sign-in?callbackUrl=/image"
                className="brand-gradient inline-flex h-10 items-center justify-center rounded-xl px-6 text-sm font-semibold text-white shadow-sm"
              >
                {isZh ? '登录' : 'Sign in'}
              </Link>
            </div>
          ) : (
            <>
              {/* Prompt + generate */}
              <div className="border-foreground/10 bg-card overflow-hidden rounded-2xl border">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    isZh
                      ? '描述你想要的图片…（例如：一只可爱的小狗）'
                      : 'Describe the image you want… (e.g. a small cute dog)'
                  }
                  rows={3}
                  maxLength={2000}
                  disabled={isGenerating}
                  className="placeholder:text-foreground/35 text-foreground w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-relaxed outline-none disabled:opacity-50"
                />
                <div className="border-foreground/10 flex items-center justify-between border-t px-4 py-2">
                  <span className="text-foreground/40 text-xs">
                    {prompt.length} / 2000
                  </span>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!prompt.trim() || isGenerating}
                    className="brand-gradient inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        {isZh ? '生成中…' : 'Generating…'}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5" />
                        {isZh ? '生成' : 'Generate'}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Status hint while generating. */}
              {isGenerating && (
                <div className="text-foreground/60 mt-6 flex items-center justify-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  {isZh
                    ? '生成中 — 通常需要 1–3 分钟…'
                    : 'Generating — typically 1–3 minutes…'}
                </div>
              )}

              {/* Error. */}
              {error && !isGenerating && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive mt-6 flex items-start gap-2 rounded-xl border p-4 text-sm">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">
                      {isZh ? '生成失败' : 'Generation failed'}
                    </div>
                    <div className="text-destructive/80 mt-0.5 text-xs">
                      {error}
                    </div>
                  </div>
                </div>
              )}

              {/* Result. */}
              {result && !isGenerating && (
                <div className="mt-6">
                  <div className="border-foreground/10 bg-card overflow-hidden rounded-2xl border">
                    <img
                      src={result.url}
                      alt={result.prompt}
                      className="w-full rounded-t-2xl object-contain"
                    />
                    <div className="border-foreground/10 flex items-center justify-between gap-2 border-t px-4 py-3">
                      <div className="text-foreground/60 min-w-0 flex-1 truncate text-sm">
                        {result.prompt}
                      </div>
                      <button
                        type="button"
                        onClick={handleDownload}
                        className="border-foreground/15 hover:bg-foreground/5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium"
                      >
                        <ImageIcon className="size-3.5" />
                        {isZh ? '下载' : 'Download'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
