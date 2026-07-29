import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Circle,
  CornerDownLeft,
  Crown,
  FileText,
  Film,
  Gift,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  Sparkles as SparklesIcon,
  Terminal,
  Trash2,
  Triangle,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import {
  SEEDANCE_VIDEO_MODEL,
  type SeedanceVideoAspectRatio,
  type SeedanceVideoQuality,
} from '@/core/ai';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
  DEFAULT_SEEDANCE_VIDEO_AUDIO,
  DEFAULT_SEEDANCE_VIDEO_DURATION,
  DEFAULT_SEEDANCE_VIDEO_QUALITY,
} from '@/core/ai/video-pricing';
import { signIn, useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { streamChat } from '@/lib/chat-stream';
import { usePlaygroundStore } from '@/lib/playground-store';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { usePublicConfig } from '@/hooks/use-public-config';
import { ClonePreview } from '@/components/clone-preview';
import { MarkdownContent } from '@/components/markdown-content';
import {
  PaymentProviderModal,
  type PaymentProvider,
} from '@/components/payment-provider-modal';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  // Stable id used as the React key + removal handle. Generated client-side
  // the moment the file is picked, so it survives the optimistic→real-URL
  // swap (otherwise the `key={a.url}` would change mid-flight and remount
  // the chip, dropping the upload-progress animation).
  id: string;
  type: 'image' | 'video' | 'document';
  // Public storage URL once the upload finishes; while uploading this is the
  // local blob: URL so <img src> can render even before the round-trip.
  url: string;
  // Storage key from the upload response — lets the server re-download via a
  // signed request. Private R2 buckets 401 on unauthenticated GET, so we can't
  // rely on the public URL alone.
  key?: string;
  filename?: string;
  // Browser-local `blob:` URL created from the picked File so <img> in the
  // composer chip and message bubble can preview the image without hitting
  // the (possibly private) storage URL. Never sent over the wire — the
  // server doesn't need it (it uses `key` for signed downloads).
  previewUrl?: string;
  // Optimistic-UI status: 'uploading' = shown immediately, blob preview only;
  // 'done' = storage URL is live; 'error' = upload failed, chip is dimmed
  // and shows an inline retry affordance.
  uploadStatus: 'uploading' | 'done' | 'error';
  // Client-side dedup keys (filename + size + mtime) — not sent to the server.
  _size?: number;
  _mtime?: number;
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

/* ------------------------------------------------------------------ */
/*  Upload helper                                                      */
/* ------------------------------------------------------------------ */

// One batched POST instead of N parallel requests. The server already accepts
// up to MAX_FILES per call and returns one `results[]` entry per file; firing
// them in parallel tripped the endpoint's 1-second per-IP rate limit on the
// 2nd/3rd/Nth file. Batching also saves a round-trip per extra file.
async function uploadMediaFiles(files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const formData = new FormData();
  for (const f of files) formData.append('files', f);

  const res = await fetch('/api/storage/upload-media', {
    method: 'POST',
    body: formData,
  });
  const result = await res.json().catch(() => ({}));
  if (result?.code !== 0 || !result?.data?.results?.length) {
    throw new Error(result?.message || 'Upload failed');
  }
  return (
    result.data.results as Array<{
      url: string;
      key: string;
      filename: string;
      type: 'image' | 'video' | 'document';
    }>
  ).map((r) => ({
    type: r.type,
    url: r.url,
    // Storage key is forwarded so the server can re-download via a signed
    // request — private R2 buckets return 401 on unauthenticated GET, so
    // we can't just hand back the public URL and trust it works server-side.
    key: r.key,
    filename: r.filename,
  }));
}

// Client-side pre-flight — mirrors the server allowlist
// (`src/routes/api/storage/upload-media.ts`). Rejecting here saves the user
// the round-trip + server-side rejection for the obvious bad inputs.
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB
// Hard cap on a single batch. Real ceiling is the model's context window
// (per-doc text is capped at MAX_DOC_CHARS server-side and truncated), not
// the file count, so we let the API take whatever the user throws at it.
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
  'text/plain',
  'text/markdown',
  'text/csv',
]);
// Extension fallback — browsers (especially for .md) often leave File.type
// empty, so we also accept by extension. Matches the doc-library endpoint.
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'md',
  'txt',
  'csv',
]);
function hasSupportedDocumentExtension(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_DOCUMENT_EXTENSIONS.has(ext);
}

function isSupportedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return ALLOWED_MIME_EXACT.has(mime);
}

// Best-effort client-side type for the chip before the server tells us the
// truth. MIME wins; we fall back to extension so `.md` (no MIME in many
// browsers) and friends still render the right icon before upload completes.
const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
  'heic',
  'heif',
]);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
function inferAttachmentType(file: File): 'image' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'document';
}

// Pull image Files out of a paste event's clipboard — the path a screenshot
// takes when captured to the clipboard (region select, Cmd/Ctrl+C from an
// image viewer, etc.). Non-image clipboard data (text, other file types) is
// ignored here so plain-text pasting still works. Clipboard screenshots
// usually arrive with no/generic name, so each gets a stable screenshot-*
// name — keeps the dedup key meaningful and the chip readable.
function imageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  let index = 0;
  for (const item of clipboardData.items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    index++;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const hasName = /\.[a-z0-9]+$/i.test(file.name);
    files.push(
      hasName
        ? file
        : new File([file], `screenshot-${Date.now()}-${index}.${ext}`, {
            type: file.type,
          })
    );
  }
  return files;
}
/* ------------------------------------------------------------------ */
/*  Video frame extraction                                             */
/* ------------------------------------------------------------------ */

// Extract still frames from a video File in the browser. Returns the JPEG
// blobs + the timestamps they came from, plus the original duration so the
// caller can label the chips and brief the model. Falls back to `null` on
// any failure (codec unsupported, metadata missing, seek timeout) — the
// caller leaves the video attachment alone and the user just sees a video
// chip like before.
async function extractVideoFrames(
  file: File,
  count: number = FRAMES_PER_VIDEO
): Promise<{ frames: { blob: Blob; t: number }[]; duration: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    // muted + playsInline are required for autoplay/seek on iOS Safari; we
    // don't autoplay here but seeking on iOS still needs `muted=true`.
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const duration = await new Promise<number>((resolve, reject) => {
      const ok = () => resolve(video.duration);
      const err = () => reject(new Error('metadata failed'));
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('error', err, { once: true });
      // Safety net: some browsers hang on `loadedmetadata` for unusual
      // codecs and never fire either event.
      setTimeout(() => reject(new Error('metadata timeout')), 10_000);
    });

    if (!Number.isFinite(duration) || duration <= 0) return null;

    // Sample evenly across the video. Offset by half a bucket so we don't
    // grab the same opening frame multiple times on very short clips.
    const timestamps: number[] = [];
    const step = duration / count;
    for (let i = 0; i < count; i++) {
      timestamps.push(Math.min(duration, step * (i + 0.5)));
    }

    const seekTo = (t: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = t;
      });

    const canvas = document.createElement('canvas');
    const frames: { blob: Blob; t: number }[] = [];
    for (const t of timestamps) {
      try {
        await seekTo(t);
        if (video.videoWidth === 0 || video.videoHeight === 0) continue;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(video, 0, 0);
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), 'image/jpeg', 0.85)
        );
        if (blob) frames.push({ blob, t });
      } catch {
        // One bad seek — skip this frame and keep going rather than
        // abandoning the whole extract.
      }
    }

    return frames.length ? { frames, duration } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
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

  const [modelId, setModelId] = useState('k3-standard');
  const [authOpen, setAuthOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks every blob: preview URL we've created so we can revoke them
  // on removal / unmount instead of leaking memory across the session.
  const previewUrlsRef = useRef<Set<string>>(new Set());

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
    return () => {
      abortRef.current?.abort();
      // Revoke any pending blob: previews so we don't leak memory on
      // navigation away from the playground.
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    };
  }, []);

  function openFilePicker() {
    if (!requireAuth()) return;
    fileInputRef.current?.click();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !files.length) return;
    let list = Array.from(files);

    // Size / MIME allowlist first — running against the user's original picks
    // so a single oversized video fails fast with a clear error, without
    // spending CPU on frame extraction we'll throw away.
    const offenders: Array<{ file: File; reason: 'size' | 'mime' }> = [];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) offenders.push({ file, reason: 'size' });
      else if (
        !isSupportedMime(file.type) &&
        !hasSupportedDocumentExtension(file.name)
      )
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

    // Video → frame expansion. We keep the original video as a chip (so the
    // bubble still plays) AND add N JPEGs so the vision model can actually see
    // what's in the video. Frame extraction is a best-effort step — if it
    // fails (codec unsupported, metadata missing) we keep the video alone
    // and fall back to today's "model gets a filename note" behavior.
    let framesAdded = 0;
    const expanded: File[] = [];
    for (const file of list) {
      expanded.push(file);
      if (inferAttachmentType(file) !== 'video') continue;
      try {
        const result = await extractVideoFrames(file);
        if (!result) continue;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        for (let i = 0; i < result.frames.length; i++) {
          const { blob, t } = result.frames[i];
          const frameName = `${baseName}-frame-${i + 1}-${(t * 10).toFixed(0)}.jpg`;
          expanded.push(new File([blob], frameName, { type: 'image/jpeg' }));
          framesAdded++;
        }
      } catch {
        // Swallow — the video chip is still useful on its own.
      }
    }
    list = expanded;

    // Now that we know the real upload size (videos + frames), enforce the
    // per-batch file cap.
    if (list.length > MAX_FILES) {
      toast.error(m['playground.attachment.err_too_many']());
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (framesAdded > 0) {
      const s = framesAdded === 1 ? '' : 's';
      toast.success(
        m['playground.attachment.frames_extracted']({ count: framesAdded, s })
      );
    }

    // Skip files that are already attached (same name + size + mtime) —
    // the storage key is the md5 so re-uploading returns the same URL,
    // and rapid re-selects otherwise spam the 1-second rate limit.
    const fresh = list.filter((f) => {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      return !Array.from(attachments).some(
        (a) =>
          a.filename === f.name &&
          a._size === f.size &&
          a._mtime === f.lastModified
      );
    });
    if (fresh.length === 0) {
      // Nothing new — silently no-op (no toast spam).
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Optimistic insert: build a placeholder for every file and push them
    // into `attachments` immediately. The chip renders right away using the
    // local `blob:` preview; the network upload runs in the background and
    // swaps in the real URL when it returns. This is what makes the picker
    // feel instant — no "Uploading..." spinner before the chip even appears.
    const placeholders: Attachment[] = fresh.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        type: inferAttachmentType(file),
        // Use the blob URL as `url` so <img src> works pre-upload. After the
        // upload finishes we replace this with the public storage URL.
        url: previewUrl,
        previewUrl,
        filename: file.name,
        uploadStatus: 'uploading',
        _size: file.size,
        _mtime: file.lastModified,
      };
    });
    setAttachments((prev) => [...prev, ...placeholders]);
    setUploading(true);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Background upload — does NOT block the picker. The chip is already
    // on screen; this just upgrades the URL when the storage round-trip
    // completes.
    void (async () => {
      try {
        const uploaded = await uploadMediaFiles(fresh);
        // One batched POST returns one result per input file, in order.
        // `uploaded[i]` corresponds to `placeholders[i]`.
        setAttachments((prev) => {
          const placeholderIds = new Set(placeholders.map((p) => p.id));
          const seen = new Set<string>();
          return prev.map((a) => {
            if (!placeholderIds.has(a.id)) return a;
            const idx = placeholders.findIndex((p) => p.id === a.id);
            const result = uploaded[idx];
            if (!result) return { ...a, uploadStatus: 'error' };
            // Server's md5-based dedup may return the same URL for two
            // different placeholders (e.g. the user picked the same file
            // twice from different folders). Collapse duplicates so the
            // chip doesn't render with conflicting ids.
            if (seen.has(result.url)) return { ...a, uploadStatus: 'error' };
            seen.add(result.url);
            return {
              ...a,
              type: result.type,
              url: result.url,
              key: result.key,
              uploadStatus: 'done',
            };
          });
        });
      } catch (err) {
        const msg = (err as Error)?.message || '';
        const key = /Anonymous upload limit/i.test(msg)
          ? 'playground.attachment.err_anon_limit'
          : /Please retry after/i.test(msg)
            ? 'playground.attachment.err_rate_limited'
            : 'playground.attachment.err_upload_failed';
        toast.error(
          m[key]({
            name: fresh.length > 1 ? `${fresh.length} files` : fresh[0].name,
          })
        );
        // Flip the placeholders to 'error' so the chip dims and shows a
        // retry affordance; the user can hit ✕ to drop them entirely.
        const placeholderIds = new Set(placeholders.map((p) => p.id));
        setAttachments((prev) =>
          prev.map((a) =>
            placeholderIds.has(a.id) ? { ...a, uploadStatus: 'error' } : a
          )
        );
      } finally {
        setUploading(false);
      }
    })();
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const dropped = prev.find((a) => a.id === id);
      if (dropped?.previewUrl) {
        URL.revokeObjectURL(dropped.previewUrl);
        previewUrlsRef.current.delete(dropped.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  async function handleSend(opts?: {
    text?: string;
    attachments?: Attachment[];
    clone?: boolean;
  }) {
    if (!requireAuth()) return;
    const text = (opts?.text ?? input).trim();
    const explicitAttachments = opts?.attachments ?? attachments;

    // Document attachments need to persist across turns so follow-up messages
    // ("turn this into a PPT", "translate it", etc.) can reference the
    // original text the AI has already seen. Without this, the model only
    // sees its own prior summary in the history — and a follow-up that asks
    // for a transformation looks like a request against content the model
    // can no longer reach.
    //
    // We merge every prior user turn's document attachments into the current
    // request, deduped by URL (the storage key is the file md5, so re-sending
    // is just a URL pointer — no extra upload round-trip). Images and videos
    // are NOT carried forward — those are typically one-shot (the user
    // looks at them once and moves on), and silently re-inlining a vision
    // part on every turn would bloat the token bill.
    const historicalDocs = new Map<string, Attachment>();
    for (const turn of messages) {
      if (turn.role !== 'user' || !turn.attachments) continue;
      for (const att of turn.attachments) {
        if (att.type !== 'document') continue;
        if (!historicalDocs.has(att.url)) historicalDocs.set(att.url, att);
      }
    }
    const merged: Attachment[] = [];
    const seen = new Set<string>();
    for (const att of [...explicitAttachments, ...historicalDocs.values()]) {
      if (seen.has(att.url)) continue;
      seen.add(att.url);
      merged.push(att);
    }
    const pendingAttachments = merged;

    // Video → frame preamble. For every video in this turn we look up the
    // matching extracted-frame filenames (created client-side as
    // `<videoBaseName>-frame-N-<t*10>.jpg`) and emit a single note per video
    // telling the model what's in the attached images. Goes only into the
    // payload sent to the model — the user bubble just renders their text
    // (the chips already telegraph what was attached).
    const videoNotes: string[] = [];
    const framesByVideo = new Map<string, number[]>();
    for (const a of pendingAttachments) {
      const m = a.filename?.match(/^(.+)-frame-\d+-(\d+)\.jpg$/);
      if (!m) continue;
      const videoBase = m[1];
      const tenthSec = Number(m[2]);
      const arr = framesByVideo.get(videoBase) ?? [];
      arr.push(tenthSec);
      framesByVideo.set(videoBase, arr);
    }
    // Pair each video back with its frames, in timestamp order. If a video
    // has no frames attached (extraction failed) we skip the note entirely —
    // the server still emits its own "[Attached video: ...]" fallback.
    const seenVideoBase = new Set<string>();
    for (const a of pendingAttachments) {
      if (a.type !== 'video') continue;
      const base = a.filename?.replace(/\.[^.]+$/, '') ?? a.filename ?? '';
      if (!base || seenVideoBase.has(base)) continue;
      const frames = framesByVideo.get(base);
      if (!frames || frames.length === 0) continue;
      seenVideoBase.add(base);
      frames.sort((x, y) => x - y);
      const timestamps = frames
        .map((t) => `${(t / 10).toFixed(1)}s`)
        .join(', ');
      videoNotes.push(
        m['playground.attachment.video_frames_note']({
          name: a.filename || base,
          count: frames.length,
          s: frames.length === 1 ? '' : 's',
          timestamps,
        })
      );
    }
    const framePreamble = videoNotes.join('\n\n');

    // Image-only messages get a default prompt so the backend has a valid user
    // turn and the model knows what to do with the attachment.
    const effective =
      text ||
      (pendingAttachments.length
        ? m['playground.attachment.default_prompt']()
        : '');
    if (!effective || isThinking) return;

    const effectiveForModel = framePreamble
      ? `${framePreamble}\n\n${effective}`
      : effective;

    // A screenshot-clone turn (auto-sent after upload, or manually sent while
    // the task chip is active) flags its assistant reply for live preview.
    const isClone = !!opts?.clone;

    const userMsg: Message = {
      id: ++idRef.current,
      role: 'user',
      content: effective,
      // UI rendering only — store what the user actually attached THIS turn,
      // not the merged set we forward to the model. Otherwise the bubble
      // would pile up every historical document above every message, which
      // buries the user's actual input.
      attachments: explicitAttachments.length ? explicitAttachments : undefined,
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
          // The last user turn needs the video-frame preamble so the model
          // knows the attached images are frames of a video; history turns
          // pass through unchanged.
          messages: turns.map((msg, i) => ({
            role: msg.role,
            content:
              i === turns.length - 1 && msg.role === 'user'
                ? effectiveForModel
                : msg.content,
          })),
          // Strip browser-local fields before sending — they're React /
          // optimistic-UI state (id, uploadStatus, blob URL, dedup keys)
          // that have no meaning on the server and would bloat the request.
          attachments: pendingAttachments.map((a) => {
            const {
              previewUrl: _preview,
              uploadStatus: _status,
              id: _id,
              _size: _size,
              _mtime: _mtime,
              ...rest
            } = a;
            return rest;
          }),
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
  // (removed — Documents mode no longer accessible from this UI)

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
            <ThreadHeader onReset={resetThread} />
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
        // Empty state — greeting + composer grouped and vertically centered.
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-12">
          <div className="flex w-full max-w-3xl flex-col items-center">
            <WelcomeState selected={selected} />
            <div className="mt-10 w-full">
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

              {/* Free-credits gift banner — the conversion hook. Sits right
                  between the description and the action buttons so the
                  "Create free account" CTA is preceded by the value prop. */}
              <div className="mt-1 w-full rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-violet-500/10 p-3 text-left">
                <div className="flex items-center gap-2.5">
                  <span className="brand-gradient grid size-8 shrink-0 place-items-center rounded-lg text-white shadow-sm shadow-violet-500/30">
                    <Gift className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-[13px] leading-tight font-semibold">
                      {m['playground.auth.gift_badge']()}
                    </p>
                    <p className="text-foreground/60 mt-0.5 text-[11.5px] leading-snug">
                      {m['playground.auth.gift_description']()}
                    </p>
                  </div>
                </div>
              </div>

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

// Quick-action starter prompts shown beneath the composer. Each entry has a
// localized label and prompt for both supported locales; the active one is
// picked at render time with getLocale(). Tapping a button drops its prompt
// into the input and focuses it.
const QUICK_ACTIONS = [
  {
    id: 'screenshot',
    zh: '截图还原网页',
    en: 'Screenshot to Web',
    promptZh: '把这个截图还原成一个完整、可运行的网页。',
    promptEn: 'Turn this screenshot into a complete, working webpage.',
  },
  {
    id: 'animation',
    zh: '复刻动画原型',
    en: 'Animation Prototype',
    promptZh: '复刻这个动画原型，还原所有的交互与动效。',
    promptEn:
      'Replicate this animation prototype with all interactions and motion.',
  },
  {
    id: 'docs',
    zh: '超多文档分析',
    en: 'Multi-doc Analysis',
    promptZh: '分析这批文档并提取关键信息与结论。',
    promptEn:
      'Analyze these documents and extract the key insights and conclusions.',
  },
  {
    id: 'code',
    zh: '大型代码开发',
    en: 'Large Codebase',
    promptZh: '开发一个大型代码项目，结构清晰、可维护。',
    promptEn:
      'Build a large-scale code project with a clean, maintainable structure.',
  },
] as const;

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
  onRemoveAttachment: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  // Always-on attachment hint pill — lives in the bottom toolbar to the
  // right of the + button. New users need a permanent reminder of which
  // file types are supported; this is the playground, not a polished app.
  const [showHint] = useState(true);

  // Quick-action labels/prompts follow the active locale: zh shows Chinese,
  // en shows English.
  const isZh = getLocale() === 'zh';

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="border-foreground/20 focus-within:border-foreground/35 dark:bg-foreground/5 rounded-[2rem] border bg-white py-4 pr-7 pl-3 shadow-sm transition-all focus-within:shadow-[0_10px_44px_-14px_rgba(124,58,237,0.3)]"
      >
        {/* Hidden media input — images + videos, multi-select. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,text/csv"
          multiple
          onChange={(e) => onFilesSelected(e.target.files)}
          className="hidden"
        />

        {/* Attachment chips row — shown immediately on pick, with a tiny
            per-file status so the user sees the upload progress without a
            blocking global spinner. */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
            {attachments.map((a) => {
              const isUploading = a.uploadStatus === 'uploading';
              const isError = a.uploadStatus === 'error';
              return (
                <div
                  key={a.id}
                  className={cn(
                    'group bg-muted/60 border-foreground/10 relative flex items-center gap-2 overflow-hidden rounded-xl border py-1 pr-1.5 pl-1 transition-opacity',
                    isUploading && 'opacity-80',
                    isError && 'border-destructive/40 opacity-60'
                  )}
                >
                  {a.type === 'image' ? (
                    <img
                      src={a.previewUrl || a.url}
                      alt={a.filename || ''}
                      className="size-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : a.type === 'video' ? (
                    // Video preview — prefers the local blob: preview so the
                    // chip shows a real poster frame even when the storage
                    // URL is private (R2). muted + playsInline are required
                    // for the element to render without tripping autoplay
                    // policies in some browsers.
                    <video
                      src={a.previewUrl || a.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="bg-foreground/5 text-foreground/60 flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <FileText className="size-4" />
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
                  {isUploading && (
                    <Loader2 className="text-foreground/45 size-3 shrink-0 animate-spin" />
                  )}
                  {isError && (
                    <span
                      title={m['playground.attachment.err_upload_failed']()}
                      className="text-destructive text-[10px] font-medium tracking-wide uppercase"
                    >
                      {m['playground.attachment.status_error']()}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.id)}
                    aria-label={m['playground.attachment.remove']()}
                    className="text-foreground/45 hover:text-foreground hover:bg-foreground/10 -mr-0.5 rounded-full p-0.5 transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // Cmd/Ctrl+V with a screenshot on the clipboard → lift the image
            // out and route it through the same attachment pipeline as the
            // picker (validate → dedup → optimistic chip → background upload).
            // Pure-text pastes have no image items and fall through untouched.
            const images = imageFilesFromClipboard(e.clipboardData);
            if (!images.length) return;
            e.preventDefault();
            const dt = new DataTransfer();
            for (const f of images) dt.items.add(f);
            onFilesSelected(dt.files);
          }}
          rows={1}
          placeholder={m['playground.input.placeholder']()}
          className="placeholder:text-foreground/40 block max-h-[280px] min-h-[2.5rem] w-full resize-none bg-transparent px-4 pt-2 font-mono text-[15px] leading-relaxed outline-none"
        />

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPlusClick}
              aria-label={m['playground.attachment.add']()}
              title={m['playground.attachment.add']()}
              className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-10 items-center justify-center rounded-full transition-colors"
            >
              <Plus className="size-[22px]" />
            </button>
            {showHint && (
              <span className="text-foreground/55 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-snug">
                <FileText className="size-3 shrink-0" />
                <span className="truncate">
                  {m['playground.attachment.hint_short']()}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <ModelMenu
              models={models}
              selected={selected}
              onSelect={onSelectModel}
            />
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

      {/* Quick actions — 4 starter prompts beneath the composer, in the
          reference layout (equal-width outlined rectangles, single row; 2
          cols on mobile, 4 cols on sm+). Label and prompt follow the active
          locale: Chinese in zh, English in en. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUICK_ACTIONS.map((action) => {
          const label = isZh ? action.zh : action.en;
          const prompt = isZh ? action.promptZh : action.promptEn;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                setInput(prompt);
                taRef.current?.focus();
              }}
              className="border-foreground/15 hover:border-foreground/30 hover:bg-foreground/[0.03] dark:bg-foreground/5 flex items-center justify-center rounded-2xl border bg-white px-3 py-2.5 text-center transition-colors"
            >
              <span className="text-foreground text-[13px] leading-tight font-medium">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Welcome / empty state                                              */
/* ------------------------------------------------------------------ */

function WelcomeState({ selected }: { selected: ModelOption }) {
  // Entry labels follow the active locale — matches the QUICK_ACTIONS pattern.
  const isZh = getLocale() === 'zh';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-full flex-col items-center text-center"
    >
      {/* Entry point. Document Analysis is an outlined pill. */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="border-foreground/15 bg-background hover:bg-foreground/5 inline-flex items-center rounded-full border px-5 py-1.5 text-sm font-medium transition-colors"
        >
          <span aria-hidden className="mr-1.5">
            📄
          </span>
          {isZh ? '文档分析' : 'Document Analysis'}
        </button>
      </div>
      <h1 className="font-serif text-[clamp(2.5rem,6vw,4rem)] leading-[1.05] font-normal tracking-[-0.025em]">
        {m['playground.welcome.greeting']()}
      </h1>
      <p className="text-foreground/55 mt-5 max-w-md text-[15px] leading-relaxed">
        {m['playground.welcome.subtitle']()}
      </p>
    </motion.div>
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

function ThreadHeader({ onReset }: { onReset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5">
      <span className="text-foreground/45 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] uppercase">
        {m['playground.welcome.eyebrow']()}
      </span>
      <div className="flex items-center gap-1.5">
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
      {isUser && (
        <div
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
            'bg-violet-200 text-violet-950 dark:bg-violet-900/40 dark:text-violet-100'
          )}
        >
          <span className="text-xs font-semibold">
            {m['settings.chat.you_initial']()}
          </span>
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'rounded-tr-md bg-violet-200 text-violet-950 dark:bg-violet-900/40 dark:text-violet-100'
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
                  src={img.previewUrl || img.url}
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
              // Use a real <video> element for the bubble preview so the
              // user can play/pause inline; clicking the element opens the
              // raw storage URL in a new tab (the <a> wrapper).
              <a
                key={v.url}
                href={v.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg"
              >
                <video
                  src={v.previewUrl || v.url}
                  controls
                  preload="metadata"
                  className="max-h-64 w-full rounded-lg object-cover"
                />
                <div className="text-foreground/60 mt-1 flex items-center gap-1.5 px-1 text-xs">
                  <Film className="size-3.5" />
                  <span className="truncate">{v.filename || 'video'}</span>
                </div>
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

function buildPreviewReply(prompt: string, model: ModelOption): string {
  const prefix = m['playground.reply.preview_prefix']({
    model: model.name,
    effort: model.effortLabel || model.name,
  });
  const quote = m['playground.reply.quote_label']();
  return `${prefix}\n\n**${quote}**\n\n> ${prompt}`;
}

/* ========================================================================== */
/*  Lorka-style multi-session playground (sidebar + chat + image tabs)        */
/* ========================================================================== */
/*                                                                            */
/*  These are the new exports used by `src/routes/api-playground/`. They sit   */
/*  alongside the legacy `ApiPlayground` (single-thread marketing variant)    */
/*  to keep the marketing landing's import path intact while the dashboard    */
/*  routes pick up the new multi-session UX.                                   */
/*                                                                            */
/*  Reuses the helpers above verbatim:                                         */
/*    - `uploadMediaFiles`  — POST /api/storage/upload-media                   */
/*    - `imageFilesFromClipboard` — paste-to-upload (screenshot flow)          */
/*    - `inferAttachmentType` / `isSupportedMime` / `hasSupportedDocumentExtension` */
/*    - `Attachment` / `Message` types                                          */
/* ========================================================================== */

interface ChatRow {
  id: string;
  title?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date;
}

interface ImageTaskRow {
  id: string;
  mediaType: string;
  prompt: string;
  status: string;
  model?: string | null;
  createdAt: string | Date;
  thumbnailUrl?: string | null;
}

/* ------------------------------------------------------------------ */
/*  ChatPlayground                                                     */
/* ------------------------------------------------------------------ */

/**
 * Multi-session chat mode. Lifts the sidebar + delete + streaming pattern
 * from `src/routes/settings/chat.tsx`. Kept in this file (rather than a
 * new module) so it can share the screenshot paste, attachment upload,
 * and message-bubble rendering with the legacy single-thread component.
 */
export function ChatPlayground() {
  const store = usePlaygroundStore();
  const { activeChatId, clearActive } = store;
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  function requireAuth(): boolean {
    if (!session?.user) {
      setAuthOpen(true);
      return false;
    }
    return true;
  }

  // Load active chat + its messages. `enabled: !activeChatId` returns
  // undefined until the user picks a session from the sidebar.
  const chatQuery = useQuery({
    queryKey: ['chat', activeChatId],
    queryFn: () =>
      apiGet<{ chat: ChatRow; messages: Message[] }>(
        `/api/chat/${activeChatId}`
      ),
    enabled: !!activeChatId,
  });

  // When the active chat resolves, hydrate local messages + scroll. We do
  // NOT keep messages in react-query cache — they're too large to share
  // across navigation and the sidebar list already has the metadata.
  useEffect(() => {
    if (chatQuery.data?.messages) {
      setMessages(
        chatQuery.data.messages.map((m: any, i: number) => ({
          id: i + 1,
          role: m.role,
          content: m.content,
        }))
      );
    }
  }, [chatQuery.data]);

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
    return () => {
      abortRef.current?.abort();
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    };
  }, []);

  // Local clear — runs when "新建聊天" flips activeChatId to null. Resets
  // input + pending attachments + aborts any in-flight stream.
  useEffect(() => {
    if (activeChatId !== null) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput('');
    setAttachments([]);
    setIsThinking(false);
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, [activeChatId]);

  function openFilePicker() {
    if (!requireAuth()) return;
    fileInputRef.current?.click();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !files.length) return;
    let list = Array.from(files);

    const offenders: Array<{ file: File; reason: 'size' | 'mime' }> = [];
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) offenders.push({ file, reason: 'size' });
      else if (
        !isSupportedMime(file.type) &&
        !hasSupportedDocumentExtension(file.name)
      )
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

    let framesAdded = 0;
    const expanded: File[] = [];
    for (const file of list) {
      expanded.push(file);
      if (inferAttachmentType(file) !== 'video') continue;
      try {
        const result = await extractVideoFrames(file);
        if (!result) continue;
        const baseName = file.name.replace(/\.[^.]+$/, '');
        for (let i = 0; i < result.frames.length; i++) {
          const { blob, t } = result.frames[i];
          const frameName = `${baseName}-frame-${i + 1}-${(t * 10).toFixed(0)}.jpg`;
          expanded.push(new File([blob], frameName, { type: 'image/jpeg' }));
          framesAdded++;
        }
      } catch {
        // ignore — video chip stays on its own
      }
    }
    list = expanded;

    if (list.length > MAX_FILES) {
      toast.error(m['playground.attachment.err_too_many']());
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const fresh = list.filter((f) => {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      return !Array.from(attachments).some(
        (a) =>
          a.filename === f.name &&
          a._size === f.size &&
          a._mtime === f.lastModified
      );
    });
    if (fresh.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const placeholders: Attachment[] = fresh.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        type: inferAttachmentType(file),
        url: previewUrl,
        previewUrl,
        filename: file.name,
        uploadStatus: 'uploading',
        _size: file.size,
        _mtime: file.lastModified,
      };
    });
    setAttachments((prev) => [...prev, ...placeholders]);
    setUploading(true);
    if (fileInputRef.current) fileInputRef.current.value = '';

    void (async () => {
      try {
        const uploaded = await uploadMediaFiles(fresh);
        setAttachments((prev) => {
          const placeholderIds = new Set(placeholders.map((p) => p.id));
          const seen = new Set<string>();
          return prev.map((a) => {
            if (!placeholderIds.has(a.id)) return a;
            const idx = placeholders.findIndex((p) => p.id === a.id);
            const result = uploaded[idx];
            if (!result) return { ...a, uploadStatus: 'error' };
            if (seen.has(result.url)) return { ...a, uploadStatus: 'error' };
            seen.add(result.url);
            return {
              ...a,
              type: result.type,
              url: result.url,
              key: result.key,
              uploadStatus: 'done',
            };
          });
        });
      } catch (err) {
        const msg = (err as Error)?.message || '';
        const key = /Anonymous upload limit/i.test(msg)
          ? 'playground.attachment.err_anon_limit'
          : /Please retry after/i.test(msg)
            ? 'playground.attachment.err_rate_limited'
            : 'playground.attachment.err_upload_failed';
        toast.error(
          m[key]({
            name: fresh.length > 1 ? `${fresh.length} files` : fresh[0].name,
          })
        );
        const placeholderIds = new Set(placeholders.map((p) => p.id));
        setAttachments((prev) =>
          prev.map((a) =>
            placeholderIds.has(a.id) ? { ...a, uploadStatus: 'error' } : a
          )
        );
      } finally {
        setUploading(false);
      }
    })();
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const dropped = prev.find((a) => a.id === id);
      if (dropped?.previewUrl) {
        URL.revokeObjectURL(dropped.previewUrl);
        previewUrlsRef.current.delete(dropped.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  /**
   * Lazily create a chat row on first send (mirrors /settings/chat.tsx).
   * If the user hasn't picked a session, we mint one server-side and then
   * set it as active — sidebar picks it up via the chats list query.
   */
  const newChatMutation = useMutation({
    mutationFn: () => apiPost<{ chat: ChatRow }>('/api/chat', {}),
    onSuccess: (data) => {
      playgroundStore.setActiveChatId(data.chat.id);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  async function handleSend() {
    if (!requireAuth()) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isThinking) return;

    let chatId = activeChatId;
    if (!chatId) {
      // Lazy-create. The mutation's onSuccess will set the id; we then
      // need to read it back from the store before posting the message.
      try {
        const created = await apiPost<{ chat: ChatRow }>('/api/chat', {});
        chatId = created.chat.id;
        playgroundStore.setActiveChatId(chatId);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }

    const userMsg: Message = {
      id: ++idRef.current,
      role: 'user',
      content: text || m['playground.attachment.default_prompt'](),
      attachments: attachments.length ? attachments : undefined,
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
          {
            id: assistantId,
            role: 'assistant',
            content: delta,
          },
        ];
      });
    };

    try {
      await streamChat(
        {
          chatId,
          messages: turns.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          attachments: attachments.map((a) => {
            const {
              previewUrl: _p,
              uploadStatus: _s,
              id: _i,
              _size,
              _mtime,
              ...rest
            } = a;
            return rest;
          }),
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
              {
                id: assistantId,
                role: 'assistant',
                content: body,
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
              },
            ]);
          },
          onDone: () => {
            setIsThinking(false);
          },
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

  // Pass-through to the legacy Composer (re-uses the chat-mode file picker,
  // video-frame extraction, attachment chips). Cleaner than re-implementing.
  const composerProps = {
    input,
    setInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    canSend: !!input.trim() || attachments.length > 0,
    isThinking: isThinking || uploading,
    models: useModels(),
    selected: useModels()[0],
    onSelectModel: () => undefined,
    taRef,
    attachments,
    uploading,
    onPlusClick: openFilePicker,
    onFilesSelected: handleFilesSelected,
    onRemoveAttachment: removeAttachment,
    fileInputRef,
  };

  const hasThread = messages.length > 0 || isThinking;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {hasThread ? (
        <>
          <div
            ref={scrollRef}
            className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <ThreadHeader onReset={clearActive} />
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
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-12">
          <div className="flex w-full max-w-3xl flex-col items-center">
            <WelcomeState selected={composerProps.selected} />
            <div className="mt-10 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}

      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ImageGalleryBackground                                             */
/* ------------------------------------------------------------------ */

/**
 * Community image wall — a user-scrolled packed masonry, matching the
 * reference layout measured from the live site:
 *
 *   viewport 1440 → 5 columns × 232px tiles, 4px gaps
 *   viewport  768 → 3 columns × 165px
 *   viewport  390 → 2 columns × 193px
 *
 * It is NOT an auto-scrolling marquee. Tiles are absolutely positioned
 * inside a `relative` canvas whose height is the tallest packed column,
 * and the user scrolls the track natively (no Lenis, no scroll-snap).
 *
 * Packing is shortest-column-first (greedy): each tile lands in whichever
 * column is currently shortest, which is what produces the ragged,
 * gapless brick rhythm rather than the rigid rows a CSS grid would give.
 *
 * Tiles have 0 border-radius and no filter/blend-mode — the reference
 * renders images clean and lets them butt together. The only decoration
 * is a per-tile hover scrim (`bg-black/0 → bg-black/20`, 300ms) with a
 * centered action icon.
 *
 * Source: 46 images downloaded to `/public/gallery/` (served same-origin
 * to sidestep the page's CSP `img-src` allowlist):
 *   - `poll-*.jpg` — real AI-generated images from Pollinations (flux
 *     model), each prompted for an abstract / glowing / luminous look
 *     (iridescent swirls, plasma orbs, gradient meshes, neon wisps,
 *     bokeh, vaporwave chrome, kaleidoscope, volumetric smoke, …).
 *   - `u-*.jpg` — abstract / gradient / liquid photos from Unsplash to
 *     fill out the wall with photographic texture between the AI tiles.
 *
 * Each tile is assigned one of the reference's aspect ratios (2:3 dominates,
 * then 9:16 / 3:2 / 16:9 / 4:5 / 1:1) so the packed rhythm matches.
 */
const POLL_PROMPTS = [
  'iridescent swirls',
  'plasma orb',
  'gradient mesh',
  'light particles',
  'liquid metal',
  'neon wisps',
  'aurora swirl',
  'chrome reflection',
  'light painting',
  'kaleidoscope',
  'volumetric smoke',
  'bokeh sphere',
  'soft glow orbs',
  'energy field',
  'neon particle',
  'pastel cloud',
  'crystal facets',
  'light streaks',
  'holographic foil',
  'golden bokeh',
  'plasma tendrils',
  'watercolor splash',
  'neon glass',
  'light rays fog',
  'mint gradient',
  'metallic texture',
  'particle dust',
  'aurora sky',
  'silk fabric',
];

type Tile = { src: string; ratio: number; alt: string };

// Aspect-ratio mix measured off the reference wall (32× 2:3, 6× 9:16,
// 4× 3:2, 2× 16:9, 1× 4:5, 1× 1:1 across 47 tiles). Cycled over the
// catalog so the packed layout gets the same tall/short rhythm.
const TILE_RATIOS = [
  2 / 3,
  2 / 3,
  9 / 16,
  2 / 3,
  2 / 3,
  3 / 2,
  2 / 3,
  2 / 3,
  4 / 5,
  2 / 3,
  9 / 16,
  2 / 3,
  2 / 3,
  16 / 9,
  2 / 3,
  1,
  2 / 3,
  3 / 2,
];

// Catalog enumerated by the file ranges we know we downloaded. Gaps
// in the actual file set (a poll that 404'd) are caught by the img
// `onError` handler below — the broken <img> hides itself instead of
// leaving a hollow tile.
const GALLERY_ITEMS: Tile[] = (() => {
  const items: Tile[] = [];
  for (let i = 0; i < POLL_PROMPTS.length; i++) {
    items.push({
      src: `/gallery/poll-${String(i).padStart(2, '0')}.jpg`,
      ratio: 0,
      alt: POLL_PROMPTS[i],
    });
  }
  // Explicit list — the u-* range has gaps (24, 25, 30-34 were never
  // downloaded), and in a packed masonry a missing tile leaves a hole
  // rather than just a blank image.
  for (const i of [
    12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27, 28, 29, 35,
  ]) {
    items.push({
      src: `/gallery/u-${String(i).padStart(2, '0')}.jpg`,
      ratio: 0,
      alt: 'abstract',
    });
  }
  // Interleave poll/unsplash so AI tiles and photo tiles alternate, then
  // stamp the ratio cycle on the interleaved order.
  const half = Math.ceil(items.length / 2);
  const mixed: Tile[] = [];
  for (let i = 0; i < half; i++) {
    if (items[i]) mixed.push(items[i]);
    if (items[half + i]) mixed.push(items[half + i]);
  }
  return mixed.map((t, i) => ({
    ...t,
    ratio: TILE_RATIOS[i % TILE_RATIOS.length],
  }));
})();

// Column count per breakpoint, measured off the reference.
const GALLERY_GAP = 4;
function columnsForWidth(w: number) {
  if (w >= 1024) return 5;
  if (w >= 640) return 3;
  return 2;
}

type PlacedTile = Tile & {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Greedy shortest-column-first packing. Returns absolute pixel positions
 * plus the canvas height (the tallest column), which the caller sets on
 * the `relative` container so the scroll track gets the right extent.
 */
function packMasonry(
  items: Tile[],
  containerWidth: number,
  columnCount: number,
  gap: number
): { tiles: PlacedTile[]; height: number } {
  if (containerWidth <= 0 || columnCount <= 0) return { tiles: [], height: 0 };

  const colWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  const heights = new Array<number>(columnCount).fill(0);
  const tiles: PlacedTile[] = [];

  for (const item of items) {
    // shortest column wins; ties go to the leftmost
    let target = 0;
    for (let c = 1; c < columnCount; c++) {
      if (heights[c] < heights[target] - 0.01) target = c;
    }
    const height = Math.round(colWidth / item.ratio);
    tiles.push({
      ...item,
      left: Math.round(target * (colWidth + gap)),
      top: Math.round(heights[target]),
      width: Math.round(colWidth),
      height,
    });
    heights[target] += height + gap;
  }

  return { tiles, height: Math.ceil(Math.max(...heights) - gap) };
}

function GalleryWall() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [columnCount, setColumnCount] = useState(5);

  // Measure the wall's own width (not the window) so the packing stays
  // correct when the sidebar collapses/expands.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setWidth(w);
      setColumnCount(columnsForWidth(window.innerWidth));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const { tiles, height } = packMasonry(
    GALLERY_ITEMS,
    width,
    columnCount,
    GALLERY_GAP
  );

  return (
    <div ref={hostRef} className="relative w-full" style={{ height }}>
      {tiles.map((tile, i) => (
        <div
          key={`${tile.src}-${i}`}
          data-gallery-tile
          className="absolute cursor-pointer overflow-hidden"
          style={{
            left: tile.left,
            top: tile.top,
            width: tile.width,
            height: tile.height,
          }}
        >
          <div className="group/card relative size-full">
            <img
              src={tile.src}
              alt={tile.alt}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                // Hide tiles that point at a file we didn't actually
                // download (the catalog enumerates a range; some slots
                // in that range are gaps from earlier 404s).
                const wrapper = e.currentTarget.closest<HTMLElement>(
                  '[data-gallery-tile]'
                );
                if (wrapper) wrapper.style.display = 'none';
                else e.currentTarget.style.display = 'none';
              }}
              className="absolute inset-0 size-full object-cover"
            />
            {/* Hover scrim + centered action affordance. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover/card:bg-black/20">
              <Sparkles className="size-6 text-white opacity-0 transition-opacity duration-300 group-hover/card:opacity-90" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ImagePlayground                                                    */
/* ------------------------------------------------------------------ */

/**
 * Image generation tab. txt2img + img2img (reference upload). Submits to
 * `POST /api/ai-tasks` with `mediaType: 'image'`, then polls
 * `GET /api/ai-tasks/$id` every 2s until the task is terminal.
 *
 * Cost is fixed by server config (`image_credit_cost`, default 5). Result
 * image URLs come back via the persisted `taskResult` JSON, parsed by
 * `parseThumbnail` in the route's GET handler.
 *
 * Layout is the community image wall (`GalleryWall`) filling the page, with
 * a floating segmented tab bar on top and a glass composer floating at the
 * bottom — the generation form is the composer, not a separate panel.
 */
/**
 * Display-decoration registry for image models. The picker combines this
 * with the gateway's `/v1/models` listing: anything the gateway serves gets
 * a row, and we look up its pretty name, icon, vendor badge, and tagline
 * here. Unknown ids fall back to the raw id so newly-added models still
 * appear.
 *
 * Match keys are lowercased substrings, so the same row covers `seedream-5.0`
 * and `doubao-seedream-5.0-pro` without duplicating entries.
 */
type ImageModelBadge = 'Pro' | 'Lite' | 'New';

interface ImageModelMeta {
  /** Regex anchored on the lowercased id. */
  test: RegExp;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Vendor — drives the section header + the icon-chip gradient. */
  vendor: ImageVendor;
  /** Optional one-line tagline shown under the model name. */
  desc: string;
  /** Optional small sub-label rendered as a gradient pill on the right. */
  badge?: ImageModelBadge;
  /** Sort weight within the vendor section (lower = top). */
  weight?: number;
}

type ImageVendor =
  | 'ByteDance'
  | 'Google'
  | 'OpenAI'
  | 'Alibaba'
  | 'Black Forest Labs'
  | 'xAI'
  | 'Other';

interface VendorTheme {
  /** Section header label. */
  label: string;
  /** Gradient class for the icon chip. */
  chip: string;
  /** Glyph rendered above the vendor label (optional). */
  mark?: string;
}

const VENDOR_THEME: Record<ImageVendor, VendorTheme> = {
  ByteDance: {
    label: 'ByteDance',
    chip: 'from-cyan-500 via-sky-500 to-blue-600',
  },
  Google: {
    label: 'Google',
    chip: 'from-violet-500 via-fuchsia-500 to-rose-500',
  },
  OpenAI: {
    label: 'OpenAI',
    chip: 'from-emerald-500 via-teal-500 to-cyan-600',
  },
  Alibaba: {
    label: 'Alibaba',
    chip: 'from-orange-500 via-amber-500 to-red-500',
  },
  'Black Forest Labs': {
    label: 'Black Forest Labs',
    chip: 'from-fuchsia-500 via-purple-500 to-indigo-600',
  },
  xAI: { label: 'xAI', chip: 'from-zinc-700 via-zinc-800 to-black' },
};

const IMAGE_MODEL_META: ImageModelMeta[] = [
  // ── ByteDance (Seedream) ───────────────────────────────────────────────
  {
    test: /doubao-seedream-5\.0-pro/,
    name: 'Seedream 5.0 Pro',
    icon: Sparkles,
    vendor: 'ByteDance',
    badge: 'Pro',
    desc: 'Top-tier detail, photoreal portraits',
    weight: 0,
  },
  {
    test: /doubao-seedream-5\.0-lite/,
    name: 'Seedream 5.0 Lite',
    icon: Sparkles,
    vendor: 'ByteDance',
    badge: 'Lite',
    desc: 'Fast Seedream, budget-friendly',
    weight: 1,
  },
  {
    test: /doubao-seedream-4\.5/,
    name: 'Seedream 4.5',
    icon: Sparkles,
    vendor: 'ByteDance',
    desc: 'Latest 4.x release, balanced quality',
    weight: 2,
  },
  {
    test: /doubao-seedream-4\.0/,
    name: 'Seedream 4.0',
    icon: Sparkles,
    vendor: 'ByteDance',
    desc: 'Stable workhorse, broad style range',
    weight: 3,
  },
  {
    test: /doubao-seedream-3\.0/,
    name: 'Seedream 3.0',
    icon: Sparkles,
    vendor: 'ByteDance',
    desc: 'Classic generation, vector-clean',
    weight: 4,
  },
  {
    test: /seedream-5/,
    name: 'Seedream 5.0',
    icon: Sparkles,
    vendor: 'ByteDance',
    badge: 'Pro',
    desc: 'Generic Seedream 5.0',
    weight: 5,
  },

  // ── Google (Gemini + Nano Banana) ──────────────────────────────────────
  {
    test: /gemini-3(\.1)?-flash-image/,
    name: 'Gemini 3.1 Flash Image',
    icon: Wand2,
    vendor: 'Google',
    badge: 'Pro',
    desc: 'Fast reasoning-image generation',
    weight: 0,
  },
  {
    test: /gemini-2\.5-flash-image/,
    name: 'Gemini 2.5 Flash Image',
    icon: Wand2,
    vendor: 'Google',
    badge: 'Pro',
    desc: 'Proven, fast, broad coverage',
    weight: 1,
  },
  {
    test: /gemini-3-pro-image/,
    name: 'Gemini 3 Pro Image',
    icon: Wand2,
    vendor: 'Google',
    badge: 'Pro',
    desc: 'High-fidelity, complex prompts',
    weight: 2,
  },
  {
    test: /nano-banana-pro-beta/,
    name: 'Nano Banana Pro',
    icon: BananaIcon,
    vendor: 'Google',
    badge: 'Pro',
    desc: 'Stylized, character-friendly',
    weight: 3,
  },
  {
    test: /nano-banana-2-lite/,
    name: 'Nano Banana 2 Lite',
    icon: BananaIcon,
    vendor: 'Google',
    badge: 'Lite',
    desc: 'Quick generations, low cost',
    weight: 4,
  },
  {
    test: /nano-banana-2-beta/,
    name: 'Nano Banana 2',
    icon: BananaIcon,
    vendor: 'Google',
    badge: 'New',
    desc: 'Latest fast variant',
    weight: 5,
  },
  {
    test: /nano-banana-beta/,
    name: 'Nano Banana',
    icon: BananaIcon,
    vendor: 'Google',
    badge: 'Pro',
    desc: 'Stylized, character-friendly',
    weight: 6,
  },

  // ── OpenAI (GPT image) ─────────────────────────────────────────────────
  {
    test: /gpt-image-2/,
    name: 'GPT Image 2',
    icon: Bot,
    vendor: 'OpenAI',
    badge: 'Pro',
    desc: 'OpenAI flagship, instruction-tuned',
    weight: 0,
  },
  {
    test: /gpt-4o-image/,
    name: 'GPT-4o Image',
    icon: Bot,
    vendor: 'OpenAI',
    badge: 'Pro',
    desc: 'Native multimodal image output',
    weight: 1,
  },
  {
    test: /gpt-image-1\.5/,
    name: 'GPT Image 1.5',
    icon: Bot,
    vendor: 'OpenAI',
    desc: 'Stable 1.5 generation',
    weight: 2,
  },
  {
    test: /gpt-image-1\.5-lite/,
    name: 'GPT Image 1.5 Lite',
    icon: Bot,
    vendor: 'OpenAI',
    badge: 'Lite',
    desc: 'Fast small variant',
    weight: 3,
  },

  // ── Alibaba (Qwen + Wan + Z-Image) ────────────────────────────────────
  {
    test: /wan2\.5-text-to-image/,
    name: 'Wan 2.5 T2I',
    icon: ImageIcon,
    vendor: 'Alibaba',
    badge: 'New',
    desc: 'Cinematic, long-context text-to-image',
    weight: 0,
  },
  {
    test: /z-image-turbo/,
    name: 'Z-Image Turbo',
    icon: ImageIcon,
    vendor: 'Alibaba',
    badge: 'New',
    desc: 'Sub-second, real-time capable',
    weight: 1,
  },
  {
    test: /qwen-image-edit-plus/,
    name: 'Qwen Image Edit Plus',
    icon: ImageIcon,
    vendor: 'Alibaba',
    badge: 'Pro',
    desc: 'Image-edit, ref image required',
    weight: 2,
  },
  {
    test: /qwen-image-edit/,
    name: 'Qwen Image Edit',
    icon: ImageIcon,
    vendor: 'Alibaba',
    desc: 'Image-edit, ref image required',
    weight: 3,
  },
  {
    test: /wan2\.5-image-to-image/,
    name: 'Wan 2.5 I2I',
    icon: ImageIcon,
    vendor: 'Alibaba',
    desc: 'Image-edit, ref image required',
    weight: 4,
  },

  // ── Black Forest Labs (Flux) ───────────────────────────────────────────
  {
    test: /flux-kontext-pro/,
    name: 'Flux Kontext Pro',
    icon: Triangle,
    vendor: 'Black Forest Labs',
    badge: 'Pro',
    desc: 'In-context variant, precise style',
    weight: 0,
  },
  {
    test: /flux-kontext/,
    name: 'Flux Kontext',
    icon: Triangle,
    vendor: 'Black Forest Labs',
    desc: 'In-context variant, broad usage',
    weight: 1,
  },

  // ── xAI (Grok) ─────────────────────────────────────────────────────────
  {
    test: /grok-imagine/,
    name: 'Grok Imagine Image',
    icon: Circle,
    vendor: 'xAI',
    desc: 'xAI image generation',
    weight: 0,
  },
];

function resolveImageModelMeta(id: string): ImageModelMeta {
  const lower = id.toLowerCase();
  const hit = IMAGE_MODEL_META.find((m) => m.test.test(lower));
  if (hit) return hit;
  // Default — unknown model still appears; render with a generic sparkle
  // and group under "Other" so the user can pick it.
  return {
    test: /^.*$/,
    name: id,
    icon: Sparkles,
    vendor: 'Other',
    desc: id,
    weight: 99,
  };
}

const OTHER_VENDOR_THEME: VendorTheme = {
  label: 'Other',
  chip: 'from-zinc-400 to-zinc-600',
};

/**
 * Banana emoji stand-in. Lucide doesn't ship a banana icon, so we drop a
 * tiny inline SVG that mimics the 🍌 outline; keeps the picker monochrome
 * (no emoji-rendering quirks across OSes) and the badge font-weight
 * consistent with the rest of the menu.
 */
function BananaIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 3c.5 0 .9.4 1 .9.2 1.1.7 2.2 1.5 3.2-1.4-.6-2.9-.9-4.4-.9-.6 0-1 .4-1 1 0 .3.1.6.3.8 2.9 3.1 4.5 6.7 4.5 10.5 0 3.6 2.9 6.5 6.5 6.5s6.5-2.9 6.5-6.5c0-7.5-6.1-13.5-13.5-13.5-.6 0-1 .4-1 1 0 .3.1.6.3.8.2.2.4.3.7.3.5 0 .9-.4 1-.9z" />
    </svg>
  );
}

// Number of images to generate per submit. 1-4 — mirrors OpenAI's
// `n` parameter and most provider implementations. Each image costs
// the same number of credits, so the cost label multiplies by this.
const IMAGE_COUNTS = [1, 2, 3, 4] as const;
type ImageCount = (typeof IMAGE_COUNTS)[number];

// Aspect ratio palette. Includes a "Smart" entry that lets the model
// pick (default behaviour for most providers that don't honour the
// hint). The other entries are the common photo + video-friendly
// ratios, ordered roughly by usage.
type AspectRatio = {
  value: string; // value sent to the provider (or '' for smart)
  label: string; // label shown in the menu
  preview: string; // CSS clip-path / inline-block for the swatch
};
const ASPECT_RATIOS: AspectRatio[] = [
  { value: '', label: 'Smart', preview: '50%' },
  { value: '1:1', label: '1 : 1', preview: '100%' },
  { value: '16:9', label: '16 : 9', preview: '56%' },
  { value: '9:16', label: '9 : 16', preview: '178%' },
  { value: '4:3', label: '4 : 3', preview: '75%' },
  { value: '3:4', label: '3 : 4', preview: '133%' },
  { value: '3:2', label: '3 : 2', preview: '67%' },
  { value: '2:3', label: '2 : 3', preview: '150%' },
  { value: '2:1', label: '2 : 1', preview: '50%' },
  { value: '1:2', label: '1 : 2', preview: '200%' },
  { value: '20:9', label: '20 : 9', preview: '45%' },
  { value: '9:20', label: '9 : 20', preview: '222%' },
];

// Inline mini-swatch that mirrors the chosen ratio so the trigger
// label and the menu row line up visually.
function RatioSwatch({ value, size = 16 }: { value: string; size?: number }) {
  if (!value) {
    // Smart — show a sparkle so users know it's a special "let model decide" state.
    return (
      <span
        className="bg-foreground/10 text-muted-foreground inline-flex items-center justify-center rounded-[3px]"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Sparkles className="size-2.5" />
      </span>
    );
  }
  const [w, h] = value.split(':').map((n) => Number(n));
  if (!w || !h) return null;
  // Fit the swatch inside a square of `size`, preserving aspect.
  const aspect = w / h;
  let sw: number;
  let sh: number;
  if (aspect >= 1) {
    sw = size;
    sh = Math.max(2, Math.round(size / aspect));
  } else {
    sh = size;
    sw = Math.max(2, Math.round(size * aspect));
  }
  return (
    <span
      className="border-foreground/30 inline-block rounded-[3px] border"
      style={{ width: sw, height: sh }}
      aria-hidden
    />
  );
}

/**
 * Image count picker — 1 to 4 images per submit. Each image costs
 * the same number of credits, so the toolbar cost label multiplies
 * by this value.
 */
function ImageCountMenu({
  value,
  onChange,
}: {
  value: ImageCount;
  onChange: (n: ImageCount) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
        aria-label={m['playground.image.count_label']()}
      >
        ×{value}
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
        <p className="text-foreground/40 px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
          {m['playground.image.count_label']()}
        </p>
        {IMAGE_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            // Pick → close the popover so the toolbar returns to its
            // resting state (matches ImageModelMenu below).
            onClick={() => {
              onChange(n);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'hover:bg-foreground/5'
            )}
          >
            <span className="font-mono text-xs">×{n}</span>
            <span className="text-muted-foreground text-xs">
              {n === 1
                ? m['playground.image.count_one']()
                : m['playground.image.count_many']({ count: n })}
            </span>
            {n === value ? (
              <Check className="text-foreground ml-auto size-3.5" />
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Aspect ratio picker — 12 options including "Smart" (let the model
 * decide). The chosen ratio is sent to the provider via `size` so the
 * output dimensions match the user's intent.
 */
function AspectRatioMenu({
  value,
  onChange,
}: {
  value: string; // '' = Smart
  onChange: (ratio: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
        aria-label={m['playground.image.aspect_label']()}
      >
        <RatioSwatch value={value} size={14} />
        <span className="font-mono">
          {value
            ? value.replace(':', ' : ')
            : m['playground.image.aspect_smart']()}
        </span>
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        <p className="text-foreground/40 px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
          {m['playground.image.aspect_label']()}
        </p>
        <div className="max-h-72 overflow-y-auto">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.value || 'smart'}
              type="button"
              // Pick → close so the menu doesn't linger after the choice.
              // The trigger chevron also flips on `open`, giving the user
              // a visual cue the popover has actually dismissed.
              onClick={() => {
                onChange(r.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                'hover:bg-foreground/5'
              )}
            >
              <RatioSwatch value={r.value} size={16} />
              <span className="font-mono text-xs">{r.label}</span>
              {r.value === value ? (
                <Check className="text-foreground ml-auto size-3.5" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Menu-style image model picker for the composer toolbar.
 *
 * Combines the gateway's `/v1/models` listing with a local display-name
 * registry so each row reads as a brand chip (gradient icon + name +
 * one-line tagline + Pro/Lite badge) instead of a raw id. Rows are
 * grouped by vendor so the user can scan a long list by ecosystem.
 * Includes a search box at the top.
 */
function ImageModelMenu({
  models,
  selected,
  onSelect,
}: {
  models: string[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Decorate the gateway ids with display data.
  const rows = models.map((id) => {
    const meta = resolveImageModelMeta(id);
    return {
      id,
      name: meta.name,
      icon: meta.icon,
      vendor: meta.vendor,
      desc: meta.desc,
      badge: meta.badge,
      weight: meta.weight ?? 99,
    };
  });

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.vendor.toLowerCase().includes(q) ||
          r.desc.toLowerCase().includes(q)
      )
    : rows;

  // Group by vendor, preserve the order in which we first see a vendor so
  // the section list reads in the order the gateway exposes them.
  const grouped = new Map<ImageVendor, typeof rows>();
  for (const r of filtered) {
    if (!grouped.has(r.vendor)) grouped.set(r.vendor, []);
    grouped.get(r.vendor)!.push(r);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.weight - b.weight);
  }

  // Trigger label — show the selected model's display name (not raw id)
  // so the chrome reads as a brand pick.
  const selectedMeta = resolveImageModelMeta(selected);
  const SelectedIcon = selectedMeta.icon;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      {/*
        Trigger is a softer pill: muted surface background so it sits in
        the toolbar without competing with the submit button, plus a
        colored brand icon chip so the active model still reads at a
        glance. Tradeoff vs. solid dark: less weight, more "chip" feel.
      */}
      <PopoverTrigger
        className={cn(
          'inline-flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5',
          'bg-foreground/[0.06] text-foreground/80 border-foreground/10 border',
          'hover:bg-foreground/[0.09] hover:text-foreground transition-colors',
          open && 'bg-foreground/[0.09] text-foreground'
        )}
        aria-label={m['playground.image.model_label']()}
      >
        <span
          className="text-foreground/55 flex size-5 shrink-0 items-center justify-center"
          aria-hidden
        >
          <SelectedIcon className="size-4" strokeWidth={2} />
        </span>
        <span className="text-sm font-medium tracking-tight">
          {selectedMeta.name}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 opacity-60 transition-transform',
            open && 'rotate-180'
          )}
        />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[360px] p-0">
        {/* Sticky header: search + section label */}
        <div className="bg-popover sticky top-0 z-10 space-y-2 rounded-t-xl p-2.5 pb-2">
          <div className="bg-foreground/5 border-foreground/5 flex items-center gap-2 rounded-lg border px-3 py-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m['playground.image.model_search_placeholder']()}
              className="placeholder:text-muted-foreground/70 text-foreground w-full bg-transparent text-sm outline-none"
            />
          </div>
          <p className="text-foreground/40 px-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
            {m['playground.image.model_label']()}
          </p>
        </div>

        <div className="max-h-[420px] overflow-y-auto px-1.5 pb-2">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground/70 px-2 py-6 text-center text-sm">
              {m['playground.image.model_empty']()}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([vendor, list]) => {
              const theme = VENDOR_THEME[vendor] ?? OTHER_VENDOR_THEME;
              return (
                <div key={vendor} className="mb-3">
                  <div className="text-foreground/40 bg-popover/85 sticky top-0 z-[5] px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase backdrop-blur-sm">
                    {theme.label}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((r) => {
                      const active = r.id === selected;
                      const Icon = r.icon;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            onSelect(r.id);
                            setOpen(false);
                          }}
                          className={cn(
                            'group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                            'hover:bg-foreground/[0.04]',
                            active && 'bg-foreground/[0.06]'
                          )}
                        >
                          {active ? (
                            <span className="brand-gradient absolute inset-y-2 left-0 w-0.5 rounded-full" />
                          ) : null}
                          <div
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-xs',
                              theme.chip
                            )}
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'truncate text-sm',
                                  active ? 'font-semibold' : 'font-medium'
                                )}
                              >
                                {r.name}
                              </span>
                              {r.badge ? (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                                    r.badge === 'Pro'
                                      ? 'brand-gradient text-white'
                                      : r.badge === 'New'
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-foreground/8 text-foreground/60'
                                  )}
                                >
                                  {r.badge === 'Pro' ? (
                                    <Crown className="size-2.5" />
                                  ) : null}
                                  {r.badge}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-foreground/45 mt-0.5 truncate text-xs">
                              {r.desc}
                            </p>
                          </div>
                          {active ? (
                            <Check className="text-foreground/70 size-4 shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const GALLERY_TABS = [
  {
    id: 'community' as const,
    icon: LayoutGrid,
    label: () => m['playground.image.tab_community'](),
  },
  {
    id: 'mine' as const,
    icon: ImageIcon,
    label: () => m['playground.image.tab_my_images'](),
  },
];

/**
 * User's own generated images laid out as a packed masonry. Each tile
 * records its own `naturalWidth / naturalHeight` once the image loads;
 * without that we default to a square so the layout settles fast and
 * re-flows as the real aspect comes in.
 *
 * Clicking a tile sets the active image id (same affordance as the
 * sidebar history list), so the existing download bar at the top of
 * the My Images tab continues to work.
 */

/**
 * User's own generated images as a tidy equal-height grid.
 *
 * Picked fixed tile height + `object-cover` so the row is flush
 * regardless of source aspect ratios (community-wall masonry would
 * leave ragged bottoms on a 1:1 + 1:1.4 mix). Each tile is a Link
 * to `/api-playground/image/$id` so the user gets a real page —
 * shareable URL, browser back button works, full-size image + the
 * download button on the right.
 */
function MyImageMasonry({
  rows,
  onSelect,
}: {
  rows: ImageTaskRow[];
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="border-border bg-card/40 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center">
        <SparklesIcon className="text-foreground/30 size-10" />
        <p className="text-muted-foreground text-sm">
          {m['playground.image.result_empty']()}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {rows.map((r) => {
        const url = r.thumbnailUrl;
        if (!url) return null;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className="group bg-foreground/5 hover:ring-foreground/30 relative aspect-square w-full overflow-hidden rounded-xl hover:ring-2"
          >
            <img
              src={url}
              alt={r.prompt || 'Generated image'}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              className="absolute inset-0 size-full object-cover"
            />
            {/* Hover overlay — magnifier + prompt preview. Kept
                subtle so the grid still reads as a grid at rest. */}
            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
              <p className="line-clamp-2 p-3 text-xs text-white">{r.prompt}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ImagePlayground() {
  const store = usePlaygroundStore();
  const { activeImageId } = store;
  const { data: session } = useSession();

  const [tab, setTab] = useState<'community' | 'mine'>('community');
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [prompt, setPrompt] = useState('');
  // Reference images for img2img. Up to MAX_REFERENCES images; the
  // server picks the first one for the request body. Each chip has its
  // own note input so the user can describe what that specific image
  // represents ("图1 是海", "图3 是山").
  const [references, setReferences] = useState<
    Array<{
      url: string;
      previewUrl: string;
      filename: string;
      note: string;
    }>
  >([]);
  const MAX_REFERENCES = 10;
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [uploadingReference, setUploadingReference] = useState(false);
  // null = "use whatever the server default is". Only set once the user
  // explicitly picks a model, so the composer works before the model
  // list resolves (or when Evolink isn't configured at all).
  const [model, setModel] = useState<string | null>(null);
  // 1-4 images per submit. Default 1 — most callers want a single
  // generation. Multi-image batches cost N credits.
  const [imageCount, setImageCount] = useState<ImageCount>(1);
  // Aspect ratio ('' = Smart — let the model decide). Default Smart
  // because every provider we've wired supports a default size and
  // most users don't know they need to pick a ratio up front.
  const [aspectRatio, setAspectRatio] = useState<string>('');
  // My Images tab — clicking a tile routes to the dedicated preview
  // page at /api-playground/image/$id rather than opening an overlay,
  // so the URL is shareable and back-navigation works.
  const navigate = useNavigate();

  // Models this deployment's Evolink key actually serves. Cached an hour
  // server-side, so this is cheap; `staleTime` keeps it out of refetches.
  const modelsQuery = useQuery({
    queryKey: ['image-models'],
    queryFn: () =>
      apiGet<{ models: string[]; defaultModel: string }>(
        '/api/ai-tasks/image-models'
      ),
    staleTime: 60 * 60 * 1000,
  });
  const availableModels = modelsQuery.data?.models ?? [];
  const activeModel = model ?? modelsQuery.data?.defaultModel ?? null;

  // The user's own generated images, newest first. Same endpoint the
  // sidebar list uses; we just consume it here for the My Images tab
  // waterfall.
  const myImagesQuery = useQuery({
    queryKey: ['image-tasks', 'mine'],
    queryFn: () =>
      apiGet<{ tasks: ImageTaskRow[] }>(
        '/api/ai-tasks?mediaType=image&limit=50'
      ),
    // Only fetch when the user actually opens the My Images tab.
    enabled: tab === 'mine',
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const taskQuery = useQuery({
    queryKey: ['image-task', activeImageId],
    queryFn: () => apiGet<{ task: any }>(`/api/ai-tasks/${activeImageId}`),
    enabled: !!activeImageId,
  });

  // Poll the active task until it reaches a terminal status. Adaptive
  // backoff: poll fast for the first few seconds (most images land in
  // 10-30s) and slow down to a 2.5s tail so we still catch stragglers
  // without hammering the server. Capped at 60 attempts (~2 min) so a
  // stuck task doesn't burn request budget forever; the sidebar list
  // keeps the task visible so the user can re-open it.
  useEffect(() => {
    if (!pollingTaskId) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;

    const nextDelay = (n: number) => {
      // First 6 polls: 600ms apart (covers the typical fast path).
      // Next 14: 1.2s. After that: 2.5s.
      if (n <= 6) return 600;
      if (n <= 20) return 1200;
      return 2500;
    };

    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const r = await apiGet<{ status: string }>(
          `/api/ai-tasks/${pollingTaskId}`
        );
        if (r.status === 'success' || r.status === 'failed') {
          queryClient.invalidateQueries({ queryKey: ['image-tasks'] });
          queryClient.invalidateQueries({
            queryKey: ['image-task', pollingTaskId],
          });
          queryClient.invalidateQueries({
            queryKey: ['image-tasks', 'mine'],
          });
          setPollingTaskId(null);
          return;
        }
      } catch {
        // network blip — keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        setPollingTaskId(null);
        toast.error('Image generation timed out — check sidebar for status.');
        return;
      }
      setTimeout(tick, nextDelay(attempts));
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [pollingTaskId, queryClient]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Build a single prompt that names each reference by index
      // ("图1 是海, 图2 是天空") so the model can route which
      // attached image to use for which element. Untyped references
      // still get a "图N" line so the model knows their order.
      const typedRefs = references.filter((r) => r.note.trim());
      const refsBlock = references.length
        ? references
            .map((r, i) => {
              const n = i + 1;
              const note = r.note.trim();
              return note ? `图${n}: ${note}` : `图${n} (参考图 ${n})`;
            })
            .join(', ')
        : '';
      const body: Record<string, any> = {
        mediaType: 'image',
        prompt: (() => {
          const main = prompt.trim();
          if (!refsBlock) return main;
          if (!main) return refsBlock;
          return `${refsBlock}\n\n${main}`;
        })(),
      };
      if (references[0]?.url) body.referenceUrl = references[0].url;
      // Only send an explicit pick; the server allowlists it and falls
      // back to its own default when omitted.
      if (model) body.model = model;
      // Image count + ratio. Server treats an omitted ratio as
      // "let the provider decide"; we don't trim that here so the
      // default branch in evolink-image.ts is taken.
      body.n = imageCount;
      if (aspectRatio) body.size = aspectRatio.replace(':', 'x');
      return apiPost<{ taskId: string; status: string }>('/api/ai-tasks', body);
    },
    onSuccess: (data) => {
      setPollingTaskId(data.taskId);
      store.setActiveImageId(data.taskId);
      setPrompt('');
      // Stay on the user's current tab (Community or My Images) — no
      // forced switch. The user expects to remain on the page they were
      // looking at when they hit generate, and the new image shows up in
      // the sidebar either way.
      // keep reference for the next image — many users iterate on the same ref
      queryClient.invalidateQueries({ queryKey: ['image-tasks'] });
    },
    onError: (e: Error) => {
      const msg = e.message || '';
      const key = /insufficient/i.test(msg)
        ? 'playground.image.error_insufficient_credits'
        : /not configured/i.test(msg)
          ? 'playground.image.error_no_provider'
          : null;
      toast.error(key ? m[key]() : msg);
    },
  });

  async function handleReferenceUpload(files: FileList | null) {
    if (!files?.length) return;
    if (!session?.user) {
      setAuthOpen(true);
      return;
    }
    // Filter to image types only and respect the 10-image cap. Surplus
    // files are silently dropped with a toast so the user knows we
    // didn't add them all.
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        toast.error(
          m['playground.attachment.err_unsupported']({ name: f.name })
        );
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(m['playground.attachment.err_too_large']({ name: f.name }));
        continue;
      }
      if (references.length + accepted.length >= MAX_REFERENCES) {
        toast.error(
          m['playground.attachment.err_too_many_refs']({
            max: MAX_REFERENCES,
          })
        );
        break;
      }
      accepted.push(f);
    }
    if (!accepted.length) return;

    setUploadingReference(true);
    // Issue the upload first so we can show the remote URL alongside
    // the local object-URL preview; on failure we drop the preview.
    let uploaded: { url: string }[] = [];
    try {
      uploaded = await uploadMediaFiles(accepted);
    } catch (err) {
      toast.error((err as Error).message);
      setUploadingReference(false);
      return;
    }
    const newOnes = accepted.map((f, i) => ({
      url: uploaded[i]?.url ?? '',
      previewUrl: URL.createObjectURL(f),
      filename: f.name,
      note: '',
    }));
    setReferences((prev) => [...prev, ...newOnes]);
    setUploadingReference(false);
  }

  function handleReferencePaste(e: React.ClipboardEvent) {
    const images = imageFilesFromClipboard(e.clipboardData);
    if (!images.length) return;
    e.preventDefault();
    const dt = new DataTransfer();
    for (const f of images) dt.items.add(f);
    handleReferenceUpload(dt.files);
  }

  // Resolve the active task's first image URL for the "Active image" panel.
  const activeTask = taskQuery.data?.task;
  const activeResultUrl = (() => {
    if (!activeTask) return null;
    try {
      const raw = activeTask.taskResult;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!r) return null;
      if (Array.isArray(r.imageUrls) && r.imageUrls[0]) return r.imageUrls[0];
      if (Array.isArray(r.images) && r.images[0]) {
        const first = r.images[0];
        return typeof first === 'string' ? first : first?.url;
      }
      if (typeof r.imageUrl === 'string') return r.imageUrl;
      if (typeof r.url === 'string') return r.url;
    } catch {
      // ignore parse error
    }
    return null;
  })();

  const showResult = !!activeImageId;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* Floating segmented tab bar — sits above the wall, centered. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
        <div className="bg-sidebar/80 pointer-events-auto relative inline-flex h-10 items-center rounded-3xl px-1 backdrop-blur-sm select-none">
          {GALLERY_TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative z-10 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-3xl px-3.5 text-sm font-medium transition-colors outline-none',
                  active
                    ? 'text-foreground bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <t.icon className="size-4" />
                {t.label()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scroll track. `pb-32` clears the floating composer; the scrollbar
          is hidden and overscroll contained, matching the reference. */}
      <div className="flex-1 overflow-hidden">
        <div className="no-scrollbar h-full overflow-y-auto overscroll-y-none pb-32">
          {tab === 'community' ? (
            <div className="min-h-full">
              <GalleryWall />
              {/* CTA end-cap — the payoff after scrolling the wall. */}
              <div className="flex flex-col items-center px-4 py-20">
                <p className="text-foreground text-center text-2xl font-bold tracking-tight sm:text-3xl">
                  {m['playground.image.wall_cta_title']()}
                </p>
                <p className="text-muted-foreground mt-3 max-w-xs text-center text-sm leading-relaxed">
                  {m['playground.image.wall_cta_sub']()}
                </p>
                <button
                  type="button"
                  onClick={() => promptRef.current?.focus()}
                  className="border-border bg-background hover:bg-foreground/5 mt-8 inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3 text-sm font-medium shadow-xs transition-all"
                >
                  <SparklesIcon className="size-4" />
                  {m['playground.image.wall_cta_button']()}
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pt-6">
              <section>
                <header className="mb-3 flex items-center justify-between">
                  <h2 className="text-foreground text-sm font-semibold">
                    {m['playground.image.my_images_title']()}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setTab('community')}
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    ← {m['playground.image.wall_cta_button']()}
                  </button>
                </header>
                <MyImageMasonry
                  rows={myImagesQuery.data?.tasks ?? []}
                  onSelect={(id) =>
                    navigate({
                      to: '/api-playground/image/$id',
                      params: { id },
                    })
                  }
                />
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Floating composer — glass panel over the wall. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-6">
        <div
          onPaste={handleReferencePaste}
          className="border-border bg-sidebar/80 pointer-events-auto w-full max-w-3xl rounded-[28px] border p-1.5 shadow-xs backdrop-blur-sm"
        >
          {references.length > 0 ? (
            // Strip of reference images. Each chip carries a tiny
            // "图N" label (so the user can refer to "图3" in the
            // prompt) and an inline note input ("图3 是海") — the
            // note is what the model sees, the index is just for the
            // human. Wraps onto a second row when 5+ are attached.
            <div className="flex flex-wrap items-start gap-2 px-3 pt-2">
              {references.map((r, i) => (
                <div
                  key={r.previewUrl}
                  className="group/reference relative shrink-0"
                >
                  <div className="relative size-14 overflow-hidden rounded-lg">
                    <img
                      src={r.previewUrl}
                      alt={r.filename}
                      className="size-full object-cover"
                    />
                    {/* Always-visible 图N label — small dark chip in the
                        top-left so the user can refer to it elsewhere. */}
                    <span className="bg-foreground/80 text-background absolute top-0.5 left-0.5 rounded px-1 text-[10px] leading-4 font-medium">
                      图{i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(r.previewUrl);
                        setReferences((prev) => prev.filter((_, j) => j !== i));
                      }}
                      className="bg-foreground/70 text-background absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded-full"
                      aria-label={m['playground.image.reference_remove']()}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  {/* Per-image note. Sits under the chip; its text is
                      injected into the prompt as "图N: <note>". */}
                  <input
                    type="text"
                    value={r.note}
                    onChange={(e) =>
                      setReferences((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, note: e.target.value } : x
                        )
                      )
                    }
                    placeholder={m[
                      'playground.image.reference_note_placeholder'
                    ]()}
                    className="placeholder:text-muted-foreground/60 text-foreground hover:border-border focus:border-foreground/30 mt-1.5 w-14 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[10px] outline-none"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (prompt.trim() && !submitMutation.isPending)
                  submitMutation.mutate();
              }
            }}
            placeholder={m['playground.image.prompt_placeholder']()}
            rows={2}
            className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed outline-none"
          />

          <div className="flex items-center gap-1 px-1 pb-1">
            <label
              // Hide only while a previous paste/upload is in flight.
              // The + stays visible (disabled-looking) when the cap is
              // hit so the user can still see the affordance.
              className={cn(
                'inline-flex size-9 items-center justify-center rounded-full transition-colors',
                uploadingReference
                  ? 'pointer-events-none hidden'
                  : references.length >= MAX_REFERENCES
                    ? 'text-muted-foreground/40 pointer-events-none cursor-not-allowed'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground cursor-pointer'
              )}
              aria-label={m['playground.attachment.add']()}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={references.length >= MAX_REFERENCES}
                onChange={(e) => handleReferenceUpload(e.target.files)}
              />
              <Plus className="size-4" />
            </label>
            {/* Image count + aspect ratio — two small popovers that
                feed into the submit body. The model menu stays at the
                far right of the toolbar so it doesn't shift around. */}
            <ImageCountMenu value={imageCount} onChange={setImageCount} />
            <AspectRatioMenu value={aspectRatio} onChange={setAspectRatio} />

            <div className="ml-auto flex items-center gap-1">
              {/* Model menu — only rendered when the key actually serves
                  more than one image model, so a single-model deployment
                  doesn't get a dropdown with nothing to choose.
                  "New image" lives in the sidebar CTA (route.tsx), which
                  calls the same clearActive() — no need to repeat it here. */}
              {availableModels.length > 0 && activeModel ? (
                <ImageModelMenu
                  models={availableModels}
                  selected={activeModel}
                  onSelect={setModel}
                />
              ) : null}
            </div>
            <button
              type="button"
              disabled={!prompt.trim() || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              className="bg-foreground text-background inline-flex size-9 items-center justify-center rounded-full transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={m['playground.image.submit']()}
            >
              {submitMutation.isPending || pollingTaskId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CornerDownLeft className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  VideoPlayground                                                    */
/* ------------------------------------------------------------------ */

/**
 * Video generation tab. Currently wired to Seedance 2.0 (text-to-video)
 * via Evolink. Submits to `POST /api/ai-tasks` with `mediaType: 'video'`,
 * then polls `GET /api/ai-tasks/$id` every 2s until the task is terminal.
 *
 * Cost is computed server-side from `seedance_video_credits_{quality}_per_second`
 * × `duration` (see `src/core/ai/video-pricing.ts`). Result video URL
 * (already rehosted to storage by `$id.ts:122`) comes back via the
 * persisted `taskResult` JSON, parsed by the polling endpoint's terminal
 * branch.
 *
 * The composer is a Grok-style `InputGroup` (textarea + a `block-start`
 * row of video options + a `block-end` toolbar with the model label and
 * submit). The video options (duration / quality / aspect / audio) live
 * between the prompt and the toolbar so the chrome stays stable as the
 * user tweaks them.
 */
export function VideoPlayground() {
  const store = usePlaygroundStore();
  const { activeVideoId, clearActive } = store;
  const { data: session } = useSession();

  const VIDEO_MODEL_ID = SEEDANCE_VIDEO_MODEL;
  const VIDEO_QUALITIES: SeedanceVideoQuality[] = [
    '480p',
    '720p',
    '1080p',
    '4k',
  ];
  const VIDEO_ASPECTS: SeedanceVideoAspectRatio[] = [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4',
    '21:9',
    'adaptive',
  ];

  const [prompt, setPrompt] = useState('');
  const [videoDuration, setVideoDuration] = useState<number>(
    DEFAULT_SEEDANCE_VIDEO_DURATION
  );
  const [videoQuality, setVideoQuality] = useState<SeedanceVideoQuality>(
    DEFAULT_SEEDANCE_VIDEO_QUALITY
  );
  const [videoAspect, setVideoAspect] = useState<SeedanceVideoAspectRatio>(
    DEFAULT_SEEDANCE_VIDEO_ASPECT
  );
  const [videoAudio, setVideoAudio] = useState<boolean>(
    DEFAULT_SEEDANCE_VIDEO_AUDIO
  );

  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data: publicConfig } = usePublicConfig();
  // Resolved model name from admin overrides. Falls back to the
  // Evolink Seedance default the server picks when the key is unset.
  const resolvedVideoModel =
    publicConfig?.evolink_video_model || VIDEO_MODEL_ID;
  const seedanceEnabled = publicConfig?.seedance_video_enabled !== 'false';

  const taskQuery = useQuery({
    queryKey: ['video-task', activeVideoId],
    queryFn: () => apiGet<{ task: any }>(`/api/ai-tasks/${activeVideoId}`),
    enabled: !!activeVideoId,
  });

  // Poll the active task until it reaches a terminal status. Cap at 60
  // attempts (~2 min) so a stuck task doesn't burn request budget forever;
  // the sidebar list keeps the task visible so the user can re-open it.
  useEffect(() => {
    if (!pollingTaskId) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;

    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const r = await apiGet<{ status: string }>(
          `/api/ai-tasks/${pollingTaskId}`
        );
        if (r.status === 'success' || r.status === 'failed') {
          queryClient.invalidateQueries({ queryKey: ['video-tasks'] });
          queryClient.invalidateQueries({
            queryKey: ['video-task', pollingTaskId],
          });
          setPollingTaskId(null);
          return;
        }
      } catch {
        // network blip — keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        setPollingTaskId(null);
        toast.error('Video generation timed out — check sidebar for status.');
        return;
      }
      setTimeout(tick, 2000);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [pollingTaskId, queryClient]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        mediaType: 'video',
        model: VIDEO_MODEL_ID,
        prompt: prompt.trim(),
        duration: videoDuration,
        quality: videoQuality,
        aspectRatio: videoAspect,
        generateAudio: videoAudio,
      };
      return apiPost<{ taskId: string; status: string; costCredits?: number }>(
        '/api/ai-tasks',
        body
      );
    },
    onSuccess: (data) => {
      setPollingTaskId(data.taskId);
      store.setActiveVideoId(data.taskId);
      setPrompt('');
      queryClient.invalidateQueries({ queryKey: ['video-tasks'] });
    },
    onError: (e: Error) => {
      const msg = e.message || '';
      const key = /insufficient/i.test(msg)
        ? 'playground.video.error_insufficient_credits'
        : /not configured/i.test(msg)
          ? 'playground.video.error_no_provider'
          : null;
      toast.error(key ? m[key]() : msg);
    },
  });

  const isBusy = submitMutation.isPending || !!pollingTaskId;
  const canSubmit = !!prompt.trim() && !isBusy && seedanceEnabled;

  // Resolve the active task's video URL for the "Active video" panel.
  const activeTask = taskQuery.data?.task;
  const activeVideoUrl = (() => {
    if (!activeTask) return null;
    try {
      const raw = activeTask.taskResult;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!r) return null;
      if (typeof r.videoUrl === 'string') return r.videoUrl;
      if (Array.isArray(r.videos) && r.videos[0]) {
        const first = r.videos[0];
        return typeof first === 'string'
          ? first
          : first?.url || first?.videoUrl;
      }
      if (typeof r.url === 'string') return r.url;
    } catch {
      // ignore parse error
    }
    return null;
  })();

  return (
    <TooltipProvider delay={200}>
      <div className="relative flex h-full min-h-0 w-full flex-col">
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto px-4 py-6">
          <div className="bg-card/70 border-foreground/10 flex items-center justify-between rounded-2xl border px-4 py-3 backdrop-blur-md">
            <h1 className="text-2xl font-semibold tracking-tight">
              {activeVideoId
                ? m['playground.video.result_label']()
                : m['playground.video.new_video']()}
            </h1>
            <Button variant="outline" size="sm" onClick={clearActive}>
              <MessageSquarePlus className="size-4" />
              {m['playground.video.new_video']()}
            </Button>
          </div>

          {!seedanceEnabled && (
            <div className="border-foreground/15 bg-card/70 text-foreground/75 flex items-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-sm backdrop-blur-md">
              <Film className="size-4" />
              {m['playground.video.disabled_notice']()}
            </div>
          )}

          {/* Active video result */}
          {activeVideoUrl ? (
            <div className="border-foreground/10 bg-card/90 overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md">
              <video
                src={activeVideoUrl}
                controls
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="mx-auto max-h-[600px] w-auto object-contain"
              />
              <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                <a
                  href={activeVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' })
                  )}
                >
                  {m['playground.video.open_in_new_tab']()}
                </a>
                <a
                  href={activeVideoUrl}
                  download
                  className={cn(buttonVariants({ size: 'sm' }))}
                >
                  {m['playground.video.download']()}
                </a>
              </div>
            </div>
          ) : (
            <div className="border-foreground/15 bg-card/60 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center backdrop-blur-md">
              <SparklesIcon className="text-foreground/40 size-10" />
              <p className="text-foreground/65 text-sm">
                {m['playground.video.result_empty']()}
              </p>
            </div>
          )}
        </div>

        {/* Composer — Grok-style input group pinned to the bottom. */}
        <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submitMutation.mutate();
            }}
          >
            <InputGroup
              className={cn(
                'h-auto min-h-16',
                'border-border bg-sidebar/80 dark:bg-sidebar/80 rounded-2xl border p-1.5 backdrop-blur-sm'
              )}
            >
              <div className="contents">
                <div className="flex w-full items-start gap-2 px-2.5">
                  <InputGroupTextarea
                    name="message"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (canSubmit) submitMutation.mutate();
                      }
                    }}
                    placeholder={m['playground.video.prompt_placeholder']()}
                    rows={3}
                    className="max-h-48 min-h-16 px-0"
                  />
                </div>
              </div>

              {/* Video options — duration slider, quality segmented,
                  aspect select, audio switch. Plain <div> (not
                  InputGroupAddon) so the visual order sits between the
                  textarea and the bottom toolbar. */}
              <div className="border-foreground/10 flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-xs">
                <label className="flex items-center gap-2">
                  <span className="text-foreground/55 font-medium">
                    {m['playground.video.duration']()}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={videoDuration}
                    onChange={(e) =>
                      setVideoDuration(
                        Math.min(10, Math.max(1, Number(e.target.value)))
                      )
                    }
                    aria-label={m['playground.video.duration']()}
                    className="accent-foreground w-24 cursor-pointer"
                  />
                  <span className="text-foreground/75 w-7 text-right font-mono tabular-nums">
                    {videoDuration}s
                  </span>
                </label>

                <div className="flex items-center gap-1.5">
                  <span className="text-foreground/55 font-medium">
                    {m['playground.video.quality']()}
                  </span>
                  <div
                    role="radiogroup"
                    aria-label={m['playground.video.quality']()}
                    className="bg-muted/60 inline-flex items-center rounded-lg p-0.5"
                  >
                    {VIDEO_QUALITIES.map((q) => {
                      const active = q === videoQuality;
                      return (
                        <button
                          key={q}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setVideoQuality(q)}
                          className={cn(
                            'text-foreground/60 rounded-md px-2 py-1 font-mono text-[11px] font-medium tracking-tight transition-colors',
                            'hover:text-foreground',
                            active && 'bg-background text-foreground shadow-sm'
                          )}
                        >
                          {q}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-1.5">
                  <span className="text-foreground/55 font-medium">
                    {m['playground.video.aspect']()}
                  </span>
                  <select
                    value={videoAspect}
                    onChange={(e) =>
                      setVideoAspect(e.target.value as SeedanceVideoAspectRatio)
                    }
                    aria-label={m['playground.video.aspect']()}
                    className="bg-muted/60 border-foreground/10 hover:bg-muted rounded-md border px-2 py-1 text-xs transition-colors"
                  >
                    {VIDEO_ASPECTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-foreground/75 flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={videoAudio}
                    onChange={(e) => setVideoAudio(e.target.checked)}
                    className="accent-foreground size-3.5 cursor-pointer"
                  />
                  <span className="font-medium">
                    {m['playground.video.audio']()}
                  </span>
                </label>
              </div>

              <InputGroupAddon align="block-end" className="order-last w-full">
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-foreground/55 inline-flex items-center gap-1.5 px-1 font-mono text-[11px] font-medium tracking-tight uppercase">
                    <Film className="size-3.5" />
                    Seedance 2.0
                  </span>
                </div>

                <div className="flex min-w-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="default"
                          aria-label={m['playground.video.model_label']()}
                          className="text-foreground h-8 min-w-0 shrink overflow-hidden"
                        >
                          <Film className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-mono">
                            {resolvedVideoModel}
                          </span>
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {m['playground.video.model_label']()}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="submit"
                          variant="default"
                          size="icon-sm"
                          aria-label={
                            isBusy
                              ? m['playground.video.submitting']()
                              : m['playground.video.submit']()
                          }
                          disabled={!canSubmit}
                          className="transition-opacity duration-200 disabled:opacity-50 motion-reduce:transition-none"
                        >
                          {isBusy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <CornerDownLeft />
                          )}
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {m['playground.video.submit']()}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>

        <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  PlaygroundSidebarList                                              */
/* ------------------------------------------------------------------ */

/**
 * Sidebar session list. Renders inside the `sessionList` slot of
 * `AppSidebar`. Switches between chat / image / video lists based on the
 * `mode` prop (driven by the parent layout route's URL match):
 *   - 'chat'  → `[Chat #N]` chat rows
 *   - 'image' → `[Image #N]` image tasks (with thumbnail)
 *   - 'video' → `[Video #N]` video tasks
 */
export function PlaygroundSidebarList({
  mode,
}: {
  mode: 'chat' | 'image' | 'video';
}) {
  const store = usePlaygroundStore();
  const queryClient = useQueryClient();

  const chatsQuery = useQuery({
    queryKey: ['chats'],
    queryFn: () => apiGet<{ chats: ChatRow[] }>('/api/chat'),
    enabled: mode === 'chat',
  });
  const imagesQuery = useQuery({
    queryKey: ['image-tasks'],
    queryFn: () =>
      apiGet<{ tasks: ImageTaskRow[] }>(
        '/api/ai-tasks?mediaType=image&limit=50'
      ),
    enabled: mode === 'image',
  });
  const videosQuery = useQuery({
    queryKey: ['video-tasks'],
    queryFn: () =>
      apiGet<{ tasks: ImageTaskRow[] }>(
        '/api/ai-tasks?mediaType=video&limit=50'
      ),
    enabled: mode === 'video',
  });

  if (mode === 'chat') {
    const list = (chatsQuery.data?.chats ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    if (!list.length) {
      return (
        <p className="text-foreground/55 px-2 py-1 text-xs">
          {m['playground.sidebar.no_chats']()}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        {list.map((c, i) => (
          <SessionRow
            key={c.id}
            index={i + 1}
            label={m['playground.sidebar.chat_label']({ n: i + 1 })}
            title={c.title?.trim() || m['playground.sidebar.untitled']()}
            active={store.activeChatId === c.id}
            onClick={() => store.setActiveChatId(c.id)}
            onDelete={async () => {
              await apiDelete(`/api/chat/${c.id}`);
              if (store.activeChatId === c.id) store.clearActive();
              queryClient.invalidateQueries({ queryKey: ['chats'] });
            }}
          />
        ))}
      </div>
    );
  }

  if (mode === 'video') {
    const list = (videosQuery.data?.tasks ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    if (!list.length) {
      return (
        <p className="text-foreground/55 px-2 py-1 text-xs">
          {m['playground.sidebar.no_videos']()}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {list.map((t, i) => (
          <SessionRow
            key={t.id}
            index={i + 1}
            label={m['playground.sidebar.video_label']({ n: i + 1 })}
            title={
              t.prompt?.trim().slice(0, 60) ||
              m['playground.sidebar.untitled']()
            }
            active={store.activeVideoId === t.id}
            onClick={() => store.setActiveVideoId(t.id)}
          />
        ))}
      </div>
    );
  }

  // image mode
  const list = (imagesQuery.data?.tasks ?? []).slice();
  if (!list.length) {
    return (
      <p className="text-foreground/55 px-2 py-1 text-xs">
        {m['playground.sidebar.no_images']()}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {list.map((t, i) => (
        <SessionRow
          key={t.id}
          index={i + 1}
          label={m['playground.sidebar.image_label']({ n: i + 1 })}
          title={
            t.prompt?.trim().slice(0, 60) || m['playground.sidebar.untitled']()
          }
          active={store.activeImageId === t.id}
          thumbnailUrl={t.thumbnailUrl || undefined}
          onClick={() => store.setActiveImageId(t.id)}
        />
      ))}
    </div>
  );
}

function SessionRow({
  label,
  title,
  active,
  thumbnailUrl,
  onClick,
  onDelete,
}: {
  index: number;
  label: string;
  title: string;
  active: boolean;
  thumbnailUrl?: string;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'group/session relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/50'
      )}
    >
      {thumbnailUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbnailUrl}
          alt=""
          className="size-7 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="text-foreground/55 min-w-[5.5rem] shrink-0 font-mono text-[11px]">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 truncate text-left"
      >
        {title}
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={m['playground.chat.delete']()}
          onClick={onDelete}
          className="text-foreground/40 hover:text-foreground hidden shrink-0 group-hover/session:block"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PlaygroundUpgradeCard                                              */
/* ------------------------------------------------------------------ */

export function PlaygroundUpgradeCard() {
  return (
    <Link
      href="/pricing"
      className="brand-gradient block rounded-2xl px-4 py-3 text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {m['playground.upgrade_card.title']()}
          </p>
          <p className="text-[11px] leading-snug opacity-90">
            {m['playground.upgrade_card.subtitle']()}
          </p>
        </div>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/15">
          →
        </span>
      </div>
      <p className="mt-2 text-center text-xs font-medium underline underline-offset-2">
        {m['playground.upgrade_card.cta']()}
      </p>
    </Link>
  );
}
