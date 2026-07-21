import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowUp, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

/**
 * Hero chat dialog. A stateless (non-persisted) conversation that calls the
 * public, rate-limited Kimi K3 endpoint `POST /api/playground/chat`. No auth,
 * no credits — mirrors the existing API playground so anonymous visitors can
 * try Kimi K3 right from the hero. Reload resets the thread.
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatReply {
  reply: string;
  model: string;
  provider: string;
  configured: boolean;
}

const MAX_INPUT = 1000;

export function HeroChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const send = useMutation({
    mutationFn: (history: Message[]) =>
      apiPost<ChatReply>('/api/playground/chat', {
        messages: history.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      }),
  });

  const examples: string[] = (m['landing.hero_chat.examples']() || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const empty = messages.length === 0;

  // Keep the latest message in view as the thread grows / a reply streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, send.isPending]);

  function growTextarea() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function submit(content: string) {
    const text = content.trim();
    if (!text || send.isPending) return;

    const history: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.style.height = 'auto';
    });

    try {
      const data = await send.mutateAsync(history);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply },
      ]);
    } catch (error) {
      // Roll back the optimistic user turn so they can edit & retry.
      setMessages((prev) =>
        prev.length && prev[prev.length - 1].content === text
          ? prev.slice(0, -1)
          : prev
      );
      toast.error(
        error instanceof Error ? error.message : 'Failed to get a reply'
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  function reset() {
    setMessages([]);
    setInput('');
  }

  return (
    <div className="bg-card border-foreground/10 relative overflow-hidden rounded-3xl border shadow-[0_24px_80px_-40px_rgba(13,11,8,0.45)]">
      {/* Header */}
      <div className="border-foreground/10 flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <span className="brand-gradient grid size-6 place-items-center rounded-lg">
            <Sparkles className="size-3.5 text-white" />
          </span>
          {m['landing.hero_chat.badge']()}
        </span>
        {!empty && (
          <button
            type="button"
            onClick={reset}
            className="text-foreground/50 hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors"
          >
            <RotateCcw className="size-3.5" />
            {m['landing.hero_chat.reset']()}
          </button>
        )}
      </div>

      {/* Thread */}
      <div
        ref={scrollRef}
        className="max-h-[min(60vh,440px)] min-h-[220px] overflow-y-auto px-4 py-5"
      >
        {empty ? (
          <EmptyState
            examples={examples}
            disabled={send.isPending}
            onPick={(prompt) => submit(prompt)}
          />
        ) : (
          <div className="space-y-5">
            {messages.map((msg, i) => (
              <Bubble key={i} message={msg} />
            ))}
            {send.isPending && <Thinking />}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-foreground/10 border-t p-3">
        <div className="border-foreground/10 focus-within:border-foreground/25 bg-muted/30 flex items-end gap-2 rounded-2xl border p-2 pl-4">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            maxLength={MAX_INPUT}
            placeholder={m['landing.hero.chat_placeholder']()}
            onChange={(e) => {
              setInput(e.target.value);
              growTextarea();
            }}
            onKeyDown={handleKeyDown}
            className="placeholder:text-foreground/40 max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none"
          />
          <button
            type="button"
            onClick={() => submit(input)}
            disabled={!input.trim() || send.isPending}
            aria-label="Send"
            className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <p className="text-foreground/35 mt-2 text-center text-[11px]">
          {m['landing.hero_chat.disclaimer']()}
        </p>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
          isUser ? 'bg-foreground text-background' : 'brand-gradient text-white'
        )}
      >
        {isUser ? (
          m['settings.chat.you_initial']()
        ) : (
          <Sparkles className="size-3.5" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'bg-foreground text-background rounded-tr-md'
            : 'bg-background text-foreground border-foreground/10 rounded-tl-md border shadow-sm'
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex gap-3">
      <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
        <Sparkles className="size-3.5 text-white" />
      </div>
      <div className="border-foreground/10 bg-background flex items-center gap-1.5 rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bg-foreground/40 size-2 animate-bounce rounded-full"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  examples,
  disabled,
  onPick,
}: {
  examples: string[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-2 py-6 text-center">
      <div className="brand-gradient mb-4 flex size-12 items-center justify-center rounded-2xl">
        <Sparkles className="size-6 text-white" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">
        {m['landing.hero_chat.greeting']()}
      </h3>
      <p className="text-foreground/55 mt-1.5 text-sm">
        {m['landing.hero_chat.greeting_sub']()}
      </p>
      {examples.length > 0 && (
        <div className="mt-5 grid w-full gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={disabled}
              onClick={() => onPick(ex)}
              className="border-foreground/10 bg-background hover:border-foreground/25 text-foreground/75 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
