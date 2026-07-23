import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Files,
  FileText,
  Film,
  FolderGit2,
  Globe,
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

import { signIn, useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { ApiError, apiPost } from '@/lib/api-client';
import { streamChat } from '@/lib/chat-stream';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { usePublicConfig } from '@/hooks/use-public-config';
import { WebMotion } from '@/blocks/web-motion';
import { ClonePreview } from '@/components/clone-preview';
import { MarkdownContent } from '@/components/markdown-content';
import {
  PaymentProviderModal,
  type PaymentProvider,
} from '@/components/payment-provider-modal';

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
  type: 'image' | 'video' | 'document';
  url: string;
  filename?: string;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  // Assistant-only flags for the screenshot-clone flow:
  clone?: boolean; // this reply recreates a webpage → offer a live preview
  streaming?: boolean; // still receiving deltas → show code, not the preview
}

type TaskAction = 'upload' | 'dialog' | 'url';

interface TaskDef {
  id: string;
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
  action: TaskAction;
  image?: string;
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
    type: r.type as 'image' | 'video' | 'document',
    url: r.url,
    filename: r.filename,
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function ApiPlayground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [modelId, setModelId] = useState('k3-extreme');
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [webMotionOpen, setWebMotionOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);
  const [cloneUrl, setCloneUrl] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const models = useModels();
  const tasks = useTasks();

  const selected = models.find((mo) => mo.id === modelId) ?? models[0];

  const { data: session, isPending } = useSession();
  // Anonymous visitors are prompted to sign in/up before using the playground.
  // Don't block during the initial session load (would false-prompt logged-in
  // users); the backend per-IP/credit gate is the real ceiling regardless.
  const needsAuth = !isPending && !session?.user;
  function requireAuth(): boolean {
    if (needsAuth) {
      setAuthOpen(true);
      return false;
    }
    return true;
  }

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
    if (!requireAuth()) return;
    fileInputRef.current?.click();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !files.length) return;
    // Remember whether the screenshot-clone task was active when the picker
    // opened: if so, auto-send the clone request the moment the upload lands,
    // so "pick a webpage screenshot" flows straight into a cloned webpage.
    const wasScreenshotClone = activeTask === 'screenshot';
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
      if (!added.length) return;
      const newAttachments = [...attachments, ...added];
      setAttachments(newAttachments);
      if (wasScreenshotClone) {
        const prompt = tasks.find((t) => t.id === 'screenshot')?.prompt || '';
        handleSend({ text: prompt, attachments: newAttachments, clone: true });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(url: string) {
    setAttachments((prev) => prev.filter((a) => a.url !== url));
  }

  async function handleUrlClone(copy: string) {
    const url = cloneUrl.trim();
    if (!url) {
      toast.error(m['playground.urlclone.url_required']());
      return;
    }
    if (!copy) {
      toast.error(m['playground.urlclone.copy_required']());
      return;
    }
    setUploading(true);
    let imageUrl: string;
    try {
      const r = await apiPost<{ url: string }>('/api/playground/screenshot', {
        url,
      });
      imageUrl = r.url;
    } catch (e: unknown) {
      setUploading(false);
      toast.error(
        e instanceof ApiError
          ? e.message
          : m['playground.urlclone.shot_failed']()
      );
      return;
    }
    setUploading(false);
    setCloneUrl('');
    handleSend({
      text: `${m['playground.tasks.urlclone.instruction']()}\n\n${copy}`,
      attachments: [{ type: 'image', url: imageUrl }],
      clone: true,
    });
  }

  async function handleSend(opts?: {
    text?: string;
    attachments?: Attachment[];
    clone?: boolean;
  }) {
    if (!requireAuth()) return;
    const text = (opts?.text ?? input).trim();

    // URL → clone: intercept a direct user send (opts undefined) — screenshot
    // the URL first, then continue as a clone turn with the image attached.
    if (!opts && activeTask === 'urlclone') {
      return handleUrlClone(text);
    }

    const pendingAttachments = opts?.attachments ?? attachments;
    // Image-only messages get a default prompt so the backend has a valid user
    // turn and the model knows what to do with the attachment.
    const effective =
      text ||
      (pendingAttachments.length
        ? m['playground.attachment.default_prompt']()
        : '');
    if (!effective || isThinking) return;

    // A screenshot-clone turn (auto-sent after upload, or manually sent while
    // the task chip is active) flags its assistant reply for live preview.
    const isClone = !!opts?.clone || activeTask === 'screenshot';

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
    setActiveTask(null);
    setIsThinking(true);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.style.height = 'auto';
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = ++idRef.current;
    // Mark the assistant bubble as done streaming on any terminal event so the
    // clone preview can take over from the live-code view.
    const finishAssistant = (mutate: (msg: Message) => Message) => {
      setMessages((prev) =>
        prev.map((mm) => (mm.id === assistantId ? mutate(mm) : mm))
      );
    };
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
          {
            id: assistantId,
            role: 'assistant',
            content: delta,
            clone: isClone,
            streaming: true,
          },
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
            if (status === 'pay' && needsAuth === false) {
              setBillingOpen(true);
              return;
            }
            const body =
              status === 'login_required'
                ? m['playground.gate.login']()
                : m['playground.gate.pay']();
            setMessages((prev) => [
              ...prev,
              {
                id: assistantId,
                role: 'assistant',
                content: body,
                clone: false,
                streaming: false,
              },
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
                clone: false,
                streaming: false,
              },
            ]);
          },
          onDone: () => {
            setIsThinking(false);
            finishAssistant((msg) => ({ ...msg, streaming: false }));
          },
        }
      );
    } catch {
      setIsThinking(false);
      finishAssistant((msg) => ({ ...msg, streaming: false }));
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

  // Selecting an agent-task mode seeds the input with a mode-specific prompt
  // and highlights the chip. Screenshot restore also opens the file picker so
  // the user can attach the image to restore. Clicking the active chip clears
  // the seeded prompt (but never the user's own typing) and deselects.
  function handleTask(task: TaskDef) {
    if (!requireAuth()) return;
    // Web & motion opens its own video → video replicate dialog instead of
    // seeding a chat prompt.
    if (task.action === 'dialog') {
      setWebMotionOpen(true);
      return;
    }
    // URL → clone: no prompt seeding — just reveal the URL field (toggle off
    // if the same chip is clicked again).
    if (task.action === 'url') {
      setActiveTask((cur) => (cur === task.id ? null : task.id));
      return;
    }
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
    cloneUrl,
    setCloneUrl,
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
            <WelcomeState selected={selected} />
            <div className="mt-8 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}

      <WebMotionDialog
        open={webMotionOpen}
        onClose={() => setWebMotionOpen(false)}
      />
      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Web & Motion dialog (video → video replicate)                      */
/* ------------------------------------------------------------------ */

function WebMotionDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={m['web_motion.title']()}
        >
          <motion.div
            className="bg-background relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="hover:bg-foreground/5 absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full transition-colors"
            >
              <X className="size-4" />
            </button>
            {isPending ? (
              <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="text-foreground/40 size-6 animate-spin" />
              </div>
            ) : session?.user ? (
              <WebMotion />
            ) : (
              <WebMotionSignIn onClose={onClose} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WebMotionSignIn({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="brand-gradient grid size-12 place-items-center rounded-2xl shadow-sm shadow-violet-500/25">
        <MonitorPlay className="size-5 text-white" />
      </span>
      <p className="text-foreground/70 max-w-sm text-sm leading-relaxed">
        {m['web_motion.signin']()}
      </p>
      <Link
        href="/sign-in?callbackUrl=/web-motion"
        onClick={onClose}
        className="brand-gradient inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95"
      >
        {m['common.nav.sign_in']()}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth prompt — shown when an anonymous visitor clicks a playground  */
/*  action button (send / attach / task chip).                         */
/* ------------------------------------------------------------------ */

function AuthPromptDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: configs } = usePublicConfig();
  const googleEnabled = configs?.google_auth_enabled === 'true';

  // One-click Google OAuth. The provider is registered server-side whenever
  // google_client_id/secret are set, so this works as long as it's enabled.
  async function handleGoogle() {
    await signIn.social({
      provider: 'google',
      callbackURL: '/api-playground',
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={m['playground.auth.title']()}
        >
          <motion.div
            className="bg-background relative w-full max-w-md rounded-2xl shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="hover:bg-foreground/5 absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full transition-colors"
            >
              <X className="size-4" />
            </button>
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <span className="brand-gradient grid size-12 place-items-center rounded-2xl shadow-sm shadow-violet-500/25">
                <Terminal className="size-5 text-white" />
              </span>
              <h2 className="text-foreground text-lg font-semibold">
                {m['playground.auth.title']()}
              </h2>
              <p className="text-foreground/70 max-w-sm text-sm leading-relaxed">
                {m['playground.auth.description']()}
              </p>
              <div className="mt-2 flex w-full flex-col gap-2.5">
                {googleEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={handleGoogle}
                      className="border-foreground/15 bg-background text-foreground/90 hover:bg-foreground/5 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border px-6 text-sm font-medium transition-colors"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="size-4"
                      >
                        <path
                          d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                          fill="currentColor"
                        />
                      </svg>
                      {m['common.sign.google_sign_in']()}
                    </button>
                    <div className="text-foreground/35 flex items-center gap-3 py-0.5 text-xs">
                      <span className="bg-foreground/10 h-px flex-1" />
                      {m['playground.auth.or']()}
                      <span className="bg-foreground/10 h-px flex-1" />
                    </div>
                  </>
                )}
                <Link
                  href="/sign-up?callbackUrl=/api-playground"
                  onClick={onClose}
                  className="brand-gradient inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95"
                >
                  {m['playground.auth.sign_up']()}
                </Link>
                <Link
                  href="/sign-in?callbackUrl=/api-playground"
                  onClick={onClose}
                  className="border-foreground/15 text-foreground/80 hover:bg-foreground/5 inline-flex h-11 w-full items-center justify-center rounded-xl border px-6 text-sm font-medium transition-colors"
                >
                  {m['playground.auth.sign_in']()}
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}

      <PaymentProviderModal
        open={billingOpen}
        onOpenChange={(open) => {
          setBillingOpen(open);
          setLoadingProvider(null);
        }}
        providers={['creem']}
        loadingProvider={loadingProvider}
        onSelect={async (provider) => {
          setLoadingProvider(provider);
          try {
            const r = await apiPost<{ checkout_url?: string }>(
              '/api/payment/checkout',
              {
                plan_id: 'starter',
                payment_provider: provider,
              }
            );
            if (r.checkout_url) {
              window.location.href = r.checkout_url;
            }
          } catch {
            toast.error('Failed to open checkout');
          } finally {
            setLoadingProvider(null);
            setBillingOpen(false);
          }
        }}
      />
    </AnimatePresence>
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
  cloneUrl,
  setCloneUrl,
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
  cloneUrl: string;
  setCloneUrl: (v: string) => void;
}) {
  const capabilities = useCapabilities();
  const [showHint, setShowHint] = useState(false);
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
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
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
                    {a.type === 'video' ? (
                      <Film className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                )}
                <span className="text-foreground/60 max-w-[10rem] truncate text-xs">
                  {a.filename ||
                    (a.type === 'image'
                      ? 'image'
                      : a.type === 'video'
                        ? 'video'
                        : 'document')}
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

        {activeTask === 'urlclone' && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <Globe className="text-foreground/45 size-4 shrink-0" />
            <input
              type="url"
              inputMode="url"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              placeholder={m['playground.urlclone.url_placeholder']()}
              className="placeholder:text-foreground/40 h-9 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        )}

        {/* Task cards with images */}
        {tasks.length > 0 && (
          <div className="grid grid-cols-3 gap-2 px-2 pt-1 pb-1">
            {tasks.map((task) => {
              const Icon = task.icon;
              const isActive = activeTask === task.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTask(task)}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border transition-all',
                    isActive
                      ? 'border-[#7c3aed] ring-2 ring-[#7c3aed]/30'
                      : 'border-foreground/10 hover:border-foreground/20'
                  )}
                >
                  {task.image && (
                    <img
                      src={task.image}
                      alt={task.label}
                      className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-2">
                    <Icon className="size-3.5 text-white" />
                    <span className="text-xs font-medium text-white">
                      {task.label}
                    </span>
                  </div>
                </button>
              );
            })}
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

        {showHint && (
          <div className="text-foreground/50 flex items-start gap-1.5 px-3 pt-1 text-[11px] leading-relaxed">
            <FileText className="mt-0.5 size-3 shrink-0" />
            <span>{m['playground.attachment.hint']()}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1.5">
          <button
            type="button"
            onClick={() => {
              setShowHint(true);
              onPlusClick();
            }}
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

      {/* Capability showcase — display-only, informs visitors what Kimi K3
          can do. Not task launchers: no click action. */}
      <div className="mt-3">
        <p className="text-foreground/40 mb-2 text-center font-mono text-[10px] tracking-[0.2em] uppercase">
          {m['playground.capabilities.title']()}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {capabilities.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.id}
                className="border-foreground/10 bg-card/60 flex items-center gap-2 rounded-xl border px-3 py-2"
              >
                <Icon className="text-foreground/55 size-4 shrink-0" />
                <span className="text-foreground/65 text-xs leading-tight font-medium">
                  {c.label}
                </span>
              </div>
            );
          })}
        </div>
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

function WelcomeState({ selected }: { selected: ModelOption }) {
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
  const documents =
    message.attachments?.filter((a) => a.type === 'document') ?? [];
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
        {documents.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {documents.map((d) => (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="bg-background/15 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <FileText className="size-3.5" />
                {d.filename || 'document'}
              </a>
            ))}
          </div>
        )}
        {message.content.trim() &&
          (isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : message.clone && !message.streaming ? (
            <ClonePreview content={message.content} />
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
      effort: 'standard',
      effortLabel: m['playground.model.k3_standard'](),
      desc: m['playground.model.k26_desc'](),
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
      image: '/imgs/generated/screenshot-ui.jpg',
    },
    {
      id: 'webproto',
      label: m['playground.tasks.webproto.label'](),
      prompt: m['playground.tasks.webproto.prompt'](),
      icon: MonitorPlay,
      action: 'dialog',
      image: '/imgs/generated/web-motion.jpg',
    },
    {
      id: 'urlclone',
      label: m['playground.tasks.urlclone.label'](),
      prompt: m['playground.tasks.urlclone.prompt'](),
      icon: Globe,
      action: 'url',
      image: '/imgs/generated/url-clone.jpg',
    },
  ];
}

/* Display-only capability showcase rendered under the composer — informs the
   visitor what Kimi K3 can do, with no click action (not task launchers). */
interface CapabilityDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function useCapabilities(): CapabilityDef[] {
  return [
    {
      id: 'ui',
      label: m['playground.capabilities.ui.label'](),
      icon: ScanLine,
    },
    {
      id: 'repo',
      label: m['playground.capabilities.repo.label'](),
      icon: FolderGit2,
    },
    {
      id: 'docs',
      label: m['playground.capabilities.docs.label'](),
      icon: Files,
    },
    {
      id: 'agents',
      label: m['playground.capabilities.agents.label'](),
      icon: Workflow,
    },
    {
      id: 'premium',
      label: m['playground.capabilities.premium.label'](),
      icon: Terminal,
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
