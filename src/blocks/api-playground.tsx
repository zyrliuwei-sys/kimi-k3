import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Files,
  FileText,
  Film,
  FolderGit2,
  Loader2,
  MessageSquare,
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
import { streamDocAsk, type DocSource } from '@/lib/doc-stream';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { usePublicConfig } from '@/hooks/use-public-config';
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
  // Document-library mode:
  citations?: DocSource[]; // sources the model cited inline
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

// Client-side pre-flight — mirrors the server allowlist
// (`src/routes/api/storage/upload-media.ts`). Rejecting here saves the user
// the round-trip + server-side rejection for the obvious bad inputs.
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_FILES = 50;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];
const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function isSupportedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return ALLOWED_MIME_EXACT.has(mime);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type PlaygroundMode = 'chat' | 'documents';

export function ApiPlayground() {
  const [mode, setMode] = useState<PlaygroundMode>('chat');
  const [docCollectionId, setDocCollectionId] = useState<string | null>(null);
  const [docCollectionName, setDocCollectionName] = useState<string>('');
  const [docCount, setDocCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [modelId, setModelId] = useState('k3-extreme');
  const [authOpen, setAuthOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const models = useModels();

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
    const list = Array.from(files);

    // Pre-flight checks — surface obvious errors before we burn bandwidth.
    if (list.length > MAX_FILES) {
      toast.error(m['playground.attachment.err_too_many']());
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const offenders: Array<{ file: File; reason: 'size' | 'mime' }> = [];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) offenders.push({ file, reason: 'size' });
      else if (!isSupportedMime(file.type))
        offenders.push({ file, reason: 'mime' });
    }
    if (offenders.length) {
      for (const o of offenders) {
        const key =
          o.reason === 'size'
            ? 'playground.attachment.err_too_large'
            : 'playground.attachment.err_unsupported';
        toast.error(m[key]({ name: o.file.name }));
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      // Upload in parallel — independent files don't need to wait for each
      // other. allSettled so one rejection doesn't abort the rest.
      const results = await Promise.allSettled(list.map(uploadMediaFile));
      const added: Attachment[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          added.push(r.value);
        } else {
          const msg = (r.reason as Error)?.message || '';
          const key = /Anonymous upload limit/i.test(msg)
            ? 'playground.attachment.err_anon_limit'
            : 'playground.attachment.err_upload_failed';
          toast.error(m[key]({ name: list[i].name }));
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

  async function handleSend(opts?: {
    text?: string;
    attachments?: Attachment[];
    clone?: boolean;
  }) {
    if (!requireAuth()) return;
    const text = (opts?.text ?? input).trim();

    // ── Document-library mode: bypass chat attachments and stream via the
    //    doc-library SSE endpoint, which stitches parsed docs into the prompt.
    if (mode === 'documents') {
      if (!docCollectionId) {
        toast.error('Load sample documents first');
        return;
      }
      if (!text || isThinking) return;
      const userMsg: Message = {
        id: ++idRef.current,
        role: 'user',
        content: text,
      };
      const assistantId = ++idRef.current;
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
        },
      ]);
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      setIsThinking(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      await streamDocAsk(
        { collectionId: docCollectionId, question: text },
        {
          signal: controller.signal,
          onDelta: (chunk) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + chunk } : m
              )
            );
          },
          onSources: (sources) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, citations: sources } : m
              )
            );
          },
          onError: (msg) => {
            if (msg === 'login_required') {
              setAuthOpen(true);
            } else if (msg === 'payment_required') {
              setBillingOpen(true);
            } else {
              toast.error(msg || 'Generation failed');
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content ||
                        '⚠️ Something went wrong. Please try again.',
                    }
                  : m
              )
            );
          },
          onDone: () => {
            setIsThinking(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m
              )
            );
          },
        }
      ).finally(() => {
        setIsThinking(false);
      });
      return;
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
    const isClone = !!opts?.clone;

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

  function resetThread() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput('');
    setAttachments([]);
    setIsThinking(false);
  }

  // ── Document-library mode helpers ────────────────────────────────────────

  async function handleLoadSamples() {
    if (loadingSamples) return;
    if (!requireAuth()) return;
    setLoadingSamples(true);
    try {
      const result = await apiPost<{
        collectionsCreated: number;
        documentsCreated: number;
      }>('/api/doc-library/samples', {});
      const cols = await fetch('/api/doc-library/collection')
        .then((r) => r.json())
        .then((d) => (Array.isArray(d?.data) ? d.data : []))
        .catch(() => []);
      const sample = cols.find((c: any) =>
        String(c.name || '').endsWith('Sample')
      );
      if (sample) {
        setDocCollectionId(sample.id);
        setDocCollectionName(sample.name);
        setDocCount(sample.docCount ?? 0);
        setPageCount(sample.totalPages ?? 0);
        if (result.collectionsCreated === 0) {
          toast.success('Samples already loaded');
        } else {
          toast.success(
            `Loaded ${result.collectionsCreated} collections, ${result.documentsCreated} docs`
          );
        }
      } else {
        toast.error('Samples are present but could not be located');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load samples');
    } finally {
      setLoadingSamples(false);
    }
  }

  function handleExitDocMode() {
    setMode('chat');
    setDocCollectionId(null);
    setDocCollectionName('');
    setDocCount(0);
    setPageCount(0);
    resetThread();
  }

  const hasThread = messages.length > 0 || isThinking;
  const canSend = !!input.trim() || attachments.length > 0;

  const composerProps = {
    input,
    setInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    canSend: mode === 'documents' ? !!input.trim() : canSend,
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
    mode,
    docCollectionName,
    onLoadSamples: handleLoadSamples,
    loadingSamples,
    onExitDocMode: handleExitDocMode,
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
            <ThreadHeader
              onReset={resetThread}
              modelName={selected.name}
              mode={mode}
              docCollectionName={docCollectionName}
              onExitDocMode={handleExitDocMode}
            />
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
              mode={mode}
              onModeChange={setMode}
              docCollectionName={docCollectionName}
              onLoadSamples={handleLoadSamples}
              loadingSamples={loadingSamples}
              docCount={docCount}
              pageCount={pageCount}
            />
            <div className="mt-8 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}

      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
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
}) {
  const capabilities = useCapabilities();
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="bg-card border-foreground/10 focus-within:border-foreground/25 rounded-[2rem] border p-3 shadow-sm transition-all focus-within:shadow-[0_10px_44px_-14px_rgba(124,58,237,0.3)]"
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

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={m['playground.input.placeholder']()}
          className="placeholder:text-foreground/40 block max-h-[280px] min-h-[4rem] w-full resize-none bg-transparent px-4 pt-3 font-mono text-[15px] leading-relaxed outline-none"
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
            className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-10 items-center justify-center rounded-full transition-colors"
          >
            <Plus className="size-[22px]" />
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
              className="brand-gradient flex size-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="size-5" />
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

      <p className="text-foreground/35 mt-2.5 text-center font-mono text-[11px] tracking-tight uppercase">
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
  mode,
  onModeChange,
  docCollectionName,
  onLoadSamples,
  loadingSamples,
  docCount,
  pageCount,
}: {
  selected: ModelOption;
  mode: PlaygroundMode;
  onModeChange: (m: PlaygroundMode) => void;
  docCollectionName: string;
  onLoadSamples: () => void;
  loadingSamples: boolean;
  docCount: number;
  pageCount: number;
}) {
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
        className="border-foreground/10 bg-card/60 mb-6 flex w-full items-center justify-between gap-3 rounded-full border py-1 pr-1.5 pl-1.5 backdrop-blur"
      >
        <span className="inline-flex items-center gap-2.5 py-0.5 pl-1.5">
          <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-full shadow-sm shadow-violet-500/25">
            {mode === 'documents' ? (
              <BookOpen className="size-3.5 text-white" />
            ) : (
              <Terminal className="size-3.5 text-white" />
            )}
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

      {/* Mode toggle */}
      <div className="bg-card/60 border-foreground/10 mb-6 inline-flex items-center gap-1 rounded-full border p-1">
        <button
          type="button"
          onClick={() => onModeChange('chat')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            mode === 'chat'
              ? 'bg-foreground text-background'
              : 'text-foreground/55 hover:text-foreground'
          )}
        >
          <MessageSquare className="size-3.5" />
          Chat
        </button>
        <button
          type="button"
          onClick={() => onModeChange('documents')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            mode === 'documents'
              ? 'bg-foreground text-background'
              : 'text-foreground/55 hover:text-foreground'
          )}
        >
          <BookOpen className="size-3.5" />
          Documents
        </button>
      </div>

      {mode === 'documents' ? (
        <DocumentsEmpty
          collectionName={docCollectionName}
          loading={loadingSamples}
          onLoadSamples={onLoadSamples}
          onPickExample={(q) => {
            setInput(q);
            // Defer to next tick so the textarea has the new value before
            // we trigger send.
            requestAnimationFrame(() => handleSend(q));
          }}
          docCount={docCount}
          pageCount={pageCount}
        />
      ) : (
        <>
          <h1 className="font-serif text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal tracking-[-0.025em]">
            {m['playground.welcome.greeting']()}
          </h1>
          <p className="text-foreground/55 mt-5 max-w-md text-[15px] leading-relaxed">
            {m['playground.welcome.subtitle']()}
          </p>
        </>
      )}
    </motion.div>
  );
}

function DocumentsEmpty({
  collectionName,
  loading,
  onLoadSamples,
  onPickExample,
  docCount,
  pageCount,
}: {
  collectionName: string;
  loading: boolean;
  onLoadSamples: () => void;
  onPickExample: (q: string) => void;
  docCount: number;
  pageCount: number;
}) {
  const hasLoaded = !!collectionName;
  const statsLabel = hasLoaded
    ? m['doc_library.footer.stats']({
        docs: docCount,
        pages: pageCount,
        tokens: Math.max(1, Math.round((pageCount * 500) / 1000)),
      })
    : m['doc_library.footer.stats_zero']();

  return (
    <div className="flex w-full max-w-2xl flex-col items-center">
      {/* Hero */}
      <h1 className="font-serif text-[clamp(1.75rem,4.4vw,3rem)] leading-[1.08] font-medium tracking-[-0.025em]">
        {m['doc_library.hero.heading']()}
      </h1>
      <p className="text-foreground/60 mt-3 max-w-lg text-[14px] leading-relaxed">
        {m['doc_library.hero.subheading']()}
      </p>

      {/* Capability badges — 4 small cards in a row */}
      <div className="mt-7 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        <CapabilityBadge
          icon={<BookOpen className="size-3.5" />}
          title={m['doc_library.capability.context.title']()}
          desc={m['doc_library.capability.context.desc']()}
        />
        <CapabilityBadge
          icon={<Sparkles className="size-3.5" />}
          title={m['doc_library.capability.cited.title']()}
          desc={m['doc_library.capability.cited.desc']()}
        />
        <CapabilityBadge
          icon={<Files className="size-3.5" />}
          title={m['doc_library.capability.cross.title']()}
          desc={m['doc_library.capability.cross.desc']()}
        />
        <CapabilityBadge
          icon={<ScanLine className="size-3.5" />}
          title={m['doc_library.capability.multilang.title']()}
          desc={m['doc_library.capability.multilang.desc']()}
        />
      </div>

      {/* Try asking section — example chips */}
      <div className="mt-6 w-full">
        <div className="text-foreground/45 mb-2 font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
          {m['doc_library.examples.title']()}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            m['doc_library.examples.earnout'](),
            m['doc_library.examples.compare'](),
            m['doc_library.examples.summary'](),
            m['doc_library.examples.checklist'](),
          ].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPickExample(q)}
              disabled={!hasLoaded}
              className="border-foreground/10 bg-card hover:border-foreground/25 hover:bg-foreground/[0.03] inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="text-foreground/40 size-3" />
              <span className="line-clamp-1">{q}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CTA + footer stats */}
      {!hasLoaded ? (
        <>
          <button
            type="button"
            onClick={onLoadSamples}
            disabled={loading}
            className="brand-gradient mt-7 inline-flex h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:brightness-110 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {loading
              ? m['doc_library.empty.loading_samples']()
              : m['doc_library.empty.load_samples']()}
          </button>
          <p className="text-foreground/40 mt-3 font-mono text-[11px] tracking-wide">
            {statsLabel}
          </p>
        </>
      ) : (
        <p className="text-foreground/40 mt-6 font-mono text-[11px] tracking-wide">
          {statsLabel}
        </p>
      )}
    </div>
  );
}

function CapabilityBadge({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="border-foreground/10 bg-card/40 flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left">
      <div className="text-foreground/70 flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-semibold tracking-tight">
          {title}
        </span>
      </div>
      <p className="text-foreground/55 text-[10.5px] leading-snug">{desc}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Thread                                                             */
/* ------------------------------------------------------------------ */

function ThreadHeader({
  onReset,
  modelName,
  mode,
  docCollectionName,
  onExitDocMode,
}: {
  onReset: () => void;
  modelName: string;
  mode?: PlaygroundMode;
  docCollectionName?: string;
  onExitDocMode?: () => void;
}) {
  const inDocs = mode === 'documents';
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5">
      <span className="text-foreground/45 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] uppercase">
        {inDocs ? (
          <>
            <BookOpen className="size-3" />
            <span className="truncate">{docCollectionName || 'Documents'}</span>
            <span className="text-foreground/25">·</span>
            <span>{modelName}</span>
          </>
        ) : (
          <>
            {m['playground.welcome.eyebrow']()} · {modelName}
          </>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        {inDocs && (
          <button
            type="button"
            onClick={onExitDocMode}
            className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          >
            <X className="size-3.5" />
            Exit docs
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
        >
          <RefreshCw className="size-3.5" />
          {m['settings.chat.new_chat']()}
        </button>
      </div>
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
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="border-foreground/10 mt-3 flex flex-col gap-1.5 border-t pt-2.5">
            <div className="text-foreground/45 text-[10px] font-medium tracking-wide uppercase">
              Sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((s, i) => (
                <a
                  key={`${s.docId}-${i}`}
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-300/60 bg-amber-50/60 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100/60 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30"
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{s.filename}</span>
                  {s.page && (
                    <span className="shrink-0 opacity-60">p.{s.page}</span>
                  )}
                </a>
              ))}
            </div>
          </div>
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
