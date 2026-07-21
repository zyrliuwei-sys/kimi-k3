import { useMemo, useState, type ReactNode } from 'react';
import { Code2, ExternalLink, Eye } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

/**
 * Renders a screenshot-clone reply as a live, sandboxed webpage instead of dead
 * code. The model returns the recreated site as an HTML document; we pull it out
 * of the message and frame it in an isolated iframe so the generated markup/scripts
 * run in an opaque origin that cannot touch the kimik3 app (no cookies, storage,
 * or parent-DOM access). Safer than the unsanitized `dangerouslySetInnerHTML`
 * used by the plain markdown renderer.
 */

/** Extract the largest HTML-looking fenced block, else the whole message when it
 * already is an HTML document. Returns null when there's no page to render. */
function extractHtml(content: string): string | null {
  const fences = Array.from(content.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g));
  let best = '';
  for (const match of fences) {
    const code = (match[1] || '').trim();
    if (code.length > best.length && /<\/[a-zA-Z][\w-]*\s*>/.test(code)) {
      best = code;
    }
  }
  if (best) return best;

  const trimmed = content.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/** Open the cloned HTML as a real, full-window page in a new tab. */
function openInNewTab(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  // Release the blob after the new tab has had time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ClonePreview({ content }: { content: string }) {
  const html = useMemo(() => extractHtml(content), [content]);
  const [mode, setMode] = useState<'preview' | 'code'>('preview');

  // Nothing page-shaped to render — degrade to plain markdown (no toggle).
  if (!html) return <MarkdownContent content={content} />;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5">
        <ToggleButton
          active={mode === 'preview'}
          onClick={() => setMode('preview')}
          icon={<Eye className="size-3.5" />}
          label={m['playground.clone.preview']()}
        />
        <ToggleButton
          active={mode === 'code'}
          onClick={() => setMode('code')}
          icon={<Code2 className="size-3.5" />}
          label={m['playground.clone.code']()}
        />
        <button
          type="button"
          onClick={() => openInNewTab(html)}
          className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[12px] transition-colors"
        >
          <ExternalLink className="size-3.5" />
          {m['playground.clone.open']()}
        </button>
      </div>

      {mode === 'preview' ? (
        <iframe
          srcDoc={html}
          // allow-scripts ONLY (no allow-same-origin) → generated content runs in
          // an opaque origin, isolated from the parent app. External https
          // images/fonts still load.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title="preview"
          className="border-foreground/10 h-[460px] w-full rounded-lg border bg-white"
        />
      ) : (
        <MarkdownContent content={content} />
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[12px] tracking-tight whitespace-nowrap transition-all duration-200 active:scale-[0.97]',
        active
          ? 'brand-gradient border-transparent text-white shadow-sm shadow-violet-500/25'
          : 'border-foreground/10 bg-card/60 text-foreground/60 hover:border-foreground/25 hover:bg-foreground/[0.04] hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
