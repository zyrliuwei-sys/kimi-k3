import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowUp,
  ArrowUpRight,
  Lock,
  RotateCcw,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';
import { buttonVariants } from '@/components/ui/button';

/**
 * Hero chat dialog. Calls the public, rate-limited Kimi K3 endpoint
 * `POST /api/playground/chat` and renders the freemium gate the backend returns:
 *  - anonymous visitor: 1 free message, then a sign-up wall;
 *  - signed-in user: each message costs 1 credit, then a paywall.
 * The conversation is stateless (not persisted) — reload resets the thread.
 *
 * Layout: a wide horizontal composer bar is the centerpiece. The conversation
 * thread (or, when empty, a greeting + example chips) sits above the bar.
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type ChatStatus = 'ok' | 'login_required' | 'payment_required' | 'unconfigured';

interface ChatReply {
  status: ChatStatus;
  reply: string | null;
  model?: string;
  provider?: string;
  configured?: boolean;
}

const MAX_INPUT = 1000;

export function HeroChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [gate, setGate] = useState<'login' | 'pay' | null>(null);
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
  const busy = send.isPending;

  // Keep the latest message / gate card in view as the thread grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, busy, gate]);

  function growTextarea() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function rollback(text: string) {
    setMessages((prev) =>
      prev.length && prev[prev.length - 1].content === text
        ? prev.slice(0, -1)
        : prev
    );
  }

  async function submit(content: string) {
    const text = content.trim();
    if (!text || busy || gate) return;

    const history: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.style.height = 'auto';
    });

    try {
      const data = await send.mutateAsync(history);
      if (data.status === 'login_required') {
        rollback(text);
        setGate('login');
        return;
      }
      if (data.status === 'payment_required') {
        rollback(text);
        setGate('pay');
        return;
      }
      // 'ok' or 'unconfigured' — append the reply (unconfigured carries setup guidance).
      setGate(null);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply ?? '' },
      ]);
    } catch (error) {
      rollback(text);
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
    setGate(null);
  }

  return (
    <div className="relative">
      {/* Thread — only rendered once the conversation starts. Empty state lives
          above the bar instead, so the bar is the centerpiece on first load. */}
      {!empty || gate ? (
        <div
          ref={scrollRef}
          className="mb-4 max-h-[min(48vh,360px)] overflow-y-auto pr-1"
        >
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <Bubble key={i} message={msg} />
            ))}
            {busy && <Thinking />}
            {gate && <GateCard kind={gate} />}
          </div>
        </div>
      ) : (
        <EmptyState
          examples={examples}
          disabled={busy}
          onPick={(prompt) => submit(prompt)}
        />
      )}

      {/* The wide horizontal composer bar */}
      <div className="bg-card border-foreground/10 focus-within:border-foreground/20 relative flex flex-col gap-2.5 rounded-[1.5rem] border p-2.5 pl-5 shadow-[0_24px_70px_-34px_rgba(13,11,8,0.5)] backdrop-blur-xl transition-colors focus-within:ring-4 focus-within:ring-[#7c3aed]/[0.08]">
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
          className="placeholder:text-foreground/40 max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none"
        />

        {/* Bar footer: identity + reset on the left, send on the right */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-muted/60 border-foreground/10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
              <Sparkles className="size-3 text-[#7c3aed]" />
              {m['landing.hero_chat.badge']()}
            </span>
            {(!empty || gate) && (
              <button
                type="button"
                onClick={reset}
                className="text-foreground/45 hover:text-foreground inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors"
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">
                  {m['landing.hero_chat.reset']()}
                </span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => submit(input)}
            disabled={!input.trim() || busy || !!gate}
            aria-label="Send"
            className="brand-gradient flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_8px_24px_-8px_rgba(124,58,237,0.6)] transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>

      <p className="text-foreground/40 mt-3 text-center text-[11px]">
        {m['landing.hero_chat.disclaimer']()}
      </p>
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

function GateCard({ kind }: { kind: 'login' | 'pay' }) {
  const isLogin = kind === 'login';
  const href = isLogin ? '/sign-up' : '/pricing';
  return (
    <div className="bg-muted/40 border-foreground/10 rounded-2xl border p-5 text-center">
      <div className="brand-gradient mx-auto mb-3 flex size-11 items-center justify-center rounded-xl">
        {isLogin ? (
          <UserPlus className="size-5 text-white" />
        ) : (
          <Lock className="size-5 text-white" />
        )}
      </div>
      <p className="text-sm font-semibold tracking-tight">
        {isLogin
          ? m['landing.hero_chat.gate_login_title']()
          : m['landing.hero_chat.gate_pay_title']()}
      </p>
      <p className="text-foreground/55 mx-auto mt-1 max-w-sm text-[13px] leading-relaxed">
        {isLogin
          ? m['landing.hero_chat.gate_login_desc']()
          : m['landing.hero_chat.gate_pay_desc']()}
      </p>
      <Link
        href={href}
        className={cn(
          buttonVariants(),
          'mt-4 h-9 gap-1.5 rounded-lg px-4 text-sm'
        )}
      >
        {isLogin
          ? m['landing.hero_chat.gate_login_btn']()
          : m['landing.hero_chat.gate_pay_btn']()}
        <ArrowUpRight className="size-4" />
      </Link>
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
    <div className="mb-6 flex flex-col items-center px-2 text-center">
      <div className="brand-gradient mb-3 flex size-11 items-center justify-center rounded-2xl shadow-[0_12px_30px_-10px_rgba(124,58,237,0.55)]">
        <Sparkles className="size-5 text-white" />
      </div>
      <h3 className="text-base font-semibold tracking-tight">
        {m['landing.hero_chat.greeting']()}
      </h3>
      <p className="text-foreground/55 mt-1 max-w-sm text-[13px] leading-relaxed">
        {m['landing.hero_chat.greeting_sub']()}
      </p>
      {examples.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={disabled}
              onClick={() => onPick(ex)}
              className="border-foreground/10 bg-background hover:border-foreground/25 hover:bg-muted/40 text-foreground/75 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
