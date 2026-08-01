import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUp,
  Atom,
  Bot,
  Check,
  ChevronDown,
  Circle,
  CornerDownLeft,
  Crown,
  Download,
  FileText,
  Film,
  Gift,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize2,
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
  Wrench,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import {
  ASPECT_RATIOS,
  SEEDANCE_VIDEO_MODEL,
  type SeedanceVideoAspectRatio,
  type SeedanceVideoQuality,
} from '@/core/ai';
import {
  DEFAULT_SEEDANCE_VIDEO_ASPECT,
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
import { NoiseBackground } from '@/components/ui/noise-background';
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

// Maximum frames extracted per video. The original video file is kept as a
// `video` attachment (display only — the model can't read video), and each
// frame is uploaded alongside it as an `image` attachment. 4 frames per
// video is a good default: enough to describe motion / text-on-screen
// without blowing past the 50-file batch cap when the user picks several
// videos.
const FRAMES_PER_VIDEO = 4;

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

  const [modelId, setModelId] = useState('Kimi K3');
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
    modelId,
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
            <WelcomeState />
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
  modelId,
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
  // The model id the parent currently has selected. Passed straight to
  // `ChatModelPicker` so the trigger reflects the user's last pick
  // (the previous `selected: ModelOption` prop was derived from a
  // legacy 3-row list that didn't include the chat picker's models,
  // so any GPT/Claude/Gemini selection silently fell back to the
  // first legacy entry and the trigger froze on it).
  modelId: string;
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
            <ChatModelPicker selectedId={modelId} onSelect={onSelectModel} />
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

function WelcomeState({}: { modelId?: string }) {
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
  /** First-frame thumbnail — kept for the sidebar chip preview. */
  thumbnailUrl?: string | null;
  /** Every image the submission produced (1-4). Drives the row layout
   *  in My Images: each batch is one row, all its images side-by-side. */
  imageUrls?: string[] | null;
  /** Every video the submission produced. Mirrors `imageUrls` for
   *  video tasks (Seedance writes a single `videoUrl`; multi-clip
   *  batches surface an array). Drives the My Videos row layout. */
  videoUrls?: string[] | null;
  /** First-frame JPEG at /uploads/video-posters/<id>.jpg. The tile
   *  uses this as its `<img src>` instead of trying to render
   *  `<video>` inside a `<button>` parent (Chrome's autoplay
   *  heuristic refuses to paint first frame there). */
  posterUrl?:
    | string
    | null; /** Per-task option blob (duration / quality / aspect for video; seed
   *  / reference for image). Surfaced so My Videos can label each
   *  tile with the duration it was generated at. */
  options?: Record<string, any> | null;
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
  const [modelId, setModelId] = useState('Kimi K3');

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
      store.setActiveChatId(data.chat.id);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  async function handleSend() {
    // No client-side auth gate — the server-side `/api/playground/chat`
    // already returns the right `gate` event for anonymous visitors
    // (login_required) and signed-in users with no credits
    // (payment_required). The previous client-side `requireAuth()`
    // short-circuited to a dialog and confused users who expected the
    // chat to "just work" with whatever gate the backend surfaces.
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (isThinking) return;

    let chatId = activeChatId;
    // Skip the lazy-create for anonymous visitors — `/api/chat` POST
    // requires auth (returns `{code:-1, message:"Unauthorized"}`), which
    // would toast an error and abort the send before the stream ever
    // fires. The playground chat endpoint (`/api/playground/chat`) is
    // auth-agnostic and will surface `login_required` via the gate
    // event if the user is anonymous, so the auth dialog can take over
    // from there.
    if (!chatId && session?.user) {
      // Lazy-create. The mutation's onSuccess will set the id; we then
      // need to read it back from the store before posting the message.
      try {
        const created = await apiPost<{ chat: ChatRow }>('/api/chat', {});
        chatId = created.chat.id;
        store.setActiveChatId(chatId);
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
            if (status === 'login_required') {
              // Pop the sign-in dialog for anonymous visitors so they
              // don't have to interpret a generic "you've used your
              // free message" assistant bubble as their next step.
              setAuthOpen(true);
              // Drop the assistant bubble — the modal owns the
              // conversation from here.
              setMessages((prev) => prev.filter((mm) => mm.id !== assistantId));
              return;
            }
            const body = m['playground.gate.pay']();
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
    modelId,
    onSelectModel: setModelId,
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
            <WelcomeState />
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
 * Source: 52 community images downloaded to `/public/image/` (served
 * same-origin to sidestep the page's CSP `img-src` allowlist). Each
 * source file is rendered exactly once, so no scene repeats in the wall.
 *
 * Each tile is assigned one of the reference's aspect ratios (2:3 dominates,
 * then 9:16 / 3:2 / 16:9 / 4:5 / 1:1) so the packed rhythm matches.
 */

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

// Catalog of community images served from `/public/image/`. Every entry
// points at a real file on disk; the img `onError` handler below
// hides tiles that 404 so a missing file leaves no hollow cell.
const MEIGEN_IMAGE_FILES = [
  'meigen-2015866705197580703.jpg',
  'meigen-2032013831548125557.jpg',
  'meigen-2036806218988315056-1.jpg',
  'meigen-2049059204632080436-1.jpg',
  'meigen-2052074741050008057.jpg',
  'meigen-2054127368365908220-1.jpg',
  'meigen-2063092464592863250-1.jpg',
  'meigen-2067745145655804012.jpg',
  'meigen-2070794675179405365.jpg',
  'meigen-2074182489141293070-1.jpg',
  'meigen-2080212481402896518-1.jpg',
  'meigen-2082385036268229117-1.jpg',
  'meigen-community_298030b1-c8c1-4436-b88f-5ae556af9c6a.png',
  'meigen-community_3b7948d3-2ddf-4d48-827a-45950c8b690a.jpg',
  'meigen-community_5f68dfb7-b6d5-4734-b887-f5fed7c9d1af.jpg',
  'xinjia/meigen-2019001339985133694.jpg',
  'xinjia/meigen-2024104039827578910-1.jpg',
  'xinjia/meigen-2032542713170838002-1.jpg',
  'xinjia/meigen-2060729668958097717-1.jpg',
  'xinjia/meigen-2069018297228575178-2.jpg',
  'xinjia/meigen-2069018297228575178-3.jpg',
  'xinjia/meigen-community_093ff2f3-b586-4e7f-a23c-63408a76158e.png',
  'xinjia/meigen-community_127719af-811c-4e1c-81cb-a26aeba3a263.png',
  'xinjia/meigen-community_37f3ab08-800a-456b-b8bb-ff26724222ea.png',
  'xinjia/meigen-community_4461cb95-6748-4232-99cc-3d23b67c0b63.png',
  'xinjia/meigen-community_892129d5-dae0-4764-b03c-6a11e2e12b26.png',
  'xinjia/meigen-community_a2cca04e-085b-444c-95bb-6d6e2ab3b9aa.png',
  'xinjia/meigen-community_b827f6c2-5165-428e-9992-61f1de9e8ae3.png',
  'xinjia/meigen-community_c18ad1be-f6fb-4e2b-970d-932dff8832b9.png',
  'xinjia/meigen-community_dff3afb9-3e67-4f21-a382-786bc9b8c466.png',
  'xinjia/meigen-community_e690fd0d-4ea6-488f-8592-c2dd0ac92c7e.png',
  'xinjia/meigen-community_fb7a6b33-4d3a-459f-87e5-c67f611dd9a2.png',
  // ── zaixinjia batch (20 files, added 2026-08-01) ───────────────────
  'zaixinjia/meigen-2006643289185989070-1.jpg',
  'zaixinjia/meigen-2006643289185989070-4.jpg',
  'zaixinjia/meigen-2008986705962123774-1.jpg',
  'zaixinjia/meigen-2010381897730339152-1.jpg',
  'zaixinjia/meigen-2024707382727889320-1.jpg',
  'zaixinjia/meigen-2041163046874382357-1.jpg',
  'zaixinjia/meigen-2048598185841734064.jpg',
  'zaixinjia/meigen-2050472802327900342.jpg',
  'zaixinjia/meigen-2050954496474570805.jpg',
  'zaixinjia/meigen-2061832450842726614.jpg',
  'zaixinjia/meigen-2066386292217467241-1.jpg',
  'zaixinjia/meigen-2082480882695491628-1.jpg',
  'zaixinjia/meigen-community_0013511a-1eeb-4279-8490-eb0195f9a4df.png',
  'zaixinjia/meigen-community_0ed9e02e-7ad6-4b72-b2eb-2aef0a175cec.png',
  'zaixinjia/meigen-community_15849a4b-8001-4c6b-aac2-ceea6b9ff18a.png',
  'zaixinjia/meigen-community_24b38e2e-777e-4949-aa12-1747132346db.png',
  'zaixinjia/meigen-community_32dd8162-6fc0-4124-ba7d-887bfdda6d72.png',
  'zaixinjia/meigen-community_3bab0153-80b1-425a-abfb-96d239fb43cf.png',
  'zaixinjia/meigen-community_9786c744-2f71-4f16-abeb-fc5aa1cf7d6b.png',
  'zaixinjia/meigen-community_db1519d0-055f-4c18-b4e6-6d62bfba1e7f.png',
  // ── zaizaijia batch (15 files, added 2026-08-01) ───────────────────
  'zaizaijia/meigen-2010358364048597154.jpg',
  'zaizaijia/meigen-2019629174374429017-1.jpg',
  'zaizaijia/meigen-2020531946108158457-1.jpg',
  'zaizaijia/meigen-2049363203998818532.jpg',
  'zaizaijia/meigen-2064946524031988094.jpg',
  'zaizaijia/meigen-2075143065493229752-2.jpg',
  'zaizaijia/meigen-2075575662316749255-1.jpg',
  'zaizaijia/meigen-2075575662316749255-2.jpg',
  'zaizaijia/meigen-2079908139281809722.jpg',
  'zaizaijia/meigen-2080143259557581285-1.jpg',
  'zaizaijia/meigen-community_00e1b966-c37c-47ed-99f3-fd891271b517.png',
  'zaizaijia/meigen-community_3e031315-9073-47f3-bf6a-93c32cf50da9.png',
  'zaizaijia/meigen-community_5fe15de6-ea3c-4bd4-88db-0db201a8b7b4.png',
  'zaizaijia/meigen-community_6f65fc5d-7d3a-48d6-908c-2bf947fd1c23.png',
  'zaizaijia/meigen-community_85e0a391-9f8c-4860-9fac-c5446dc2d39c.png',
];

// Render every community image exactly once. The deterministic source order
// keeps SSR and CSR output identical without duplicating any scene.
const GALLERY_ITEMS: Tile[] = MEIGEN_IMAGE_FILES.map((fileName, i) => ({
  src: `/image/${fileName}`,
  ratio: TILE_RATIOS[i % TILE_RATIOS.length],
  alt: 'community image',
}));

/**
 * Pure-video catalog for the video-page background wall. Videos the user
 * uploaded into `public/gallery/` cycle across enough slots to fill a
 * full-screen masonry (varies by viewport — the packer stops at
 * `viewportHeight`). The browser caches each unique mp4 by URL, so the
 * payload is just the listed source files regardless of how many cells
 * show them.
 *
 * Source-index list excludes every dog-containing source (pure-dog
 * `v-02, v-03, v-05, v-14, v-15, v-16` and mixed cat+dog `v-00, v-11,
 * v-17`) so the wall is now dog-free. Each remaining source contributes
 * exactly one clip (the `a` cut) so the wall never repeats the same
 * shot — different timestamps from the same source video look too
 * similar and read as visual duplication to the user.
 *
 * To add more variety, drop new mp4s into `public/gallery/` named
 * `v-XX.mp4` (next free index after 17), append the index here, and
 * re-run `ffmpeg -ss 0.5 -i v-XX.mp4 -vframes 1 -vf "scale=720:-1"
 * v-XX.jpg` to mint its poster.
 */
const VIDEO_BACKGROUND_ITEMS: Tile[] = (() => {
  // One clip per dog-free source. Each source's `a` clip is the canonical
  // shot — `b` / `c` cuts from the same source read as duplicates even
  // when the timestamps differ.
  const clipFileNames = [
    'clip-01-a',
    'clip-03-a',
    'clip-04-a',
    'clip-06-a',
    'clip-07-a',
    'clip-08-a',
    'clip-09-a',
    'clip-10-a',
    'clip-12-a',
    'clip-13-a',
    'clip-16-a',
  ];
  // Ratio mix tuned for AI-generated video content (mostly 16:9 / 9:16 /
  // 1:1 / 3:4). Cycled across slots so adjacent cells vary in height and
  // the packed rhythm doesn't repeat obviously.
  const VIDEO_TILE_RATIOS = [9 / 16, 16 / 9, 1, 3 / 4, 2 / 3, 3 / 2];
  // The wall is the page's only video content — it has to be tall enough
  // that scrolling never reaches a "below the wall" region (which would
  // show the body background through). With ~10 cols × ~5 rows per cycle
  // and each tile 100-220px tall, one cycle of the 43 clips ≈ 1000px.
  // Cycling 6× gives ~6000px — covers any 1080p viewport with 5+ screens
  // of scroll, so the user always sees wall behind everything (including
  // the end-cap CTA and the empty `pb-56` tail). The shuffled order below
  // + the ratio cycling keeps the repetition from being obviously periodic.
  const CYCLES = 6;
  // Deterministic shuffle (no Math.random — SSR/CSR must match). Knuth
  // Fisher-Yates with a seedable LCG so the same catalog renders the
  // same way on server and client.
  function shuffleSeeded<T>(arr: T[]): T[] {
    const out = arr.slice();
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const out: Tile[] = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    // Each cycle starts with a different shuffle so the same clip never
    // lands in the same cell across cycles.
    const shuffled = shuffleSeeded(clipFileNames);
    for (let i = 0; i < shuffled.length; i++) {
      const name = shuffled[i];
      out.push({
        src: `/gallery/${name}.mp4`,
        // Offset the ratio index by the cycle so every occurrence of a
        // clip lands in a different-sized cell (9:16 once, 16:9 another
        // time, etc.), masking the underlying repetition.
        ratio: VIDEO_TILE_RATIOS[(i + cycle * 3) % VIDEO_TILE_RATIOS.length],
        alt: 'AI-generated video',
        kind: 'video' as const,
        poster: `/gallery/${name}.jpg`,
      });
    }
  }
  return out;
})();

// Column count per breakpoint, measured off the reference.
const GALLERY_GAP = 4;
function columnsForWidth(w: number) {
  if (w >= 1800) return 10;
  if (w >= 1500) return 8;
  if (w >= 1280) return 7;
  if (w >= 1024) return 6;
  if (w >= 768) return 4;
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

/**
 * Generic masonry wall. Packs the provided `items` (defaults to
 * `GALLERY_ITEMS`) into a tall column layout — the container's natural
 * height becomes the wall height, so wrapping it in a scroll track lets
 * the user scroll through hundreds of tiles.
 *
 * Renders each tile as one of:
 *   - <img>           — `kind: 'image'` (default)
 *   - <img poster> + <video>  — `kind: 'video'`; the poster paints the
 *     first frame synchronously so the cell is never blank while the
 *     browser throttles autoplay of many concurrent <video>s.
 *
 * Video tiles still get the same hover scrim as image tiles — the wall
 * is a unified component, the kind only changes the media element.
 */
function GalleryWall({ items = GALLERY_ITEMS }: { items?: Tile[] } = {}) {
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

  const { tiles, height } = packMasonry(items, width, columnCount, GALLERY_GAP);

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
            {tile.kind === 'video' ? (
              <Fragment>
                {tile.poster && (
                  <img
                    src={tile.poster}
                    alt=""
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
                <video
                  src={tile.src}
                  poster={tile.poster}
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                  onError={() => {
                    // Don't hide — let the poster <img> underneath stay
                    // visible so the wall has no holes.
                  }}
                  className="absolute inset-0 size-full object-cover"
                />
              </Fragment>
            ) : (
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
            )}
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
 * Match keys are lowercased substrings — a single row can cover multiple
 * upstream aliases (e.g. `seedream-5.0` and `doubao-seedream-5.0-pro`).
 */
type ImageModelBadge = 'Pro' | 'Lite' | 'New';

interface ImageModelMeta {
  /** Regex anchored on the lowercased id. */
  test: RegExp;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Optional brand-coloured SVG (path under /brand/). When set, the row
   * chip renders `<img src={logo}>` instead of the lucide icon, so each
   * row reads as a recognisable brand mark — matches the video / chat
   * picker's visual language.
   */
  logo?: string;
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
  // Mid-tone palette: each vendor gets a distinct, recognisable hue
  // (not pitch-black, not candy-bright). 500 series is bright enough
  // for the icon to read clearly without the saturated candy look.
  ByteDance: {
    label: 'ByteDance',
    chip: 'bg-slate-500',
  },
  Google: {
    label: 'Google',
    chip: 'bg-emerald-500',
  },
  OpenAI: {
    label: 'OpenAI',
    chip: 'bg-sky-500',
  },
  Alibaba: {
    label: 'Alibaba',
    chip: 'bg-amber-500',
  },
  'Black Forest Labs': {
    label: 'Black Forest Labs',
    chip: 'bg-violet-500',
  },
  xAI: { label: 'xAI', chip: 'bg-rose-500' },
};

/**
 * Cosmetic model list shown in the image picker.
 *
 * Only ONE image API is actually wired up on this deployment (Evolink's
 * gpt-image-2) — see `pickImageProvider` in `@/core/ai`. The picker still
 * surfaces a handful of well-known model names so the UI feels rich and
 * the user has something to choose between. Every selection routes to
 * the same backend call: the submit body does NOT include `model`, so
 * the server falls back to its `evolink_image_model` default.
 *
 * If/when additional image providers get wired up, replace this list
 * with the gateway's actual `models[]` and start sending `body.model`
 * again.
 */
const COSMETIC_IMAGE_MODELS = ['gpt-image-2'];

const IMAGE_MODEL_META: ImageModelMeta[] = [
  // ── OpenAI (GPT image) ─────────────────────────────────────────────────
  {
    test: /gpt-image-2/,
    name: 'GPT Image 2',
    icon: Crown,
    logo: '/brand/openai.png',
    vendor: 'OpenAI',
    badge: 'Pro',
    desc: 'OpenAI flagship, instruction-tuned',
    weight: 0,
  },
];

function resolveImageModelMeta(id: string): ImageModelMeta {
  const lower = id.toLowerCase();
  const hit = IMAGE_MODEL_META.find((m) => m.test.test(lower));
  if (hit) return hit;
  // Fallback — unknown model id still appears; render with a generic
  // sparkle so the menu stays usable. Grouped under "Other" so the user
  // can pick it without the picker crashing.
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
  // Indigo → cyan keeps the fallback friendly and on-brand instead of
  // dumping everything into the gray-zinc lane (which read as broken).
  // Only triggered when a model id doesn't match any IMAGE_MODEL_META
  // entry — the cosmetic list now has explicit rows for every id we
  // surface, so this is mostly a safety net for future additions.
  label: 'Other',
  chip: 'from-indigo-500 via-blue-500 to-cyan-500',
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

// Aspect ratio palette — derived from the shared `ASPECT_RATIOS`
// module so the client and the server use the same pixel-size mapping.
// A leading "" entry represents the "auto / let the model decide" state.
type AspectRatio = {
  value: string; // value sent to the provider (or '' for auto)
  label: string; // label shown in the menu (with spaces, e.g. "1 : 1")
  preview: string; // CSS width % for the inline swatch
};
const RATIO_MENU: AspectRatio[] = [
  { value: '', label: 'auto', preview: '50%' },
  ...ASPECT_RATIOS.map((r) => ({
    value: r.value,
    // Spaced label form ("1 : 1") matches the rest of the UI.
    label: r.value.replace(/(\d+):(\d+)/, '$1 : $2'),
    preview: `${r.preview}%`,
  })),
];

// Inline mini-swatch that mirrors the chosen ratio so the trigger
// label and the menu row line up visually.
function RatioSwatch({ value, size = 16 }: { value: string; size?: number }) {
  if (!value) {
    // auto — show a size icon so users know it's a special "let model decide" state.
    return (
      <span
        className="bg-foreground/10 text-muted-foreground inline-flex items-center justify-center rounded-[3px]"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Maximize2 className="size-2.5" />
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
          {RATIO_MENU.map((r) => (
            <button
              key={r.value || 'auto'}
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
              {/* Fixed-width column so swatches of different aspect
                  ratios don't push the label's left edge around. */}
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                <RatioSwatch value={r.value} size={16} />
              </span>
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
      logo: meta.logo,
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

  // Trigger label — show the selected model's display name + brand logo
  // (not raw id) so the chrome reads as a brand pick.
  const selectedMeta = resolveImageModelMeta(selected);
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      {/*
        Trigger: pill on a muted surface so it sits in the toolbar
        without competing with the submit button. No leading logo — the
        row layout for chat/video/image pickers is logo-free.
      */}
      <PopoverTrigger
        className={cn(
          'inline-flex items-center gap-3 rounded-full py-1.5 pr-3 pl-3',
          'bg-foreground/[0.06] text-foreground/80 border-foreground/10 border',
          'hover:bg-foreground/[0.09] hover:text-foreground transition-colors',
          open && 'bg-foreground/[0.09] text-foreground'
        )}
        aria-label={m['playground.image.model_label']()}
      >
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
                  <div className="text-foreground/50 bg-popover/85 sticky top-0 z-[5] flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase backdrop-blur-sm">
                    {theme.logo}
                    {theme.label}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((r) => {
                      const active = r.id === selected;
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
                          {/*
                            No leading avatar — logo is intentionally
                            omitted across all three pickers; the row
                            reads as plain name + desc + check.
                          */}
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

/* ================================================================== */
/*  Video model picker — curated lineup of 5 flagship models, each      */
/*  prefixed by its maker's brand-coloured logo (mirrors the chat       */
/*  picker's visual language). Seedance 2.0 is the only model wired to  */
/*  the gateway today; the other four are display-only — picking one     */
/*  just stores the override, the user notices fast if the gateway      */
/*  rejects the model id on submit (same affordance as the chat picker). */
/* ================================================================== */

type VideoModelBadge = 'Default' | 'Pro' | 'Lite' | 'New';

interface VideoModelMeta {
  /** Regex anchored on the lowercased model id. */
  test: RegExp;
  name: string;
  // Public path to a brand SVG (served from /public/brand/…). Maker
  // colour is baked into the SVG so each row reads as a recognisable
  // logo rather than a monochrome glyph in a coloured chip.
  logo: string;
  vendor: VideoVendor;
  desc: string;
  badge?: VideoModelBadge;
  weight?: number;
}

type VideoVendor = 'ByteDance' | 'Kling' | 'Google' | 'OpenAI';

interface VideoVendorTheme {
  label: string;
}

const VIDEO_VENDOR_THEME: Record<VideoVendor, VideoVendorTheme> = {
  ByteDance: { label: 'ByteDance' },
  Kling: { label: 'Kling' },
  Google: { label: 'Google' },
  OpenAI: { label: 'OpenAI' },
};

const VIDEO_MODEL_META: VideoModelMeta[] = [
  // ── ByteDance — Seedance 2.0 (the actually-wired default) ────────────
  {
    test: /seedance-2\.0/i,
    name: 'Seedance 2.0',
    logo: '/brand/bytedance.svg',
    vendor: 'ByteDance',
    badge: 'Default',
    desc: 'Text-to-video, 4K-capable, current default',
    weight: 0,
  },

  // ── Kling — Kuaishou's flagship video model ──────────────────────────
  {
    test: /kling-3\.0-turbo|kling/i,
    name: 'Kling 3.0 Turbo',
    logo: '/brand/kling.svg',
    vendor: 'Kling',
    badge: 'Pro',
    desc: 'Kuaishou high-fidelity video, fast turbo tier',
    weight: 10,
  },

  // ── Google — Gemini Omni Flash (specific product mark) ───────────────
  {
    test: /gemini-omni-flash|gemini-omni/i,
    name: 'Gemini Omni Flash',
    logo: '/brand/gemini.svg',
    vendor: 'Google',
    desc: 'Google native-multimodal video, fast',
    weight: 20,
  },

  // ── Google — Veo 3.1 (Google DeepMind video) ─────────────────────────
  {
    test: /veo-3\.1|veo/i,
    name: 'Veo 3.1',
    logo: '/brand/google.svg',
    vendor: 'Google',
    badge: 'Pro',
    desc: 'Google DeepMind flagship video generation',
    weight: 30,
  },

  // ── OpenAI — Sora 2 ──────────────────────────────────────────────────
  {
    test: /sora-2|sora/i,
    name: 'Sora 2',
    logo: '/brand/openai.png',
    vendor: 'OpenAI',
    badge: 'Pro',
    desc: 'OpenAI flagship video, longest duration',
    weight: 40,
  },
];

function resolveVideoModelMeta(id: string): VideoModelMeta {
  const lower = id.toLowerCase();
  const hit = VIDEO_MODEL_META.find((m) => m.test.test(lower));
  if (hit) return hit;
  // Unknown ids — fall back to the Seedance default row so the trigger
  // never renders a broken state. The admin-configured `evolink_video_model`
  // usually matches `seedance-2.0-text-to-video`, which is the first entry.
  return VIDEO_MODEL_META[0];
}

/**
 * Video-model menu — same visual language as the image-model picker:
 * search box, sticky section header, vendor grouping, each row has an
 * icon chip, name, optional badge, description, and a checkmark on the
 * selected one. Mirrors `playground.image.model_*` translations.
 */
function VideoModelPicker({
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

  const rows = models.map((id) => {
    const meta = resolveVideoModelMeta(id);
    return {
      id,
      name: meta.name,
      logo: meta.logo,
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

  const grouped = new Map<VideoVendor, typeof rows>();
  for (const r of filtered) {
    if (!grouped.has(r.vendor)) grouped.set(r.vendor, []);
    grouped.get(r.vendor)!.push(r);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.weight - b.weight);
  }

  const selectedMeta = resolveVideoModelMeta(selected);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      <PopoverTrigger
        className={cn(
          'inline-flex items-center gap-3 rounded-full py-1.5 pr-3 pl-3',
          'bg-foreground/[0.06] text-foreground/80 border-foreground/10 border',
          'hover:bg-foreground/[0.09] hover:text-foreground transition-colors',
          open && 'bg-foreground/[0.09] text-foreground'
        )}
        aria-label={m['playground.video.model_label']()}
      >
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
        <div className="bg-popover sticky top-0 z-10 space-y-2 rounded-t-xl p-2.5 pb-2">
          <div className="bg-foreground/5 border-foreground/5 flex items-center gap-2 rounded-lg border px-3 py-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m['playground.video.model_search_placeholder']()}
              className="placeholder:text-muted-foreground/70 text-foreground w-full bg-transparent text-sm outline-none"
            />
          </div>
          <p className="text-foreground/40 px-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
            {m['playground.video.model_label']()}
          </p>
        </div>

        <div className="max-h-[420px] overflow-y-auto px-1.5 pb-2">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground/70 px-2 py-6 text-center text-sm">
              {m['playground.video.model_empty']()}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([vendor, list]) => {
              const theme = VIDEO_VENDOR_THEME[vendor];
              return (
                <div key={vendor} className="mb-3">
                  <div className="text-foreground/50 bg-popover/85 sticky top-0 z-[5] flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase backdrop-blur-sm">
                    {theme.logo}
                    {theme.label}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((r) => {
                      const active = r.id === selected;
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
                          {/*
                            No leading avatar — logo intentionally omitted
                            across all three pickers; row reads as plain
                            name + desc + check.
                          */}
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
                                      : r.badge === 'Default'
                                        ? 'bg-foreground/8 text-foreground/70'
                                        : r.badge === 'New'
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                          : 'bg-foreground/8 text-foreground/60'
                                  )}
                                >
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

/* ================================================================== */
/*  Chat model picker — many well-known display names, all routed to    */
/*  the actually-wired provider. The user picks whatever they like;    */
/*  the chat API always uses the configured `evolink_model` (default   */
/*  `kimi-k3`). Purely cosmetic — gives users the feeling of many      */
/*  choices without burning dev time wiring each model.                  */
/* ================================================================== */

interface ChatModelMeta {
  test: RegExp;
  name: string;
  // Public path to a brand SVG (served from /public/brand/…). Brand
  // colour is baked into the SVG so the picker reads as a row of
  // recognisable logos rather than monochrome glyphs in a coloured chip.
  logo: string;
  vendor: ChatVendor;
  desc: string;
  weight?: number;
}

type ChatVendor = 'Kimi';

interface ChatVendorTheme {
  label: string;
}

const CHAT_VENDOR_THEME: Record<ChatVendor, ChatVendorTheme> = {
  // Only Kimi is wired up on this deployment. Section header keeps the
  // vendor label for parity with the image/video pickers.
  Kimi: { label: 'Kimi' },
};

const CHAT_MODEL_META: ChatModelMeta[] = [
  // ── Kimi (powers this chat) ────────────────────────────────────────────
  {
    test: /^kimi-k3/i,
    name: 'Kimi K3',
    logo: '/brand/kimi.svg',
    vendor: 'Kimi',
    desc: 'Powers this chat — long context, fast',
    weight: 0,
  },
];

function resolveChatModelMeta(id: string): ChatModelMeta {
  const lower = id.toLowerCase();
  return (
    CHAT_MODEL_META.find((m) => m.test.test(lower)) ?? {
      test: /^.*$/,
      name: id,
      logo: '/brand/kimi.svg',
      vendor: 'Kimi',
      desc: 'Custom model',
    }
  );
}

/**
 * Chat-model picker — same visual language as Image/Video model
 * pickers (search box, sticky section header, vendor grouping, icon
 * chip + name + badge + description + checkmark on selected).
 *
 * Whatever the user picks here is purely cosmetic — the chat API
 * always uses the configured `evolink_model` from the server (default
 * `kimi-k3`). The picker exists so the UI feels like it offers many
 * real choices; the underlying wiring stays single-provider.
 */
function ChatModelPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Treat the registered list as the "models" universe — no `models`
  // prop here since chat doesn't have a dynamic list. To add a model,
  // drop its brand SVG into /public/brand/ and append a row to
  // CHAT_MODEL_META.
  const rows = CHAT_MODEL_META.map((meta) => ({
    id: meta.name, // use display name as the "model id" so the picker
    // selection survives across renders without needing
    // a real backend round-trip.
    name: meta.name,
    logo: meta.logo,
    vendor: meta.vendor,
    desc: meta.desc,
    weight: meta.weight ?? 99,
  }));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.vendor.toLowerCase().includes(q) ||
          r.desc.toLowerCase().includes(q)
      )
    : rows;

  const grouped = new Map<ChatVendor, typeof rows>();
  for (const r of filtered) {
    if (!grouped.has(r.vendor)) grouped.set(r.vendor, []);
    grouped.get(r.vendor)!.push(r);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.weight - b.weight);
  }

  // Trigger label — show the selected model's brand logo + name so the
  // chrome reads as a real model pick.
  const selectedMeta = resolveChatModelMeta(selectedId);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
    >
      <PopoverTrigger
        className={cn(
          'inline-flex items-center gap-3 rounded-full py-1.5 pr-3 pl-3',
          'bg-foreground/[0.06] text-foreground/80 border-foreground/10 border',
          'hover:bg-foreground/[0.09] hover:text-foreground transition-colors',
          open && 'bg-foreground/[0.09] text-foreground'
        )}
        aria-label={m['playground.chat.model_label']()}
      >
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
        <div className="bg-popover sticky top-0 z-10 space-y-2 rounded-t-xl p-2.5 pb-2">
          <div className="bg-foreground/5 border-foreground/5 flex items-center gap-2 rounded-lg border px-3 py-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m['playground.chat.model_search_placeholder']()}
              className="placeholder:text-muted-foreground/70 text-foreground w-full bg-transparent text-sm outline-none"
            />
          </div>
          <p className="text-foreground/40 px-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
            {m['playground.chat.model_label']()}
          </p>
        </div>

        <div className="max-h-[420px] overflow-y-auto px-1.5 pb-2">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground/70 px-2 py-6 text-center text-sm">
              {m['playground.chat.model_empty']()}
            </p>
          ) : (
            Array.from(grouped.entries()).map(([vendor, list]) => {
              const theme = CHAT_VENDOR_THEME[vendor];
              return (
                <div key={vendor} className="mb-3">
                  <div className="text-foreground/50 bg-popover/85 sticky top-0 z-[5] flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase backdrop-blur-sm">
                    {theme.logo}
                    {theme.label}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((r) => {
                      const active = r.id === selectedMeta.name;
                      return (
                        <button
                          key={r.name}
                          type="button"
                          onClick={() => {
                            onSelect(r.name);
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
                          {/*
                            No leading avatar — logo intentionally omitted
                            across all three pickers; row reads as plain
                            name + desc + check.
                          */}
                          <div className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-sm',
                                active ? 'font-semibold' : 'font-medium'
                              )}
                            >
                              {r.name}
                            </span>
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
 * Video tab definitions. Mirrors `GALLERY_TABS` but uses the Film icon
 * (instead of ImageIcon) so the active "My Videos" tab reads as a video
 * surface, not an image one. Keys share the same `tab` discriminator as
 * the image version — the component renders a distinct My Videos grid.
 */
const VIDEO_GALLERY_TABS = [
  {
    id: 'community' as const,
    icon: LayoutGrid,
    label: () => m['playground.video.tab_community'](),
  },
  {
    id: 'mine' as const,
    icon: Film,
    label: () => m['playground.video.tab_my_videos'](),
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
 * User's own generated images, grouped into **batch rows**: one row per
 * submission, oldest at the top and newest at the bottom (caller passes
 * the list pre-reversed). When the user picks `N=2` the row lays out two
 * tiles side-by-side; `N=4` → four tiles. Multi-image submissions that
 * used to lose every frame past the first now show all of them, and
 * the batch they belong to is immediately readable as a unit.
 *
 * Each tile still uses the image's NATURAL aspect ratio (via
 * `MyImageTile`) so 16:9 / 9:16 / etc. actually look like the ratio the
 * user chose — a fixed 1:1 tile with `object-cover` would crop every
 * non-square image and the user couldn't tell whether their pick took
 * effect. Until the dimensions load we fall back to 1:1 to keep the
 * grid stable, then re-flow once the real aspect comes in.
 *
 * Rows are **left-aligned** with a compact tile size (`w-36`) — not a
 * spread-to-the-edges grid — so the gallery reads as a tidy column of
 * batches instead of a full-width mosaic.
 *
 * Stale in-flight rows that never produce an image (timed-out, failed
 * silently, evicted R2 URLs, etc.) are filtered out so the list doesn't
 * fill up with eternal "Generating…" spinners; only a fresh submit's
 * short-lived processing placeholder survives.
 */
function MyImageRows({
  rows,
  onSelect,
  highlightId,
}: {
  rows: ImageTaskRow[];
  onSelect: (id: string) => void;
  highlightId?: string | null;
}) {
  // Force a re-render every 30s so the staleness filter below can drop
  // an in-flight row the moment it crosses the 2-minute window. Without
  // the tick the filter only re-evaluates when `rows` changes, leaving
  // expired placeholders visible to whoever happens to be staring at
  // the page.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  // Show a processing placeholder at most 30s before giving up the
  // slot — beyond that the task has almost certainly failed / timed
  // out / lost its URL, and showing an eternal spinner is worse than
  // silently dropping it (the row can still be reached via the
  // sidebar history).
  const FRESH_PROCESSING_MS = 30_000;

  const visibleRows = rows.filter((r) => {
    const urls = r.imageUrls ?? (r.thumbnailUrl ? [r.thumbnailUrl] : []);
    // Any task that produced at least one image stays on the list.
    if (urls.length > 0) return true;
    // A task still in-flight AND just submitted → keep the spinner so
    // the user sees their fresh attempt. Older than 2 minutes and
    // still no image → hide (it timed out / failed / lost its URL).
    const age = now - new Date(r.createdAt).getTime();
    if (
      (r.status === 'processing' || r.status === 'pending') &&
      age < FRESH_PROCESSING_MS
    ) {
      return true;
    }
    return false;
  });

  if (visibleRows.length === 0) {
    // The section header above still names "Your generated images" and
    // the right-aligned "← Community" link is the way out, so the list
    // area is deliberately left blank — no sparkles placeholder, no
    // "your images will appear here" copy. The user knows where they
    // are from the chrome.
    return null;
  }

  // Group rows by the user's local calendar day so the day header only
  // appears once at the top of that day's cluster. Rows already arrive
  // newest-first (the call site reverses the server list), so the day
  // headers stack top-down in reverse-chronological order. We key on
  // `YYYY-MM-DD` in local time — UTC would group late-evening posts
  // into the "next day" and confuse the user.
  const isZh = getLocale() === 'zh';
  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    if (isZh) {
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
    // 'en-US' is close enough to the English "Aug 1, 2026" shape; we
    // intentionally avoid 'en-GB' ("1 Aug 2026") to match the locale-
    // neutral tone of the rest of the playground.
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  const todayKey = dayKey(new Date().toISOString());
  const yesterdayKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dayKey(d.toISOString());
  })();
  // Group by day in render order so adjacent rows that share a day stay
  // together; preserves the caller-supplied ordering (newest-first).
  const groups: Array<{ key: string; label: string; rows: ImageTaskRow[] }> =
    [];
  for (const r of visibleRows) {
    const key = dayKey(r.createdAt);
    if (groups.length && groups[groups.length - 1].key === key) {
      groups[groups.length - 1].rows.push(r);
    } else {
      const relative = isZh
        ? key === todayKey
          ? '今天'
          : key === yesterdayKey
            ? '昨天'
            : null
        : key === todayKey
          ? 'Today'
          : key === yesterdayKey
            ? 'Yesterday'
            : null;
      groups.push({
        key,
        label: relative
          ? `${relative} · ${dayLabel(r.createdAt)}`
          : dayLabel(r.createdAt),
        rows: [r],
      });
    }
  }

  return (
    <div className="flex flex-col items-start gap-5">
      {groups.map((group) => (
        <div key={group.key} className="flex w-full flex-col items-start gap-3">
          {/* Day header — appears once per calendar day at the top of
              that day's cluster. Today's / Yesterday's gets a relative
              label so a fresh wall of images still reads as "today". */}
          <h3 className="text-foreground/80 px-1 text-xs font-semibold tracking-[0.06em] uppercase">
            {group.label}
          </h3>
          {group.rows.map((r) => {
            const urls =
              r.imageUrls ?? (r.thumbnailUrl ? [r.thumbnailUrl] : []);
            const count = urls.length;
            // In-flight batch (status='processing' with no URLs yet) keeps
            // a single spinner tile inside the row so the latest submit is
            // visible at the bottom of the list. Once the polling refetch
            // brings the real images, the row swaps to the loaded tiles.
            const isInFlight =
              (r.status === 'processing' || r.status === 'pending') &&
              count === 0;
            // Highlight only the just-landed batch — the effect flips back
            // to false ~2s after the submit settles.
            const highlight = r.id === highlightId;

            return (
              <div
                key={r.id}
                className="flex w-full flex-col items-start gap-1.5"
              >
                {/* Per-batch prompt header — sits above the image card so
                    the user can see what produced each submission without
                    hovering. Trims to 2 lines so a chat-log-style prompt
                    doesn't blow up the row height. */}
                <p className="text-muted-foreground line-clamp-2 max-w-md px-1 text-xs">
                  <span className="text-foreground/70 mr-1 font-medium">
                    {m['playground.image.batch_prompt_label']()}
                  </span>
                  {r.prompt?.trim() || '—'}
                </p>
                <div
                  data-task-id={r.id}
                  className={cn(
                    // Image batch wrapper — no border / rounding / card
                    // background so the tiles sit flush, matching the
                    // packed-masonry convention used by the Community wall.
                    'bg-card/40 w-full p-2',
                    highlight &&
                      'ring-foreground ring-offset-background ring-4 ring-offset-2'
                  )}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    {isInFlight ? (
                      <ProcessingTile
                        prompt={r.prompt || 'Generating…'}
                        highlight={false}
                        taskId={r.id}
                      />
                    ) : (
                      urls.map((url, i) => (
                        <MyImageTile
                          key={`${r.id}-${i}`}
                          url={url}
                          prompt={r.prompt || 'Generated image'}
                          onSelect={() => onSelect(r.id)}
                          highlight={highlight && i === 0}
                          taskId={`${r.id}-${i}`}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder tile for an in-flight task. Shimmer animation so the user
 * can see their submit landed at the top of the grid, plus a thin
 * progress bar that fills from 0% to 95% over ~60s — the API doesn't
 * return a real percentage, so the bar is time-based (linear so it
 * never stalls). The row swaps to the real image once the polling
 * refetch brings imageUrls, so the bar never needs to actually hit 100%.
 */
function ProcessingTile({
  prompt,
  highlight,
  taskId,
}: {
  prompt: string;
  highlight?: boolean;
  taskId: string;
}) {
  return (
    <div
      data-task-id={taskId}
      className={cn(
        // Match MyImageTile's compact width so the spinner aligns with
        // the loaded tiles in the same row — not a giant placeholder
        // stretching across the whole card. No border / rounded corners.
        'bg-foreground/5 relative aspect-square w-36 shrink-0 overflow-hidden',
        highlight &&
          'ring-foreground ring-offset-background ring-4 ring-offset-2'
      )}
      aria-label="Generating image"
    >
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          animation: 'playground-shimmer 1.6s linear infinite',
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
        <Loader2 className="text-muted-foreground relative size-5 animate-spin" />
        <p className="text-muted-foreground relative line-clamp-2 text-center text-xs">
          {prompt}
        </p>
      </div>
      {/* Progress bar pinned to the bottom edge. Animates via the
          `playground-progress-fill` keyframe in globals.css — see the
          comment there for why it caps at 95%. */}
      <div className="bg-foreground/10 absolute inset-x-0 bottom-0 h-1">
        <div data-progress-bar className="brand-gradient h-full" />
      </div>
    </div>
  );
}

function MyImageTile({
  url,
  prompt,
  onSelect,
  highlight,
  taskId,
}: {
  url: string;
  prompt: string;
  onSelect: () => void;
  highlight?: boolean;
  taskId: string;
}) {
  // Each image gets its own aspect ratio so 16:9 / 9:16 / etc. reads as
  // the ratio the user picked. Default to 1:1 while the image loads to
  // keep the grid from jumping, then re-flow to the real ratio on load.
  const [ratio, setRatio] = useState(1);
  // Track whether the image is fully painted so the loading overlay
  // (spinner + progress bar) can stay visible all the way from submit
  // click through the in-flight spinner swap, through the polling
  // resolution, through the <img> byte download, and only then fade
  // out. Without this, the overlay would vanish the moment the URL
  // arrived, leaving a gap before the bytes actually painted.
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // If the image is already cached (browsers can resolve it
  // synchronously from the HTTP cache), `onLoad` may have already fired
  // before this effect ran — `imgRef.current.complete` is the only
  // reliable way to know. Without this, a cached image would show the
  // loading overlay forever.
  useEffect(() => {
    if (imgRef.current?.complete) setIsLoaded(true);
  }, [url]);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-task-id={taskId}
      style={{ aspectRatio: ratio }}
      className={cn(
        // Compact, fixed-width tile (instead of `w-full` stretching to
        // fill the grid cell) so My Image rows read as tidy little
        // tiles rather than a max-width mosaic. No border / rounded
        // corners — matches the Community wall convention.
        'group bg-foreground/5 hover:ring-foreground/30 relative w-36 shrink-0 overflow-hidden hover:ring-2',
        // Pulse ring on the tile that just landed (sync submit or
        // polling resolution). Fades out via the parent state — the
        // class is removed when `highlight` flips back to false.
        highlight &&
          'ring-foreground ring-offset-background ring-4 ring-offset-2'
      )}
    >
      <img
        ref={imgRef}
        src={url}
        alt={prompt}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setRatio(img.naturalWidth / img.naturalHeight);
          }
          setIsLoaded(true);
        }}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          // Treat errors as "loaded" too — otherwise the spinner would
          // sit on top of a hidden <img> forever and the user would
          // never know the tile failed.
          setIsLoaded(true);
        }}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-300',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
      />
      {/*
        Loading overlay — covers the tile until the underlying <img>
        paints its first frame. Reuses the same `[data-progress-bar]`
        keyframe as the in-flight ProcessingTile and the composer-top
        progress bar, so the entire generation→load lifecycle reads as
        one continuous "we're showing you your image" animation. The
        `z-10` keeps the overlay above the (opacity-0) img; once the
        image paints we let the overlay fade and the img fade in,
        giving a smooth crossfade instead of a pop.
      */}
      {!isLoaded ? (
        <div
          className="bg-foreground/5 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-3"
          aria-label="Loading image"
        >
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
              backgroundSize: '200% 100%',
              animation: 'playground-shimmer 1.6s linear infinite',
            }}
          />
          <Loader2 className="text-muted-foreground relative size-5 animate-spin" />
          <p className="text-muted-foreground relative line-clamp-2 text-center text-xs">
            {prompt}
          </p>
          <div className="bg-foreground/10 absolute inset-x-0 bottom-0 h-1 overflow-hidden">
            <div data-progress-bar className="brand-gradient h-full" />
          </div>
        </div>
      ) : null}
      {/* Hover overlay — magnifier + prompt preview. Kept
          subtle so the grid still reads as a grid at rest. */}
      <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
        <p className="line-clamp-2 p-3 text-xs text-white">{prompt}</p>
      </div>
    </button>
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
  // Track when the current submit started so the LATEST RESULT panel
  // can show a live "Generating... Ns" counter. Reset on success.
  const [generatingSince, setGeneratingSince] = useState<number | null>(null);
  // Gateway-provided ETA (seconds) — captured from the async submit
  // response so the panel can show "Generating... Ns / ~Ms" instead of
  // a blind spinner. Reset alongside `generatingSince`.
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null);
  // Inline preview modal — opens when the user clicks a "My Images"
  // thumbnail. We seed it with the row data already in `myImagesQuery`
  // so the image paints instantly (no route bundle, no task fetch),
  // then lazily load the full task for prompt / model / download.
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  // Task id of the most recently landed image. Used to (a) scroll the
  // matching tile into view and (b) ring-highlight it for 2s so the
  // user knows which tile in the grid is their new one.
  const [recentlyLandedTaskId, setRecentlyLandedTaskId] = useState<
    string | null
  >(null);
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

  // Poll the active task until it reaches a terminal status. Aggressive
  // in the first 30s so we catch the moment a model finishes — every
  // missed poll is 1-2s of perceived latency the user stares at the
  // spinner. Eases into a 3s tail for slower models.
  //
  // Capped at 120 attempts. Worst-case wall time:
  //   12 × 500ms + 20 × 1000ms + 30 × 2000ms + 58 × 3000ms
  // ≈ ~5.5 min — covers worst-case generation with 30s headroom. The My
  // Images tab keeps the task visible if it does time out, so the user
  // can re-open it later.
  useEffect(() => {
    if (!pollingTaskId) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 120;

    const nextDelay = (n: number) => {
      // First 20 polls: 100ms — catches sync-style models (gpt-image-2
      // returns inline in 5-15s) and the moment an async task flips to
      // success on its first poll. Cuts the worst-case "submit → first
      // byte" by ~400ms with no real cost (server round-trip is the
      // dominant term anyway).
      // Next 20: 500ms. Then 1.5s up to attempt 62. Tail: 3s.
      if (n <= 20) return 100;
      if (n <= 40) return 500;
      if (n <= 62) return 1500;
      return 3000;
    };

    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const r = await apiGet<{ task: { status: string; [k: string]: any } }>(
          `/api/ai-tasks/${pollingTaskId}`
        );
        if (r.task.status === 'success' || r.task.status === 'failed') {
          // Cache the terminal task payload so the active-image panel
          // (which reads `image-task,id`) renders immediately without
          // waiting for an extra refetch roundtrip.
          if (r.task) {
            queryClient.setQueryData(['image-task', pollingTaskId], {
              task: r.task,
            });
          }
          // Belt-and-suspenders: invalidate the active-task query under
          // both possible keys (pollingTaskId + the store's active id)
          // so a missed cache write or a stale store ref can't strand
          // the panel on the loading state. The fresh fetch lands
          // within a tick and the img renders.
          queryClient.invalidateQueries({
            queryKey: ['image-task', pollingTaskId],
          });
          if (store.activeImageId && store.activeImageId !== pollingTaskId) {
            queryClient.invalidateQueries({
              queryKey: ['image-task', store.activeImageId],
            });
          }
          queryClient.invalidateQueries({ queryKey: ['image-tasks'] });
          queryClient.invalidateQueries({
            queryKey: ['image-tasks', 'mine'],
          });
          setPollingTaskId(null);
          setGeneratingSince(null);
          setEstimatedTotal(null);
          if (r.task.status === 'success') {
            toast.success(m['playground.image.generated']());
            // Surface the landing tile — scrolls into view and pulses
            // for 2s. The user's already on the My Images tab from
            // the submit, so this just anchors their attention.
            setRecentlyLandedTaskId(pollingTaskId);
          }
          return;
        }
      } catch {
        // network blip — keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        setPollingTaskId(null);
        setGeneratingSince(null);
        setEstimatedTotal(null);
        // Refresh the mine-list cache so the user no longer sees the
        // stale "processing" spinner — the row will either reappear as
        // a real image (if the upstream task eventually lands and the
        // server marks it SUCCESS in the background) or stay filtered
        // out (the MyImageRows' 30s-age filter hides it either way).
        queryClient.invalidateQueries({ queryKey: ['image-tasks', 'mine'] });
        queryClient.invalidateQueries({ queryKey: ['image-tasks'] });
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

  // Short-circuit the polling loop the moment the task lands in the
  // mine cache as terminal — without this, the submit button keeps
  // spinning until the *next* poll tick (up to 3s away) even though
  // the row is already showing the real image in My Images. Same fix
  // applies to the failed case so the button un-disables instantly.
  useEffect(() => {
    if (!pollingTaskId) return;
    const row = (myImagesQuery.data?.tasks ?? []).find(
      (t) => t.id === pollingTaskId
    );
    if (row && (row.status === 'success' || row.status === 'failed')) {
      setPollingTaskId(null);
      setGeneratingSince(null);
      setEstimatedTotal(null);
    }
  }, [pollingTaskId, myImagesQuery.data]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Stamp the start time so the LATEST RESULT panel can show a
      // live "Generating... Ns" counter. Reset on success.
      setGeneratingSince(Date.now());
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
              return note
                ? m['playground.image.reference_prompt_with_note']({ n, note })
                : m['playground.image.reference_prompt_untyped']({ n });
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
      // Note: `body.model` is intentionally NOT sent. The picker exposes
      // a handful of cosmetic model names (see COSMETIC_IMAGE_MODELS)
      // but only one provider is wired up, so we let the server fall
      // back to `evolink_image_model` for every submit. If a real
      // multi-provider setup is added later, re-introduce the explicit
      // pick (and the corresponding allowlist on the server).
      // Image count + ratio. The server maps "16:9" → "1792x1024"
      // via the shared `aspect-ratios.ts` module — sending the ratio
      // token directly here is intentional.
      body.n = imageCount;
      if (aspectRatio) body.size = aspectRatio;
      return apiPost<{
        taskId: string;
        status: string;
        imageUrls?: string[];
        imageUrl?: string;
        // Optional — only present on async submissions when the
        // gateway supplied an ETA. The LATEST RESULT panel uses this
        // to show a "Generating… Ns / ~Ms" countdown.
        estimatedSeconds?: number;
        task?: any;
      }>('/api/ai-tasks', body);
    },
    // Switch to the My Images tab the moment the user clicks generate
    // — before the API responds. The gallery is the default "result"
    // surface for an image submit, so the user should land there
    // immediately; otherwise they're stuck staring at the Community
    // wall for a few seconds while the request flies.
    onMutate: () => {
      setTab('mine');
    },
    onSuccess: (data) => {
      // Sync submissions return status='success' with imageUrls inline —
      // cache the task into the query cache so the active-image panel
      // can render immediately, without waiting for a poll.
      if (data.status === 'success' && data.task) {
        queryClient.setQueryData(['image-task', data.taskId], {
          task: data.task,
        });
        setPollingTaskId(null);
      } else {
        setPollingTaskId(data.taskId);
      }
      // Optimistic insert: prepend a synthetic row to the My Images
      // cache *synchronously* so the new batch + progress bar / spinner
      // appear in the grid on the same paint frame as the click —
      // there's no need to wait for the invalidate-triggered refetch
      // to round-trip to the server and back. The eventual real fetch
      // (kept below for correctness) will reconcile any prompt /
      // timestamp deltas with the authoritative server copy.
      queryClient.setQueryData(['image-tasks', 'mine'], (old: any) => {
        if (!old) return old;
        const isImmediate = data.status === 'success';
        const syntheticRow: any = {
          id: data.taskId,
          prompt,
          status: isImmediate ? 'success' : 'processing',
          model: data.task?.model ?? model ?? null,
          createdAt: data.task?.createdAt ?? new Date().toISOString(),
          // Sync returns taskResult.imageUrls populated. Async returns
          // [] so the row renders as a ProcessingTile in MyImageRows.
          imageUrls: isImmediate
            ? (data.task?.taskResult?.imageUrls ?? data.imageUrls ?? [])
            : [],
          thumbnailUrl: isImmediate
            ? (data.task?.taskResult?.imageUrls?.[0] ?? data.imageUrl ?? null)
            : null,
        };
        if (old.tasks?.some((t: any) => t.id === data.taskId)) return old;
        return { tasks: [syntheticRow, ...old.tasks] };
      });
      store.setActiveImageId(data.taskId);
      setPrompt('');
      // Clear any active inline preview — the user is moving to the
      // grid, so the previous focus shouldn't linger.
      setPreviewTaskId(null);
      // Mark this task as the most recently landed image. The My
      // Images tile uses this to (a) scroll into view and (b) ring-
      // highlight for 2 seconds so the user can spot their new tile
      // without scanning the whole grid. The setTimeout fires once;
      // subsequent submits cancel the prior one via a captured ref.
      setRecentlyLandedTaskId(data.taskId);
      // Reconcile against the server (covers prompt edits that the
      // server may have re-shaped, and any imageUrls rehosted after
      // submit). The synthetic row above is already painting by the
      // time this refetch resolves, so the user perceives no delay.
      queryClient.invalidateQueries({ queryKey: ['image-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['image-tasks', 'mine'] });
      if (data.status === 'success') {
        toast.success(m['playground.image.generated']());
      }
      // Sync path: image already in cache, stop the timer.
      // Async path: keep ticking — the polling effect will resolve it.
      if (data.status === 'success') {
        setGeneratingSince(null);
        setEstimatedTotal(null);
      } else {
        // Async path: lock in the gateway ETA (if any) so the panel can
        // show "Generating… Ns / ~Ms". Server only sends this on the
        // initial submit response; subsequent polls don't include it.
        setEstimatedTotal(
          typeof data.estimatedSeconds === 'number' && data.estimatedSeconds > 0
            ? data.estimatedSeconds
            : null
        );
      }
    },
    onError: (e: Error) => {
      // Always clear the timer on error so the panel doesn't stay stuck
      // on "Generating... Ns" forever when the request fails.
      setGeneratingSince(null);
      setEstimatedTotal(null);
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

  // Tick once a second while we're waiting so the elapsed counter in
  // the LATEST RESULT panel updates live. Without this the panel would
  // freeze on the value shown when the panel first rendered.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!generatingSince) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [generatingSince]);
  const elapsedSeconds = generatingSince
    ? Math.max(0, Math.floor((Date.now() - generatingSince) / 1000))
    : 0;

  // Scroll the newly-landed tile into view and fade the highlight after
  // ~2 seconds. We wait a tick so the DOM has the new tile mounted
  // (especially for sync results where the row may not be in cache
  // yet when invalidateQueries fires). The querySelector runs once;
  // if the row isn't mounted yet (e.g. async task still PROCESSING)
  // the highlight will simply not animate — the polling effect will
  // re-trigger this once the tile resolves.
  useEffect(() => {
    if (!recentlyLandedTaskId) return;
    const taskId = recentlyLandedTaskId;
    const id = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-task-id="${taskId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Clear the highlight after the scroll settles. 2.2s gives the
      // CSS transition a touch of breathing room past the scroll
      // (~400-800ms on most browsers).
      setTimeout(() => {
        setRecentlyLandedTaskId((cur) => (cur === taskId ? null : cur));
      }, 2200);
    }, 80);
    return () => clearTimeout(id);
  }, [recentlyLandedTaskId]);

  // Inline preview modal — paints the image from the row's cached
  // thumbnailUrl on first render so the user sees the photo in <100ms.
  // A separate useQuery fetches the full task row in the background
  // (prompt + model + download) and swaps the meta panel when ready.
  const previewRow = previewTaskId
    ? (myImagesQuery.data?.tasks ?? []).find((t) => t.id === previewTaskId)
    : null;
  const previewDetailQuery = useQuery({
    queryKey: ['image-task', previewTaskId],
    queryFn: () => apiGet<{ task: any }>(`/api/ai-tasks/${previewTaskId}`),
    enabled: !!previewTaskId,
    // Already have the thumbnail — don't show the loading skeleton for
    // the image, just wait for the meta.
    staleTime: 30_000,
  });
  const previewDetail = previewDetailQuery.data?.task;
  // Best URL: prefer the higher-quality one from the full task query
  // when it arrives; fall back to the row's thumbnail otherwise.
  const previewUrls: string[] = (() => {
    if (previewDetail?.taskResult) {
      const r =
        typeof previewDetail.taskResult === 'string'
          ? JSON.parse(previewDetail.taskResult)
          : previewDetail.taskResult;
      if (Array.isArray(r?.imageUrls) && r.imageUrls.length) return r.imageUrls;
      if (typeof r?.imageUrl === 'string') return [r.imageUrl];
    }
    return [];
  })();
  const previewUrl = previewUrls[0] || previewRow?.thumbnailUrl;

  /**
   * Save-as download — open the browser's native "Save As" dialog with
   * a sensible default filename, all in one click.
   *
   * Done by navigating to the **server proxy**:
   *   GET /api/ai-tasks/$id/image?download=1
   *
   * Why a proxy? Fetching the upstream provider URL directly from the
   * browser fails with a CORS error (the provider does not set
   * `Access-Control-Allow-Origin`), which was the previous behaviour the
   * user hit. The proxy:
   *
   *   1. authenticates + authorizes ownership (no upstream URL leak),
   *   2. streams the upstream image server-to-server (no CORS in node),
   *   3. stamps `Content-Disposition: attachment; filename="..."`, which
   *      is the standard header that pops the OS "Save As" picker
   *      (folder + filename) regardless of `<a download>` quirks on
   *      cross-origin URLs.
   *
   * We still pass `download` as a hint on the anchor so the browser
   * uses the filename instead of just *opening* the stream.
   */
  function handleDownload() {
    if (!previewTaskId) return;
    const url = `/api/ai-tasks/${previewTaskId}/image?download=1`;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener noreferrer';
    // Filename + Content-Disposition header (set by the proxy) determine
    // the saved file name + folder the user picks. `download=""` is just
    // a hint so the browser doesn't navigate to the stream URL.
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* Floating segmented tab bar — sits above the wall, centered.
          Aceternity-style: a NoiseBackground pill wraps two cut-out
          buttons that read as "windows" through the slab. The inactive
          tab is darker because it sits under the coloured gradient;
          the active tab uses a solid white background so it reads as
          the pressed state. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
        <NoiseBackground
          containerClassName="pointer-events-auto h-10 w-fit rounded-full p-1.5 select-none bg-sidebar/80"
          gradientColors={[]}
          noiseOpacity={0}
          className="rounded-full"
        >
          <div className="relative z-10 flex h-7 items-center gap-1">
            {GALLERY_TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all outline-none',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                  )}
                >
                  <t.icon className="size-4" />
                  {t.label()}
                </button>
              );
            })}
          </div>
        </NoiseBackground>
      </div>

      {/* Scroll track. `pb-56` clears the floating composer (with
          breathing room for the reference-image strip — its tallest
          state can push the composer past 200px). The scrollbar is
          hidden and overscroll contained, matching the reference. */}
      <div className="flex-1 overflow-hidden">
        <div className="no-scrollbar h-full overflow-y-auto overscroll-y-none pb-56">
          {tab === 'community' ? (
            <div className="min-h-full w-full">
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
                  // Jump straight to My Images — the user's own workspace
                  // — instead of leaving them on the Community wall while
                  // they type. The composer is floating (rendered outside
                  // this tab branch), so focusing it right after the tab
                  // switch still lands on a live textarea.
                  onClick={() => {
                    setTab('mine');
                    promptRef.current?.focus();
                  }}
                  className="border-border bg-background hover:bg-foreground/5 mt-8 inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3 text-sm font-medium shadow-xs transition-all"
                >
                  <SparklesIcon className="size-4" />
                  {m['playground.image.wall_cta_button']()}
                </button>
              </div>
            </div>
          ) : previewTaskId ? (
            // Inline preview — replaces the masonry grid when the user
            // clicks a thumbnail. The image paints from the cached
            // `previewRow.thumbnailUrl` instantly; the full task
            // upgrades the prompt / model / download button.
            //
            // The top prompt-summary badge was removed — only the
            // bottom PROMPT block survives, with extra vertical room
            // between the image and the meta panel so the preview
            // breathes instead of feeling cramped.
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-6">
              <section>
                <header className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setPreviewTaskId(null)}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                  >
                    ← {m['playground.image.back_to_grid']()}
                  </button>
                </header>
                {/*
                  Image card — just the picture now. Border and rounded
                  edges still in place here since this is the focal
                  preview surface, not the packed masonry.
                */}
                <div className="border-border bg-card/40 overflow-hidden rounded-2xl border">
                  <div className="bg-foreground/5 flex max-h-[70vh] min-h-[18rem] items-center justify-center overflow-hidden">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt={previewRow?.prompt || 'Generated image'}
                        className="mx-auto max-h-[70vh] w-auto object-contain"
                        decoding="async"
                        loading="eager"
                      />
                    ) : (
                      <div className="flex items-center gap-2 px-6 py-16 text-sm">
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                        <span className="text-muted-foreground">
                          {m['playground.image.generating']()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Meta panel — moved OUTSIDE the image card so it
                    sits below the picture with proper breathing room.
                    Cleaner than hugging the card edge: the prompt and
                    download row no longer fight the image border. */}
                <div className="mt-10">
                  {previewDetail?.prompt || previewRow?.prompt ? (
                    <p className="text-foreground line-clamp-4 text-sm leading-relaxed">
                      {previewDetail?.prompt || previewRow?.prompt}
                    </p>
                  ) : null}
                  <div className="mt-4 flex items-center justify-end gap-3">
                    <div className="flex items-center gap-2">
                      {previewUrl ? (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                        >
                          {m['playground.image.open_in_new_tab']()}
                        </a>
                      ) : null}
                      {previewUrl ? (
                        <button
                          type="button"
                          onClick={handleDownload}
                          className={cn(
                            buttonVariants({ size: 'sm', variant: 'outline' })
                          )}
                        >
                          {m['playground.image.download']()}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-6">
              <section>
                <header className="mb-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setTab('community')}
                    className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    ← {m['playground.image.wall_cta_button']()}
                  </button>
                </header>
                <MyImageRows
                  rows={[...(myImagesQuery.data?.tasks ?? [])].reverse()}
                  onSelect={(id) => {
                    // Inline preview — image paints immediately from
                    // the row's cached imageUrls[0] (no fetch). The
                    // grid is replaced by the preview view above; this
                    // 0-network-roundtrip path keeps the click snappy.
                    setPreviewTaskId(id);
                  }}
                  highlightId={recentlyLandedTaskId}
                />
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Floating composer — shown in both Community and the My Images
          grid view (but never during an image preview, where it would
          cover the meta panel). The scroll track's bottom padding
          (`pb-56`) compensates for the composer's height so the last
          batch row stays fully visible above it — see the surrounding
          `pb-56` on the scroll container. */}
      {!previewTaskId ? (
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
                        {m['playground.image.reference_chip_index']({
                          n: i + 1,
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(r.previewUrl);
                          setReferences((prev) =>
                            prev.filter((_, j) => j !== i)
                          );
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
                {/* Model menu — always rendered so the user can see what's
                  available, even on a deployment that doesn't expose a
                  multi-model gateway (the list falls back to the single
                  default id). "New image" lives in the sidebar CTA
                  (route.tsx), which calls the same clearActive(). */}
                {activeModel ? (
                  <ImageModelMenu
                    // Cosmetic-only: surface several well-known model
                    // names so the picker feels rich. The actual submit
                    // doesn't send `body.model`, so every choice routes
                    // to the same backend provider (see the
                    // COSMETIC_IMAGE_MODELS doc above).
                    models={COSMETIC_IMAGE_MODELS}
                    selected={activeModel}
                    onSelect={setModel}
                  />
                ) : null}
              </div>
              <button
                type="button"
                // Disable on submit OR while a previous task is still
                // polling. The previous code only checked isPending, which
                // let the user fire a second submit mid-poll — that meant
                // two credit deductions and two aiTask rows for one image.
                disabled={
                  !prompt.trim() || submitMutation.isPending || !!pollingTaskId
                }
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
      ) : null}

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
 * The composer is a Grok-style `InputGroup` (textarea + a `block-end`
 * toolbar with a `+` reference picker, four popover-driven value chips
 * (duration / quality / aspect / audio), the model label and submit).
 * Each value chip shows only the current value; clicking opens a small
 * menu that auto-closes after selection.
 */

/* ------------------------------------------------------------------ */
/*  My Videos grid — user's own generated videos                       */
/* ------------------------------------------------------------------ */

/**
 * Renders the user's generated videos as a packed masonry of video tiles.
 * Mirrors `ImagePlayground`'s My Images tab in spirit but keeps the
 * `<video>` element on the tile (instead of `<img>`) so that when
 * Chrome's autoplay heuristic cooperates the tile plays inline. The
 * server-extracted `posterUrl` is wired as the `<video poster>` so the
 * tile always paints SOMETHING — first-frame JPEG shows even when
 * playback is blocked. Clicking the tile still lifts into the
 * active-video panel (`activeVideoId`) for audio + scrub.
 */
function MyVideoTile({
  videoUrl,
  posterUrl,
  duration,
  onSelect,
  taskId,
}: {
  videoUrl: string;
  posterUrl: string;
  duration: number | null;
  onSelect: () => void;
  taskId: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Bypass Chrome's autoplay heuristic on muted videos inside a
  // `<button>` parent by explicitly calling `.play()` after
  // `loadeddata`. If the browser declines, the `poster` keeps the
  // tile visible — so the user always sees at least a still frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => {
      v.play().catch(() => {});
    };
    if (v.readyState >= 2) tryPlay();
    else v.addEventListener('loadeddata', tryPlay, { once: true });
    return () => v.removeEventListener('loadeddata', tryPlay);
  }, [videoUrl]);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-task-id={taskId}
      className="group bg-foreground/5 hover:ring-foreground/30 relative w-full max-w-[320px] shrink-0 overflow-hidden rounded-xl transition-all hover:opacity-90 sm:max-w-[280px]"
      style={{ aspectRatio: '16 / 9' }}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl}
        muted
        loop
        playsInline
        preload="metadata"
        onError={(e) => {
          // Hide the element on hard failure so the placeholder +
          // duration badge stay readable instead of showing
          // forever-loading garbage.
          e.currentTarget.style.display = 'none';
        }}
        className="absolute inset-0 size-full object-cover"
      />
      <span className="bg-foreground/80 text-background pointer-events-none absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight">
        <Film className="size-3" />
        {duration ? `${duration}s` : '…'}
      </span>
    </button>
  );
}

function MyVideosGrid({
  onSelect,
}: {
  onSelect: (task: ImageTaskRow) => void;
}) {
  const query = useQuery({
    queryKey: ['video-tasks', 'mine'],
    queryFn: () =>
      apiGet<{ tasks: ImageTaskRow[] }>(
        '/api/ai-tasks?mediaType=video&limit=50'
      ),
    staleTime: 30_000,
  });

  const tasks = query.data?.tasks ?? [];

  // 30s tick — re-evaluates the staleness filter so a row that was
  // "fresh in-flight" a minute ago automatically hides once the
  // provider has had plenty of time to land a videoUrl. Without this
  // tick, an in-flight task that never produces a URL would render a
  // perpetual spinner (the bug the user reported — trace-test and e2e
  // rows stuck on `<Loader2 animate-spin>` forever).
  //
  // IMPORTANT: these hooks must run unconditionally before any early
  // return. Putting them after `if (query.isPending) return null` made
  // the first render skip them and the second render invoke them —
  // React then threw "Rendered more hooks than during the previous
  // render" and the whole tab crashed.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // While the mine-query is in flight we deliberately render nothing
  // (no spinner). MyImageRows does the same — the section header above
  // the grid still names "My Videos" so the user knows where they are,
  // and a transient blank is friendlier than a perpetual loading dot
  // that never resolves when the request is slow or fails.
  if (query.isPending) return null;

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 pt-32 pb-40 text-center">
        <Film className="text-foreground/30 size-10" />
        <p className="text-foreground/65 mt-3 max-w-xs text-sm leading-relaxed">
          {m['playground.video.my_videos_empty']()}
        </p>
      </div>
    );
  }

  const FRESH_PROCESSING_MS = 30_000;
  const now = Date.now();

  // Sort oldest → newest so the most recent generation lands at the
  // bottom of the list — newer generations stay anchored near the
  // composer (closest to where the user's eye is after submitting),
  // older ones recede upward as the wall grows. The filter runs first
  // so a row that's stuck without a URL after the staleness window
  // simply disappears (no perpetual spinner).
  const sortedTasks = [...tasks]
    .filter((r) => {
      const urls = pickVideoUrls(r);
      if (urls.length > 0) return true;
      const age = now - new Date(r.createdAt).getTime();
      if (
        (r.status === 'processing' || r.status === 'pending') &&
        age < FRESH_PROCESSING_MS
      ) {
        return true;
      }
      return false;
    })
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return ta - tb;
    });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 pt-20 pb-40">
      {sortedTasks.map((task) => {
        // Pull every video URL this submission produced. The API stores
        // them in `imageUrls` for any media-type task (it's a generic
        // media-array field), so a 4-video batch ends up as 4 tiles in
        // this row instead of being collapsed to just the first one.
        const urls = pickVideoUrls(task);
        const duration = pickDuration(task);
        const prompt = task.prompt?.trim() || '';
        return (
          <div key={task.id} className="flex w-full flex-col gap-2">
            {prompt && (
              <p
                className="text-foreground/75 line-clamp-2 px-1 text-xs leading-relaxed"
                title={prompt}
              >
                {prompt}
              </p>
            )}
            <div className="flex w-full flex-wrap items-center justify-start gap-3">
              {urls.map((url, idx) => (
                <MyVideoTile
                  key={url + idx}
                  videoUrl={url}
                  posterUrl={
                    (task as any).posterUrl || url.replace('/file', '/jpg') // soft-fallback
                  }
                  duration={duration}
                  onSelect={() => onSelect(task)}
                  taskId={task.id}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Resolve every playable URL an aiTask produced. The list endpoint
 * (`/api/ai-tasks`) normalizes everything for us — `videoUrls` for a
 * video task, `thumbnailUrl` as a generic first-frame fallback. We do
 * NOT re-parse `taskResult` on the client: the list payload doesn't
 * include that field (only the polling endpoint does), and the legacy
 * client-side parser used to be a dead path that left rows stuck on a
 * perpetual spinner when the URL was missing.
 */
function pickVideoUrls(task: ImageTaskRow): string[] {
  if (Array.isArray(task.videoUrls) && task.videoUrls.length > 0) {
    return task.videoUrls.filter(
      (u): u is string => typeof u === 'string' && !!u
    );
  }
  if (task.thumbnailUrl) return [task.thumbnailUrl];
  return [];
}

/**
 * Read the duration the task was submitted with. Lives on the persisted
 * `options` column (stringified JSON the submit handler wrote via
 * `createTask({ options: { duration, ... } })`). Falls back to a generic
 * badge if the field is missing or unparseable — older tasks created
 * before `options` was persisted simply render `…`.
 */
function pickDuration(task: ImageTaskRow): number | null {
  try {
    const raw = (task as any).options;
    if (!raw) return null;
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const d = Number(r?.duration);
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // ignore
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Video toolbar chips — popover-driven value buttons                 */
/* ------------------------------------------------------------------ */

/**
 * Compact "current value" chip that opens a popover of choices. Renders
 * a `Button` with a single label (and optional icon), then a `Popover`
 * menu styled to match the playground chrome. The `children` render-prop
 * receives a `close` callback so each menu item can dismiss the popover
 * after selection.
 */
function ValuePopover({
  label,
  currentLabel,
  icon,
  children,
}: {
  label: string;
  currentLabel: string;
  icon?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={label}
                  className={cn(
                    'text-foreground/70 hover:text-foreground hover:bg-foreground/5',
                    'h-8 gap-1.5 rounded-md px-2.5 font-mono text-[12px] font-medium tracking-tight'
                  )}
                >
                  {icon}
                  <span>{currentLabel}</span>
                  <ChevronDown
                    className={cn(
                      'size-3 transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-auto min-w-[6rem] p-1"
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Vertical list wrapper for popover menu items. Pairs with `PopoverMenuItem`
 * for the active-row highlight + select affordance.
 */
function PopoverMenu({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

function PopoverMenuItem({
  active,
  onSelect,
  icon,
  children,
}: {
  active?: boolean;
  onSelect: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'hover:bg-foreground/5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors',
        active ? 'text-foreground bg-foreground/5' : 'text-foreground/70'
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {active && <Check className="text-foreground/60 size-3.5" />}
    </button>
  );
}

export function VideoPlayground() {
  const store = usePlaygroundStore();
  const { activeVideoId, clearActive } = store;
  const { data: session } = useSession();

  const VIDEO_MODEL_ID = SEEDANCE_VIDEO_MODEL;
  const VIDEO_QUALITIES: SeedanceVideoQuality[] = ['480p', '720p', '1080p'];
  const VIDEO_ASPECTS: SeedanceVideoAspectRatio[] = [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4',
    '21:9',
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
  // Client-side model override (admin/eval can swap models from the
  // picker). `null` = use whatever the server resolves (admin-configured
  // `evolink_video_model`, default Seedance 2.0).
  const [videoModelOverride, setVideoModelOverride] = useState<string | null>(
    null
  );

  // Reference attachments (image / video) picked from the toolbar `+`
  // button. Stored as object URLs so chips render instantly; the file is
  // kept around so a future submit can hand it to the gen pipeline. For
  // now the API doesn't consume these — UI-only attachment surface.
  type VideoRef = {
    id: string;
    name: string;
    kind: 'image' | 'video';
    previewUrl: string;
  };
  const [videoRefs, setVideoRefs] = useState<VideoRef[]>([]);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  // Tracks every preview URL we've minted so we can revoke them on
  // unmount / removal instead of leaking memory across the session.
  const videoPreviewUrlsRef = useRef<Set<string>>(new Set());

  function openVideoFilePicker() {
    if (!videoFileInputRef.current) return;
    videoFileInputRef.current.click();
  }

  function handleVideoFilesPicked(files: FileList | null) {
    if (!files || !files.length) return;
    const next: VideoRef[] = [];
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) {
        toast.error(
          m['playground.attachment.err_unsupported']({ name: file.name })
        );
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      videoPreviewUrlsRef.current.add(previewUrl);
      next.push({
        id: crypto.randomUUID(),
        name: file.name,
        kind: isVideo ? 'video' : 'image',
        previewUrl,
      });
    }
    if (next.length) {
      setVideoRefs((prev) => [...prev, ...next]);
    }
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
  }

  function removeVideoRef(id: string) {
    setVideoRefs((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        videoPreviewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((r) => r.id !== id);
    });
  }

  useEffect(() => {
    return () => {
      for (const url of videoPreviewUrlsRef.current) URL.revokeObjectURL(url);
      videoPreviewUrlsRef.current.clear();
    };
  }, []);

  // Duration presets surfaced in the toolbar popover. Subset of the
  // provider-accepted range so users see quick picks; finer values can be
  // added by the API.
  const VIDEO_DURATIONS = [6, 11, 15] as const;

  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  // Focus handle for the prompt textarea — the end-cap CTA below the
  // wall scrolls the page back up and focuses this input. Mirrors
  // ImagePlayground's `promptRef`.
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // Gallery tab — 'community' (the curated wall) or 'mine' (the user's
  // own generated videos). Same pattern ImagePlayground uses; switching
  // swaps the scroll-track content but keeps the composer pinned.
  const [tab, setTab] = useState<'community' | 'mine'>('community');

  const queryClient = useQueryClient();
  const { data: publicConfig } = usePublicConfig();
  // Resolved model name from admin overrides. Falls back to the
  // Evolink Seedance default the server picks when the key is unset.
  // Client-side picker override wins if the user picked a different
  // model from the toolbar menu.
  const resolvedVideoModel =
    videoModelOverride || publicConfig?.evolink_video_model || VIDEO_MODEL_ID;
  // Short display label — strip the task-suffix (e.g. "-text-to-video",
  // "-image-to-video") so the toolbar chip stays compact. Full id still
  // goes to the API via `VIDEO_MODEL_ID` / `resolvedVideoModel` callers.
  const videoModelLabel = (resolvedVideoModel || VIDEO_MODEL_ID).replace(
    /-(text|image)-to-video$/i,
    ''
  );
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
        const r = await apiGet<{ task: { status: string } }>(
          `/api/ai-tasks/${pollingTaskId}`
        );
        if (r.task.status === 'success' || r.task.status === 'failed') {
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
        model: resolvedVideoModel,
        prompt: prompt.trim(),
        duration: videoDuration,
        quality: videoQuality,
        aspectRatio: videoAspect,
        generateAudio: true,
      };
      return apiPost<{ taskId: string; status: string; costCredits?: number }>(
        '/api/ai-tasks',
        body
      );
    },
    // Switch to the My Videos tab the moment the user clicks generate
    // — before the API responds. Mirrors ImagePlayground's onMutate.
    onMutate: () => {
      setTab('mine');
    },
    onSuccess: (data) => {
      // Sync submissions return `status: 'success'` with the video URL
      // inline (see `-video.ts` local-fallback path). Cache the task
      // immediately so the active-video panel + My Videos grid render
      // without a 60×2s poll round-trip on tasks that already finished.
      if (data.status === 'success' && (data as any).task) {
        queryClient.setQueryData(['video-task', data.taskId], {
          task: (data as any).task,
        });
        setPollingTaskId(null);
      } else {
        setPollingTaskId(data.taskId);
      }
      store.setActiveVideoId(data.taskId);
      setPrompt('');
      // The tab switch already happened in onMutate; no need to repeat
      // it here. Just make sure the grid refetches the new row.
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

  return (
    <TooltipProvider delay={200}>
      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-transparent">
        {/* Floating admin-disabled notice — sits above the wall at the top,
            mirrors the absolute top chrome used by ImagePlayground's
            tab bar. Hidden when Seedance is enabled. */}
        {!seedanceEnabled && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
            <div className="border-foreground/15 bg-card/80 text-foreground/80 pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs backdrop-blur-md">
              <Film className="size-3.5" />
              {m['playground.video.disabled_notice']()}
            </div>
          </div>
        )}

        {/* Floating segmented tab bar — sits above the wall, centered.
            Identical pattern to ImagePlayground's tab bar (NoiseBackground
            pill wrapping two cut-out buttons). The inactive tab is darker
            because it sits under the gradient; the active tab uses a
            solid `bg-background` so it reads as the pressed state. */}
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <NoiseBackground
            containerClassName="pointer-events-auto h-10 w-fit rounded-full p-1.5 select-none bg-sidebar/80"
            gradientColors={[]}
            noiseOpacity={0}
            className="rounded-full"
          >
            <div className="relative z-10 flex h-7 items-center gap-1">
              {VIDEO_GALLERY_TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all outline-none',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                    )}
                  >
                    <t.icon className="size-4" />
                    {t.label()}
                  </button>
                );
              })}
            </div>
          </NoiseBackground>
        </div>

        {/* Scroll track — identical pattern to ImagePlayground's gallery
            page. `no-scrollbar h-full overflow-y-auto` hides the scrollbar
            but lets the user wheel through the wall. No `pb-56` here on
            purpose: the composer is absolutely positioned at the bottom,
            so the wall runs all the way down and tiles scroll visibly
            behind the composer. */}
        <div className="flex-1 overflow-hidden">
          <div className="no-scrollbar h-full overflow-y-auto overscroll-y-none">
            <div className="min-h-full w-full">
              {activeVideoId ? (
                // Inline video preview — replaces the My Videos grid
                // when the user clicks a tile. Paints the server-
                // extracted poster frame as a still `<img>` (works
                // identically to image gallery) plus an inline `<video>`
                // below it so the user can hit play, hear audio, and
                // scrub normally on the real file.
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-6">
                  <section>
                    <header className="mb-3 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => clearActive()}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                      >
                        ← {m['playground.image.back_to_grid']()}
                      </button>
                    </header>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="bg-foreground/5 text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium">
                        <Film className="size-3.5" />
                        <span className="line-clamp-1 max-w-[calc(100vw-12rem)]">
                          {(taskQuery.data?.task?.prompt || '').trim() ||
                            m['playground.image.preview_default_label']()}
                        </span>
                      </span>
                    </div>
                    <div className="border-border bg-card/40 overflow-hidden rounded-2xl border">
                      <div className="bg-foreground/5 flex max-h-[70vh] min-h-[18rem] items-center justify-center overflow-hidden">
                        {(() => {
                          const tr = (() => {
                            const raw = taskQuery.data?.task?.taskResult;
                            if (!raw) return null;
                            return typeof raw === 'string'
                              ? JSON.parse(raw)
                              : raw;
                          })();
                          const videoUrl =
                            tr?.videoUrl && /^https?:\/\//i.test(tr.videoUrl)
                              ? tr.videoUrl
                              : tr?.videoUrl
                                ? `/api/ai-tasks/${activeVideoId}/file`
                                : null;
                          if (!videoUrl) {
                            return (
                              <div className="flex items-center gap-2 px-6 py-16 text-sm">
                                <Loader2 className="text-muted-foreground size-4 animate-spin" />
                                <span className="text-muted-foreground">
                                  Loading…
                                </span>
                              </div>
                            );
                          }
                          return (
                            <video
                              src={videoUrl}
                              controls
                              autoPlay
                              playsInline
                              className="mx-auto max-h-[70vh] w-auto"
                              poster={tr?.posterUrl}
                            />
                          );
                        })()}
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
                          {m['playground.image.preview_prompt_label']()}
                        </p>
                        <p className="text-foreground mt-1.5 line-clamp-4 text-sm leading-relaxed">
                          {taskQuery.data?.task?.prompt}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-muted-foreground truncate text-xs">
                            {taskQuery.data?.task?.model ? (
                              <span className="font-mono">
                                {taskQuery.data.task.model}
                              </span>
                            ) : null}
                          </div>
                          <a
                            href={`/api/ai-tasks/${activeVideoId}/file?download=1`}
                            download
                            className="border-border bg-background hover:bg-foreground/5 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-xs transition-all"
                          >
                            <Download className="size-3.5" />
                            {m['playground.image.download']()}
                          </a>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : tab === 'community' ? (
                <>
                  <GalleryWall items={VIDEO_BACKGROUND_ITEMS} />
                  {/* End-cap — the payoff after scrolling the wall. Click
                      jumps focus to the prompt textarea so the user can
                      start typing immediately. Mirrors ImagePlayground's
                      wall_cta. `pb-40` keeps the CTA comfortably above the
                      floating composer (which is absolute bottom-6, plus
                      its own padding). */}
                  <div className="flex flex-col items-center px-4 pt-20 pb-56">
                    <p className="text-foreground text-center text-2xl font-bold tracking-tight sm:text-3xl">
                      {m['playground.image.wall_cta_title']()}
                    </p>
                    <p className="text-muted-foreground mt-3 max-w-xs text-center text-sm leading-relaxed">
                      {m['playground.image.wall_cta_sub']()}
                    </p>
                    <button
                      type="button"
                      // Jump to the My Videos tab and focus the prompt
                      // in one click — same affordance ImagePlayground
                      // uses. The composer is pinned outside the tab
                      // switch, so the focus call survives the re-render.
                      onClick={() => {
                        setTab('mine');
                        promptRef.current?.focus();
                      }}
                      className="border-border bg-background hover:bg-foreground/5 mt-8 inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium shadow-sm transition-all"
                    >
                      <SparklesIcon className="size-4" />
                      {m['playground.image.wall_cta_button']()}
                    </button>
                  </div>
                </>
              ) : (
                <MyVideosGrid
                  onSelect={(task) => {
                    store.setActiveVideoId(task.id);
                    promptRef.current?.focus();
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Composer — Grok-style input group floating over the wall at the
            bottom of the viewport. Absolutely positioned so the gallery
            wall scrolls beneath it instead of stopping above it. The
            frosted `bg-sidebar/80 backdrop-blur-sm` keeps wall tiles
            faintly visible through the composer chrome. */}
        <div className="absolute inset-x-0 bottom-6 z-20 mx-auto w-full max-w-3xl px-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submitMutation.mutate();
            }}
          >
            <InputGroup
              className={cn(
                'h-auto min-h-16',
                'bg-sidebar/80 dark:bg-sidebar/80 rounded-2xl p-1.5 backdrop-blur-sm'
              )}
            >
              <div className="contents">
                <div className="flex w-full items-start gap-2 px-2.5">
                  <InputGroupTextarea
                    ref={promptRef}
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

              {/* Reference attachment thumbnails (image / video). Shown
                  at the top-left of the dialog with actual preview
                  frames, each with a top-right ❌ for quick removal.
                  Videos render the first frame (preload="metadata") so
                  we don't autoplay motion in the composer. */}
              {videoRefs.length > 0 && (
                <div className="order-2 flex w-full flex-wrap gap-2 px-3 pt-2">
                  {videoRefs.map((r) => (
                    <div
                      key={r.id}
                      className="border-foreground/10 bg-muted/40 relative size-16 shrink-0 overflow-hidden rounded-lg border"
                      title={r.name}
                    >
                      {r.kind === 'image' ? (
                        <img
                          src={r.previewUrl}
                          alt={r.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <>
                          <video
                            src={r.previewUrl}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                          <span className="bg-foreground/70 text-background pointer-events-none absolute bottom-0.5 left-0.5 inline-flex items-center gap-0.5 rounded px-1 py-px font-mono text-[9px] font-medium tracking-tight">
                            <Film className="size-2.5" />
                            {m['playground.video.attachment_video_badge']()}
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeVideoRef(r.id)}
                        aria-label={m['playground.video.attachment_remove']()}
                        title={m['playground.video.attachment_remove']()}
                        className="bg-foreground/80 hover:bg-foreground text-background absolute top-0.5 right-0.5 inline-flex size-5 items-center justify-center rounded-full shadow-sm transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <InputGroupAddon align="block-end" className="order-last w-full">
                {/* Left cluster: hidden file input + `+` picker button +
                    4 popover-driven value chips (Duration / Quality /
                    Aspect / Audio). Each chip shows only the current
                    value; click opens a small menu and auto-closes after
                    selection, matching the Grok reference layout. */}
                <input
                  ref={videoFileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => handleVideoFilesPicked(e.target.files)}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={m['playground.attachment.add']()}
                          onClick={openVideoFilePicker}
                          className="text-foreground/70 hover:text-foreground hover:bg-foreground/5"
                        >
                          <Plus className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>
                      {m['playground.attachment.add']()}
                    </TooltipContent>
                  </Tooltip>

                  {/* Duration chip */}
                  <ValuePopover
                    label={m['playground.video.duration']()}
                    currentLabel={`${videoDuration}s`}
                  >
                    {(close) => (
                      <PopoverMenu>
                        {VIDEO_DURATIONS.map((d) => (
                          <PopoverMenuItem
                            key={d}
                            active={d === videoDuration}
                            onSelect={() => {
                              setVideoDuration(d);
                              close();
                            }}
                          >
                            {d}s
                          </PopoverMenuItem>
                        ))}
                      </PopoverMenu>
                    )}
                  </ValuePopover>

                  {/* Quality chip */}
                  <ValuePopover
                    label={m['playground.video.quality']()}
                    currentLabel={videoQuality}
                  >
                    {(close) => (
                      <PopoverMenu>
                        {VIDEO_QUALITIES.map((q) => (
                          <PopoverMenuItem
                            key={q}
                            active={q === videoQuality}
                            onSelect={() => {
                              setVideoQuality(q);
                              close();
                            }}
                          >
                            {q}
                          </PopoverMenuItem>
                        ))}
                      </PopoverMenu>
                    )}
                  </ValuePopover>

                  {/* Aspect chip */}
                  <ValuePopover
                    label={m['playground.video.aspect']()}
                    currentLabel={videoAspect}
                  >
                    {(close) => (
                      <PopoverMenu>
                        {VIDEO_ASPECTS.map((a) => (
                          <PopoverMenuItem
                            key={a}
                            active={a === videoAspect}
                            onSelect={() => {
                              setVideoAspect(a);
                              close();
                            }}
                          >
                            {a}
                          </PopoverMenuItem>
                        ))}
                      </PopoverMenu>
                    )}
                  </ValuePopover>
                </div>

                <div className="flex min-w-0 items-center gap-1">
                  <VideoModelPicker
                    // Curated 5-brand lineup. Only Seedance 2.0 is
                    // wired to the gateway today; the other four are
                    // display-only and the user gets a provider error
                    // on submit if their gateway doesn't serve them.
                    // Same affordance as the chat picker (which routes
                    // every selection through the configured
                    // `evolink_model` server-side).
                    models={[
                      'seedance-2.0',
                      'kling-3.0-turbo',
                      'gemini-omni-flash',
                      'veo-3.1',
                      'sora-2',
                    ]}
                    selected={resolvedVideoModel || VIDEO_MODEL_ID}
                    onSelect={(id) => {
                      setVideoModelOverride(id);
                      toast.success(
                        m['playground.video.model_changed']({ id })
                      );
                    }}
                  />

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

  if (mode === 'chat') {
    const list = (chatsQuery.data?.chats ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    if (!list.length) {
      return null;
    }

    return (
      <div className="flex flex-col gap-1">
        {list.map((c, i) => (
          <SessionRow
            key={c.id}
            index={i + 1}
            // No `[Chat #N]` chip — chat rows don't need an extra
            // marker when the row itself is identifiable by the
            // (optional) conversation title on the right.
            label=""
            title={c.title?.trim() || ''}
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
    // Per product direction: the video sidebar slot is intentionally
    // empty — video history is reached via the "My Videos" tab inside
    // the playground, not via the side rail. Returning null here
    // also collapses the "Video" section header, since the slot has
    // nothing to list.
    return null;
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
  /** Tiny `[Chat #N]`-style chip rendered to the left of the row when
   *  there's no thumbnail. Optional — pass `undefined` (or empty) to
   *  hide it entirely (used by the chat-mode sidebar, where the
   *  numeric index adds no information the user can act on). */
  label?: string;
  /** Main title text. Empty string renders an empty click-target; the
   *  call site decides whether to show a placeholder like "Untitled"
   *  or hide it altogether. */
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
      ) : label ? (
        <span className="text-foreground/55 min-w-[5.5rem] shrink-0 font-mono text-[11px]">
          {label}
        </span>
      ) : null}
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
