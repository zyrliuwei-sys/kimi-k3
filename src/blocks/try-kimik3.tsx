import { useState } from 'react';
import { ArrowUp, Loader2, Sparkles } from 'lucide-react';

import { ApiError, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

export function TryKimik3() {
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const content = prompt.trim();
    if (!content) {
      setError(m['landing.try.empty_error']());
      return;
    }
    if (loading) return;
    setLoading(true);
    setError(null);
    setReply(null);
    try {
      const data = await apiPost<{ reply: string; configured: boolean }>(
        '/api/playground/chat',
        { messages: [{ role: 'user', content }] }
      );
      setReply(data.reply);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : 'Request failed';
      const isRate = /rate|limit|interval|frequent|slow|too many|seconds/i.test(
        msg
      );
      setError(isRate ? m['landing.try.rate_error']() : `⚠️ ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <section className="relative px-4 py-20 sm:py-24">
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-24 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
      />
      <div className="relative mx-auto max-w-3xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="border-foreground/10 bg-card/70 text-foreground/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-[#7c3aed]" />
            {m['landing.try.eyebrow']()}
          </span>
          <h2 className="mt-6 text-[clamp(1.9rem,4vw,2.75rem)] font-medium tracking-[-0.02em]">
            {m['landing.try.title']()}
          </h2>
          <p className="text-foreground/60 mt-4 text-[15px] leading-relaxed">
            {m['landing.try.subtitle']()}
          </p>
        </div>

        <div className="bg-card border-foreground/10 focus-within:border-foreground/20 mt-8 rounded-[1.5rem] border p-3 shadow-sm transition-all focus-within:shadow-[0_8px_40px_-12px_rgba(124,58,237,0.25)]">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder={m['landing.try.placeholder']()}
            className="placeholder:text-foreground/40 block min-h-[4.5rem] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none"
          />
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span className="text-foreground/35 hidden text-xs sm:block">
              ↵ {m['landing.try.button']()} · ⇧↵ newline
            </span>
            <button
              type="button"
              onClick={send}
              disabled={loading}
              className="brand-gradient ml-auto inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
              {m['landing.try.button']()}
            </button>
          </div>
        </div>

        {(loading || reply || error) && (
          <div className="mt-4">
            {loading && (
              <div className="bg-card border-foreground/10 text-foreground/60 flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-sm">
                <Sparkles className="size-4 text-[#7c3aed]" />
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="bg-foreground/40 size-1.5 animate-bounce rounded-full"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </span>
              </div>
            )}

            {reply && !loading && (
              <div className="bg-card border-foreground/10 rounded-2xl border px-5 py-4 shadow-sm">
                <div className="text-foreground/45 mb-2 flex items-center gap-2 text-xs font-medium">
                  <span className="brand-gradient grid size-5 place-items-center rounded-md">
                    <Sparkles className="size-3 text-white" />
                  </span>
                  kimik3
                </div>
                <div className="text-foreground/85 text-[15px] leading-relaxed">
                  <MarkdownContent content={reply} />
                </div>
              </div>
            )}

            {error && !loading && (
              <div
                className={cn(
                  'text-foreground/75 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-sm'
                )}
              >
                {error}
              </div>
            )}
          </div>
        )}

        <p className="text-foreground/35 mt-4 text-center text-xs">
          {m['landing.try.hint']()}
        </p>
      </div>
    </section>
  );
}
