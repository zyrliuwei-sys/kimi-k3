import { memo } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

/**
 * Chat bubble primitives shared by the persistent chat thread
 * (`settings/chat.tsx`) and the ephemeral side-by-side compare board
 * (`-compare-board.tsx`). Pure presentation — no fetching, no state.
 */

/**
 * Reasoning models (MiniMax, Kimi, R-series) stream their chain-of-thought
 * wrapped in `<think>…</think>` inside the content itself. MarkdownIt runs
 * with `html: false`, so the tags would print as literal text and the
 * reasoning would render at answer size — drowning the actual reply. Split it
 * off here so every chat surface can de-emphasize it instead.
 */
function splitReasoning(content: string): {
  reasoning: string;
  answer: string;
} {
  const parts: string[] = [];
  const closed = /<think[^>]*>([\s\S]*?)<\/think\s*>/gi;
  let answer = content.replace(closed, (_match: string, text: string) => {
    parts.push(text);
    return '';
  });
  // Unterminated block — reasoning still streaming in.
  const open = /<think[^>]*>([\s\S]*)$/i.exec(answer);
  if (open) {
    parts.push(open[1]);
    answer = answer.slice(0, open.index);
  }
  return { reasoning: parts.join('\n').trim(), answer: answer.trim() };
}

/** Collapsible, muted rendering of a model's chain-of-thought. */
function ReasoningBlock({
  reasoning,
  open = false,
}: {
  reasoning: string;
  open?: boolean;
}) {
  return (
    <details open={open} className="group mb-2">
      <summary className="text-foreground/40 hover:text-foreground/70 flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium transition-colors select-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        {m['settings.chat.reasoning_label']()}
      </summary>
      <div className="text-foreground/50 border-foreground/10 mt-1.5 mb-1 border-l-2 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap">
        {reasoning}
      </div>
    </details>
  );
}

/**
 * Assistant markdown: any `<think>` reasoning becomes a collapsed-by-default
 * block (expanded live while the model is still thinking), then the answer
 * itself — so replies with and without a reasoning stage read at the same
 * size.
 */
export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const { reasoning, answer } = splitReasoning(content);
  if (!reasoning && !answer) {
    return streaming ? <ThinkingDots /> : null;
  }
  return (
    <>
      {reasoning && (
        <ReasoningBlock reasoning={reasoning} open={streaming && !answer} />
      )}
      {answer && (
        <>
          <MarkdownContent content={answer} />
          {streaming && <StreamingCursor />}
        </>
      )}
    </>
  );
});

/** Memoized so a streaming sibling updating 25×/s never re-renders finished bubbles. */
export const MessageBubble = memo(function MessageBubble({
  message,
  streaming,
  compact = false,
}: {
  message: { id: string; role: 'user' | 'assistant'; content: string };
  streaming?: boolean;
  /** Tighter layout for the compare columns (narrow width, denser stack). */
  compact?: boolean;
}) {
  const isUser = message.role === 'user';
  const empty = !message.content;
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Compare columns (compact) skip the avatars — narrow columns read
          cleaner with just the bubbles. */}
      {!compact && (
        <div
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
            isUser
              ? 'bg-foreground text-background'
              : 'brand-gradient text-white'
          )}
        >
          {isUser ? (
            m['settings.chat.you_initial']()
          ) : (
            <Sparkles className="size-3.5" />
          )}
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'bg-muted text-foreground rounded-tr-md'
            : 'bg-card text-foreground border-foreground/10 rounded-tl-md border shadow-sm',
          compact && 'max-w-[95%] px-3 py-2 text-sm'
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : empty ? (
          <ThinkingDots />
        ) : (
          <ChatMarkdown content={message.content} streaming={streaming} />
        )}
      </div>
    </div>
  );
});

export function ThinkingDots() {
  return (
    <span className="flex items-center gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-foreground/40 size-2 animate-bounce rounded-full"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export function StreamingCursor() {
  return (
    <span className="bg-foreground/60 ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse rounded-full align-middle" />
  );
}
