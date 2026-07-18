import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { MarkdownContent } from '@/components/markdown-content';

/* ------------------------------------------------------------------ */
/*  Types & config                                                     */
/* ------------------------------------------------------------------ */

type Effort = 'extreme' | 'standard';

interface ModelOption {
  id: string;
  name: string;
  effort?: Effort;
  effortLabel: string;
  desc: string;
  badge?: string;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function ApiPlayground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const [modelId, setModelId] = useState('k3-extreme');

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);

  const models = useModels();

  const selected = models.find((mo) => mo.id === modelId) ?? models[0];

  // Auto-grow the textarea to fit its content (capped).
  function syncTextareaHeight() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  useEffect(() => {
    syncTextareaHeight();
  }, [input]);

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isThinking]);

  async function handleSend() {
    const content = input.trim();
    if (!content || isThinking) return;

    const userMsg: Message = {
      id: ++idRef.current,
      role: 'user',
      content,
    };
    // Build the full turn list from the current thread + the new message, so
    // the model gets real multi-turn context.
    const turns = [...messages, userMsg];
    setMessages(turns);
    setInput('');
    setIsThinking(true);

    try {
      const data = await apiPost<{
        reply: string;
        model: string;
        configured: boolean;
      }>('/api/playground/chat', {
        messages: turns.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      });
      setMessages((prev) => [
        ...prev,
        { id: ++idRef.current, role: 'assistant', content: data.reply },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: ++idRef.current,
          role: 'assistant',
          content: `⚠️ ${e?.message || 'Request failed'} — please try again.`,
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleShortcut(prompt: string) {
    setInput((prev) => (prev.trim() ? `${prev.trim()}\n${prompt}` : prompt));
    taRef.current?.focus();
  }

  function resetThread() {
    setMessages([]);
    setInput('');
    setIsThinking(false);
  }

  const hasThread = messages.length > 0 || isThinking;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
      />

      {/* Scroll region: welcome or thread */}
      <div
        ref={scrollRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {!hasThread ? (
          <WelcomeState onPick={(p) => handleShortcut(p)} />
        ) : (
          <ThreadHeader onReset={resetThread} modelName={selected.name} />
        )}

        <div className="mx-auto w-full max-w-3xl flex-1 px-4">
          {hasThread && (
            <div className="space-y-6 py-6">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isThinking && <ThinkingBubble />}
            </div>
          )}
        </div>
      </div>

      {/* Composer dock */}
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="bg-card border-foreground/10 focus-within:border-foreground/20 rounded-[1.75rem] border p-2.5 shadow-sm transition-all focus-within:shadow-[0_8px_40px_-12px_rgba(124,58,237,0.25)]"
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={m['playground.input.placeholder']()}
            className="placeholder:text-foreground/40 block max-h-[200px] min-h-[2.25rem] w-full resize-none bg-transparent px-3 pt-2 text-[15px] leading-relaxed outline-none"
          />

          <div className="flex items-center justify-between gap-2 pt-1.5">
            <button
              type="button"
              onClick={() => taRef.current?.focus()}
              aria-label="Toolkit"
              className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-9 items-center justify-center rounded-full transition-colors"
            >
              <Plus className="size-5" />
            </button>

            <div className="flex items-center gap-2">
              <ModelMenu
                models={models}
                selected={selected}
                onSelect={setModelId}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isThinking}
                aria-label={m['playground.input.send']()}
                className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="size-[18px]" />
              </button>
            </div>
          </div>
        </motion.div>

        <p className="text-foreground/35 mt-2 text-center text-[11px]">
          {m['playground.disclaimer']()}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Welcome / empty state                                              */
/* ------------------------------------------------------------------ */

function WelcomeState({ onPick }: { onPick: (prompt: string) => void }) {
  const examples: string[] = m['playground.examples']()
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 pt-[7vh] pb-10 text-center"
    >
      <motion.div
        initial={{ scale: 0.8, rotate: -6, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="brand-gradient mb-6 flex size-16 items-center justify-center rounded-[1.25rem] shadow-lg shadow-violet-500/20"
      >
        <Terminal className="size-8 text-white" />
      </motion.div>

      <span className="text-foreground/55 border-foreground/10 bg-card/60 mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur">
        <span className="brand-gradient size-1.5 rounded-full" />
        {m['playground.welcome.eyebrow']()}
      </span>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {m['playground.welcome.greeting']()}
      </h1>
      <p className="text-foreground/55 mt-3 max-w-md text-[15px] leading-relaxed">
        {m['playground.welcome.subtitle']()}
      </p>

      <div className="mt-8 grid w-full gap-2.5 text-left sm:grid-cols-2">
        {examples.map((ex, i) => (
          <motion.button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.06, duration: 0.4 }}
            whileHover={{ y: -2 }}
            className="bg-card hover:border-foreground/20 border-foreground/10 text-foreground/75 group flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors"
          >
            <Sparkles className="text-foreground/30 size-4 shrink-0 transition-colors group-hover:text-violet-500" />
            <span className="line-clamp-2">{ex}</span>
          </motion.button>
        ))}
      </div>

      <p className="text-foreground/35 mt-7 text-xs">
        ↓ {m['playground.welcome.cta']()}
      </p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Thread                                                             */
/* ------------------------------------------------------------------ */

function ThreadHeader({
  onReset,
  modelName,
}: {
  onReset: () => void;
  modelName: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5">
      <span className="text-foreground/50 text-xs font-medium tracking-wide uppercase">
        {m['playground.welcome.eyebrow']()} · {modelName}
      </span>
      <button
        type="button"
        onClick={onReset}
        className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      >
        <RefreshCw className="size-3.5" />
        {m['settings.chat.new_chat']()}
      </button>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex gap-3', isUser && 'flex-row-reverse')}
    >
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
          isUser ? 'bg-foreground text-background' : 'brand-gradient text-white'
        )}
      >
        {isUser ? (
          <span className="text-xs font-semibold">
            {m['settings.chat.you_initial']()}
          </span>
        ) : (
          <Sparkles className="size-3.5" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'bg-foreground text-background rounded-tr-md'
            : 'bg-card text-foreground border-foreground/10 rounded-tl-md border shadow-sm'
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </motion.div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="brand-gradient mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
        <Sparkles className="size-3.5 text-white" />
      </div>
      <div className="bg-card border-foreground/10 flex items-center gap-1.5 rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="bg-foreground/40 size-2 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model selector                                                     */
/* ------------------------------------------------------------------ */

function ModelMenu({
  models,
  selected,
  onSelect,
}: {
  models: ModelOption[];
  selected: ModelOption;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-foreground/5 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm transition-colors"
      >
        <span className="font-semibold tracking-tight">{selected.name}</span>
        {selected.effort && (
          <span className="text-foreground/55 text-xs">
            {selected.effortLabel}
          </span>
        )}
        <ChevronDown
          className={cn(
            'text-foreground/45 size-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="bg-popover text-popover-foreground border-foreground/10 absolute right-0 bottom-full z-50 mb-2 w-64 overflow-hidden rounded-2xl border p-1.5 shadow-xl"
            >
              <p className="text-foreground/40 px-2.5 py-1.5 text-[11px] font-medium tracking-wide uppercase">
                {m['playground.model.title']()}
              </p>
              {models.map((mo) => {
                const active = mo.id === selected.id;
                return (
                  <button
                    key={mo.id}
                    type="button"
                    onClick={() => {
                      onSelect(mo.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'hover:bg-foreground/5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                      active && 'bg-foreground/[0.04]'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{mo.name}</span>
                        {mo.effort && (
                          <span className="bg-foreground/5 text-foreground/60 rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                            {mo.effortLabel}
                          </span>
                        )}
                        {mo.badge && (
                          <span className="brand-gradient rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {mo.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-foreground/45 mt-0.5 text-xs">
                        {mo.desc}
                      </p>
                    </div>
                    {active && (
                      <Check className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    )}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Config builders (i18n resolved at render time)                     */
/* ------------------------------------------------------------------ */

function useModels(): ModelOption[] {
  return [
    {
      id: 'k3-extreme',
      name: m['playground.model.k3'](),
      effort: 'extreme',
      effortLabel: m['playground.model.k3_extreme'](),
      desc: m['playground.model.k3_desc'](),
      badge: 'NEW',
    },
    {
      id: 'k3-standard',
      name: m['playground.model.k3'](),
      effort: 'standard',
      effortLabel: m['playground.model.k3_standard'](),
      desc: m['playground.model.k3_desc'](),
    },
    {
      id: 'k26',
      name: m['playground.model.k26'](),
      effortLabel: '',
      desc: m['playground.model.k26_desc'](),
      badge: 'FAST',
    },
  ];
}
