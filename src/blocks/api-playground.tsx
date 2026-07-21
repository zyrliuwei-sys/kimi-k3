import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Files,
  Film,
  FolderGit2,
  Loader2,
  MonitorPlay,
  Plus,
  RefreshCw,
  ScanLine,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { streamChat } from '@/lib/chat-stream';
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

interface Attachment {
  type: 'image' | 'video';
  url: string;
  filename?: string;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

type TaskAction = 'upload' | 'seed';

interface TaskDef {
  id: string;
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
  action: TaskAction;
}

/* ------------------------------------------------------------------ */
/*  Upload helper                                                      */
/* ------------------------------------------------------------------ */

async function uploadMediaFile(file: File): Promise<Attachment> {
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
  return {
    type: r.type as 'image' | 'video',
    url: r.url,
    filename: r.filename,
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function ApiPlayground() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [modelId, setModelId] = useState('k3-extreme');
  const [activeTask, setActiveTask] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const models = useModels();
  const tasks = useTasks();

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

  // Keep the latest message in view; re-run as the streaming bubble grows.
  const lastLen = messages.length
    ? messages[messages.length - 1].content.length
    : 0;
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isThinking, lastLen]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function openFilePicker() {
    if (!session?.user) {
      toast.error(m['playground.attachment.signin_required']());
      return;
    }
    fileInputRef.current?.click();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !files.length) return;
    if (!session?.user) {
      toast.error(m['playground.attachment.signin_required']());
      return;
    }
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        try {
          added.push(await uploadMediaFile(file));
        } catch (e: any) {
          toast.error(e?.message || 'Upload failed');
        }
      }
      if (added.length) setAttachments((prev) => [...prev, ...added]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(url: string) {
    setAttachments((prev) => prev.filter((a) => a.url !== url));
  }

  async function handleSend() {
    const text = input.trim();
    // Image-only messages get a default prompt so the backend has a valid user
    // turn and the model knows what to do with the attachment.
    const effective =
      text ||
      (attachments.length ? m['playground.attachment.default_prompt']() : '');
    if (!effective || isThinking) return;

    const pendingAttachments = attachments;
    const userMsg: Message = {
      id: ++idRef.current,
      role: 'user',
      content: effective,
      attachments: pendingAttachments.length ? pendingAttachments : undefined,
    };
    const turns = [...messages, userMsg];
    setMessages(turns);
    setInput('');
    setAttachments([]);
    setIsThinking(true);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.style.height = 'auto';
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = ++idRef.current;
    const pushOrAppend = (delta: string) => {
      setIsThinking(false);
      setMessages((prev) => {
        const existing = prev.find((mm) => mm.id === assistantId);
        if (existing) {
          return prev.map((mm) =>
            mm.id === assistantId ? { ...mm, content: mm.content + delta } : mm
          );
        }
        return [
          ...prev,
          { id: assistantId, role: 'assistant', content: delta },
        ];
      });
    };

    try {
      await streamChat(
        {
          messages: turns.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          attachments: pendingAttachments,
        },
        {
          signal: controller.signal,
          onDelta: (delta) => pushOrAppend(delta),
          onGate: (status) => {
            setIsThinking(false);
            const body =
              status === 'login_required'
                ? m['playground.gate.login']()
                : m['playground.gate.pay']();
            setMessages((prev) => [
              ...prev,
              { id: assistantId, role: 'assistant', content: body },
            ]);
          },
          onError: (msg) => {
            setIsThinking(false);
            setMessages((prev) => [
              ...prev,
              {
                id: assistantId,
                role: 'assistant',
                content: `⚠️ ${msg || 'Request failed'} — please try again.`,
              },
            ]);
          },
          onDone: () => setIsThinking(false),
        }
      );
    } catch {
      setIsThinking(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
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

  // Selecting an agent-task mode seeds the input with a mode-specific prompt
  // and highlights the chip. Screenshot restore also opens the file picker so
  // the user can attach the image to restore. Clicking the active chip clears
  // the seeded prompt (but never the user's own typing) and deselects.
  function handleTask(task: TaskDef) {
    const prevTask = activeTask ? tasks.find((t) => t.id === activeTask) : null;
    const isSeeded =
      prevTask != null && input.trim() === prevTask.prompt.trim();
    const isSelecting = activeTask !== task.id;

    if (isSelecting) {
      setActiveTask(task.id);
      setInput((prev) =>
        !prev.trim() || isSeeded
          ? task.prompt
          : `${prev.trim()}\n${task.prompt}`
      );
      if (task.action === 'upload') openFilePicker();
    } else {
      setActiveTask(null);
      if (isSeeded) setInput('');
    }
    taRef.current?.focus();
  }

  function resetThread() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput('');
    setAttachments([]);
    setIsThinking(false);
  }

  const hasThread = messages.length > 0 || isThinking;
  const canSend = !!input.trim() || attachments.length > 0;

  const composerProps = {
    input,
    setInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    canSend,
    isThinking: isThinking || uploading,
    models,
    selected,
    onSelectModel: setModelId,
    taRef,
    attachments,
    uploading,
    onPlusClick: openFilePicker,
    onFilesSelected: handleFilesSelected,
    onRemoveAttachment: removeAttachment,
    fileInputRef,
    tasks,
    activeTask,
    onTask: handleTask,
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
      />
      {/* Faint dotted grid — lab atmosphere, fades toward the edges. */}
      <div
        aria-hidden
        className="play-grid pointer-events-none absolute inset-0 opacity-70"
      />

      {hasThread ? (
        // Active thread — messages scroll, composer pinned to the bottom.
        <>
          <div
            ref={scrollRef}
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <ThreadHeader onReset={resetThread} modelName={selected.name} />
            <div className="mx-auto w-full max-w-3xl flex-1 px-4">
              <div className="space-y-6 py-6">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isThinking && <ThinkingBubble />}
              </div>
            </div>
          </div>
          <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
            <Composer {...composerProps} />
          </div>
        </>
      ) : (
        // Empty state — greeting + composer grouped & vertically centered,
        // so the input sits right under the greeting instead of pinned low.
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-12">
          <div className="flex w-full max-w-2xl flex-col items-center">
            <WelcomeState
              selected={selected}
              onPick={(p) => handleShortcut(p)}
            />
            <div className="mt-8 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Composer (textarea + toolbar + disclaimer)                         */
/* ------------------------------------------------------------------ */

function Composer({
  input,
  setInput,
  onKeyDown,
  onSend,
  canSend,
  isThinking,
  models,
  selected,
  onSelectModel,
  taRef,
  attachments,
  uploading,
  onPlusClick,
  onFilesSelected,
  onRemoveAttachment,
  fileInputRef,
  tasks,
  activeTask,
  onTask,
}: {
  input: string;
  setInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  canSend: boolean;
  isThinking: boolean;
  models: ModelOption[];
  selected: ModelOption;
  onSelectModel: (id: string) => void;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  uploading: boolean;
  onPlusClick: () => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveAttachment: (url: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  tasks: TaskDef[];
  activeTask: string | null;
  onTask: (task: TaskDef) => void;
}) {
  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="bg-card border-foreground/10 focus-within:border-foreground/25 rounded-[1.5rem] border p-2 shadow-sm transition-all focus-within:shadow-[0_10px_44px_-14px_rgba(124,58,237,0.3)]"
      >
        {/* Hidden media input — images + videos, multi-select. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => onFilesSelected(e.target.files)}
          className="hidden"
        />

        {/* Attachment chips row */}
        {(attachments.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
            {attachments.map((a) => (
              <div
                key={a.url}
                className="group bg-muted/60 border-foreground/10 relative flex items-center gap-2 overflow-hidden rounded-xl border py-1 pr-1.5 pl-1"
              >
                {a.type === 'image' ? (
                  <img
                    src={a.url}
                    alt={a.filename || ''}
                    className="size-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="bg-foreground/5 text-foreground/60 flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <Film className="size-4" />
                  </span>
                )}
                <span className="text-foreground/60 max-w-[10rem] truncate text-xs">
                  {a.filename || (a.type === 'image' ? 'image' : 'video')}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.url)}
                  aria-label={m['playground.attachment.remove']()}
                  className="text-foreground/45 hover:text-foreground hover:bg-foreground/10 -mr-0.5 rounded-full p-0.5 transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="text-foreground/55 flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                {m['playground.attachment.uploading']()}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={m['playground.input.placeholder']()}
          className="placeholder:text-foreground/40 block max-h-[200px] min-h-[2.25rem] w-full resize-none bg-transparent px-3 pt-2.5 font-mono text-[14px] leading-relaxed outline-none"
        />

        <div className="flex items-center justify-between gap-2 pt-1.5">
          <button
            type="button"
            onClick={onPlusClick}
            aria-label={m['playground.attachment.add']()}
            title={m['playground.attachment.add']()}
            className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-9 items-center justify-center rounded-full transition-colors"
          >
            <Plus className="size-5" />
          </button>

          <div className="flex items-center gap-1.5">
            <ModelMenu
              models={models}
              selected={selected}
              onSelect={onSelectModel}
            />
            <span className="border-foreground/10 bg-foreground/[0.03] text-foreground/45 mx-1 hidden items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[11px] tracking-tight sm:inline-flex">
              ⌘<span className="text-foreground/35">↵</span>
            </span>
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend || isThinking}
              aria-label={m['playground.input.send']()}
              className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Agent-task quick starters — sit directly below the input box so each
          mode seeds the prompt (and screenshot restore opens the file picker). */}
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-foreground/35 mr-0.5 hidden font-mono text-[11px] tracking-[0.16em] uppercase sm:inline">
          {m['playground.tasks.title']()}
        </span>
        {tasks.map((t) => {
          const Icon = t.icon;
          const active = activeTask === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTask(t)}
              title={t.prompt}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[12px] tracking-tight transition-all',
                active
                  ? 'brand-gradient border-transparent text-white shadow-sm shadow-violet-500/20'
                  : 'border-foreground/10 bg-card/50 text-foreground/65 hover:border-foreground/25 hover:text-foreground'
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-foreground/35 mt-2.5 text-center font-mono text-[11px] tracking-tight">
        {m['playground.disclaimer']()}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Welcome / empty state                                              */
/* ------------------------------------------------------------------ */

function WelcomeState({
  selected,
  onPick,
}: {
  selected: ModelOption;
  onPick: (prompt: string) => void;
}) {
  const examples: string[] = m['playground.examples']()
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-full flex-col items-center text-center"
    >
      {/* Mono status bar — eyebrow + live model readout. Frames the page as a
          lab and surfaces the active model without a separate badge. */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="border-foreground/10 bg-card/60 mb-9 flex w-full items-center justify-between gap-3 rounded-full border py-1 pr-1.5 pl-1.5 backdrop-blur"
      >
        <span className="inline-flex items-center gap-2.5 py-0.5 pl-1.5">
          <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-full shadow-sm shadow-violet-500/25">
            <Terminal className="size-3.5 text-white" />
          </span>
          <span className="text-foreground/60 font-mono text-[11px] font-medium tracking-[0.18em] uppercase">
            {m['playground.welcome.eyebrow']()}
          </span>
        </span>
        <span className="bg-foreground/[0.04] text-foreground/55 inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] tracking-tight">
          <span className="pg-caret size-1.5 rounded-full bg-emerald-500" />
          {selected.name}
          {selected.effortLabel && (
            <>
              <span className="text-foreground/25">·</span>
              <span className="text-foreground/45">{selected.effortLabel}</span>
            </>
          )}
        </span>
      </motion.div>

      <h1 className="font-serif text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal tracking-[-0.025em]">
        {m['playground.welcome.greeting']()}
      </h1>
      <p className="text-foreground/55 mt-5 max-w-md text-[15px] leading-relaxed">
        {m['playground.welcome.subtitle']()}
      </p>

      {/* Numbered prompt "commands" — index in mono, trailing run-arrow that
          slides in on hover. Reads like a list of prepared snippets. */}
      <div className="mt-9 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {examples.map((ex, i) => (
          <motion.button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 + i * 0.06, duration: 0.4 }}
            className="group border-foreground/10 bg-card/50 hover:border-foreground/25 hover:bg-card flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-colors"
          >
            <span className="text-foreground/35 font-mono text-[12px] font-medium tracking-tight transition-all group-hover:bg-gradient-to-r group-hover:from-[#7c3aed] group-hover:to-[#0ea5e9] group-hover:bg-clip-text group-hover:text-transparent">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-foreground/75 line-clamp-2 flex-1 text-sm leading-snug">
              {ex}
            </span>
            <ArrowUpRight className="text-foreground/25 size-4 shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-violet-500 group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>
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
      <span className="text-foreground/45 font-mono text-[11px] font-medium tracking-[0.18em] uppercase">
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
  const images = message.attachments?.filter((a) => a.type === 'image') ?? [];
  const videos = message.attachments?.filter((a) => a.type === 'video') ?? [];
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
        {images.length > 0 && (
          <div
            className={cn(
              'mb-2 flex flex-wrap gap-2',
              message.content.trim() && 'mb-2.5'
            )}
          >
            {images.map((img) => (
              <a key={img.url} href={img.url} target="_blank" rel="noreferrer">
                <img
                  src={img.url}
                  alt={img.filename || ''}
                  className="h-32 w-32 rounded-lg object-cover"
                />
              </a>
            ))}
          </div>
        )}
        {videos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {videos.map((v) => (
              <a
                key={v.url}
                href={v.url}
                target="_blank"
                rel="noreferrer"
                className="bg-background/15 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <Film className="size-3.5" />
                {v.filename || 'video'}
              </a>
            ))}
          </div>
        )}
        {message.content.trim() &&
          (isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <MarkdownContent content={message.content} />
          ))}
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
        <span className="font-mono font-semibold tracking-tight">
          {selected.name}
        </span>
        {selected.effort && (
          <span className="text-foreground/55 font-mono text-xs">
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
  ];
}

function useTasks(): TaskDef[] {
  return [
    {
      id: 'screenshot',
      label: m['playground.tasks.screenshot.label'](),
      prompt: m['playground.tasks.screenshot.prompt'](),
      icon: ScanLine,
      action: 'upload',
    },
    {
      id: 'webproto',
      label: m['playground.tasks.webproto.label'](),
      prompt: m['playground.tasks.webproto.prompt'](),
      icon: MonitorPlay,
      action: 'seed',
    },
    {
      id: 'codebase',
      label: m['playground.tasks.codebase.label'](),
      prompt: m['playground.tasks.codebase.prompt'](),
      icon: FolderGit2,
      action: 'seed',
    },
    {
      id: 'docs',
      label: m['playground.tasks.docs.label'](),
      prompt: m['playground.tasks.docs.prompt'](),
      icon: Files,
      action: 'seed',
    },
    {
      id: 'agent',
      label: m['playground.tasks.agent.label'](),
      prompt: m['playground.tasks.agent.prompt'](),
      icon: Workflow,
      action: 'seed',
    },
  ];
}

function buildPreviewReply(prompt: string, model: ModelOption): string {
  const prefix = m['playground.reply.preview_prefix']({
    model: model.name,
    effort: model.effortLabel || model.name,
  });
  const quote = m['playground.reply.quote_label']();
  return `${prefix}\n\n**${quote}**\n\n> ${prompt}`;
}
