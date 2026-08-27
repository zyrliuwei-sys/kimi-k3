import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  Atom,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Copy,
  CornerDownLeft,
  Crown,
  Download,
  Eraser,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  MoveRight,
  Pencil,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  Sparkles as SparklesIcon,
  Square,
  Terminal,
  Trash2,
  Triangle,
  Type,
  Undo2,
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
import { ImageStreamHero } from '@/components/image-stream-hero';
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

interface UploadResult {
  url: string;
  key: string;
  filename: string;
  type: 'image' | 'video' | 'document';
  error?: string;
}

function isReadyAttachment(attachment: Attachment): boolean {
  return (
    attachment.uploadStatus === 'done' &&
    Boolean(attachment.url) &&
    !attachment.url.startsWith('blob:')
  );
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
async function uploadMediaFiles(files: File[]): Promise<UploadResult[]> {
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
  return result.data.results as UploadResult[];
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
  'pages',
  'numbers',
  'md',
  'txt',
  'csv',
]);

type FileValidationIssue = 'size' | 'mime';

function hasSupportedDocumentExtension(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_DOCUMENT_EXTENSIONS.has(ext);
}

function isSupportedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return ALLOWED_MIME_EXACT.has(mime);
}

function getFileValidationIssue(file: File): FileValidationIssue | null {
  if (file.size > MAX_FILE_BYTES) return 'size';
  if (
    !isSupportedMime(file.type) &&
    !hasSupportedDocumentExtension(file.name)
  ) {
    return 'mime';
  }
  return null;
}

function notifyFileValidationIssue(file: File, issue: FileValidationIssue) {
  if (issue === 'size') {
    toast.error(m['playground.attachment.err_too_large']({ name: file.name }));
    return;
  }
  toast.error(m['playground.attachment.err_unsupported']({ name: file.name }));
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

  const modelId = 'Kimi K3';
  const [authOpen, setAuthOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
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
    let list: File[] = [];

    // Validate each item independently. A bad file must never prevent the
    // other files in the same Finder drop from being added to the composer.
    for (const file of Array.from(files)) {
      const issue = getFileValidationIssue(file);
      if (issue) {
        notifyFileValidationIssue(file, issue);
        continue;
      }
      list.push(file);
    }
    if (!list.length) {
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
            if (!result || result.error || !result.url) {
              return { ...a, uploadStatus: 'error' };
            }
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
    if (explicitAttachments.some((a) => a.uploadStatus === 'uploading')) {
      // The send control is disabled while files upload, but this explicit
      // guard also covers Enter / IME events that arrive during a state update.
      // Never send a browser-local blob: URL to the server.
      return;
    }
    const readyExplicitAttachments =
      explicitAttachments.filter(isReadyAttachment);

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
        if (att.type !== 'document' || !isReadyAttachment(att)) continue;
        if (!historicalDocs.has(att.url)) historicalDocs.set(att.url, att);
      }
    }
    const merged: Attachment[] = [];
    const seen = new Set<string>();
    for (const att of [
      ...readyExplicitAttachments,
      ...historicalDocs.values(),
    ]) {
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
      attachments: readyExplicitAttachments.length
        ? readyExplicitAttachments
        : undefined,
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

  const hasThread = messages.length > 0 || isThinking;
  const hasPendingUploads = attachments.some(
    (attachment) => attachment.uploadStatus === 'uploading'
  );
  const canSend =
    !!input.trim() ||
    attachments.some((attachment) => isReadyAttachment(attachment));

  const composerProps = {
    input,
    setInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    canSend,
    isThinking: isThinking || hasPendingUploads,
    modelId,
    taRef,
    attachments,
    uploading: hasPendingUploads,
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
          <div className="flex w-full max-w-3xl translate-y-10 flex-col items-center sm:translate-y-12">
            <WelcomeState />
            <div className="mt-14 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}

      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      <PlaygroundPaymentDialog
        open={billingOpen}
        onOpenChange={setBillingOpen}
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
  callbackUrl = '/api-playground',
}: {
  open: boolean;
  onClose: () => void;
  /** Return to the active workspace after completing authentication. */
  callbackUrl?: string;
}) {
  const { data: configs } = usePublicConfig();
  const googleEnabled = configs?.google_auth_enabled === 'true';

  // One-click Google OAuth. The provider is registered server-side whenever
  // google_client_id/secret are set, so this works as long as it's enabled.
  async function handleGoogle() {
    await signIn.social({
      provider: 'google',
      callbackURL: callbackUrl,
    });
  }

  const signUpHref = `/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;

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
                  href={signUpHref}
                  onClick={onClose}
                  className="brand-gradient inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95"
                >
                  {m['playground.auth.sign_up']()}
                </Link>
                <Link
                  href={signInHref}
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

/**
 * Shared checkout prompt for every paid playground action. Keeping the
 * checkout configuration here makes the chat and image gates behave exactly
 * alike instead of leaving one of them as a toast or an inline message.
 */
function PlaygroundPaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);

  return (
    <PaymentProviderModal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setLoadingProvider(null);
      }}
      providers={['creem']}
      loadingProvider={loadingProvider}
      title={m['playground.payment_required.title']()}
      description={m['playground.payment_required.description']()}
      onSelect={async (provider) => {
        setLoadingProvider(provider);
        try {
          const result = await apiPost<{ checkout_url?: string }>(
            '/api/payment/checkout',
            {
              plan_id: 'starter',
              payment_provider: provider,
            }
          );
          if (result.checkout_url) {
            window.location.href = result.checkout_url;
            return;
          }
          toast.error('Failed to open checkout');
        } catch {
          toast.error('Failed to open checkout');
        } finally {
          setLoadingProvider(null);
        }
      }}
    />
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
  modelId,
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
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  uploading: boolean;
  onPlusClick: () => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [isFileDragging, setIsFileDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const sendAfterCompositionRef = useRef(false);

  // A browser navigates to a local file by default when it is dropped outside
  // of a native file input. Keep that destructive navigation from happening
  // anywhere while the composer is mounted; the composer itself handles the
  // useful drop below.
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      event.nativeEvent.isComposing
    ) {
      // Chinese/Japanese IMEs use Enter to commit the current candidate. Send
      // on key-up after that commit, so one Enter still has the expected
      // "send" result instead of silently doing nothing.
      sendAfterCompositionRef.current = true;
      return;
    }
    onKeyDown(event);
  }

  function handleComposerKeyUp(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === 'Enter' &&
      sendAfterCompositionRef.current &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      sendAfterCompositionRef.current = false;
      onSend();
    }
  }

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        onDragEnter={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setIsFileDragging(true);
        }}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsFileDragging(false);
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          dragDepthRef.current = 0;
          setIsFileDragging(false);
          onFilesSelected(event.dataTransfer.files);
        }}
        className={cn(
          'border-foreground/20 focus-within:border-foreground/35 dark:bg-foreground/5 rounded-[1.5rem] border bg-white py-4 pr-7 pl-3 shadow-sm transition-all focus-within:shadow-[0_10px_44px_-14px_rgba(124,58,237,0.3)]',
          isFileDragging &&
            'border-primary bg-primary/[0.035] ring-primary/15 shadow-[0_10px_44px_-14px_rgba(124,58,237,0.3)] ring-4'
        )}
      >
        {/* Hidden media input — images + videos, multi-select. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pages,.numbers,.md,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,text/csv"
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
          onKeyDown={handleComposerKeyDown}
          onKeyUp={handleComposerKeyUp}
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

        <div className="flex items-center justify-between gap-2 pt-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPlusClick}
              aria-label={m['playground.attachment.add']()}
              title={m['playground.attachment.add']()}
              className="text-foreground/55 hover:text-foreground hover:bg-foreground/5 flex size-10 translate-y-2 items-center justify-center rounded-full transition-colors"
            >
              <Plus className="size-[22px]" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="mr-2">
              <ChatModelPicker selectedId={modelId} />
            </div>
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
      {/* Entry point. Kept intentionally quiet so the welcome state leads. */}
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" className="text-sm font-medium">
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
      className={cn('flex', isUser && 'justify-end')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'rounded-tr-md bg-white text-black'
            : 'border-foreground/10 rounded-tl-md border bg-white text-black shadow-sm'
        )}
      >
        {images.length > 0 && (
          <div
            className={cn(
              'mb-2 flex flex-col gap-3',
              message.content.trim() && 'mb-2.5'
            )}
          >
            {images.map((img) => (
              <div key={img.url} className="flex flex-col gap-2">
                {/* Label above the image — matches the reference design
                    (the "✨ Generated an image" caption that sits above
                    the picture card). Lives OUTSIDE the card so the
                    image stays flush with the bubble's left edge. */}
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <span>{m['playground.image.generated_label']()}</span>
                </div>
                <a
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  className="border-foreground/10 bg-background block overflow-hidden rounded-xl border shadow-sm"
                >
                  {/* Larger image card — replaces the previous 128px
                      h-32 w-32 thumbnail. `max-h` + `object-contain`
                      keeps the picture proportional regardless of its
                      native aspect ratio, and a 24px cap on width
                      lets the image fill the chat bubble without
                      overflowing the 85% max-w on the parent. */}
                  <img
                    src={img.previewUrl || img.url}
                    alt={img.filename || ''}
                    className="max-h-96 max-w-full object-contain"
                  />
                </a>
              </div>
            ))}
          </div>
        )}
        {videos.length > 0 && (
          <div className="mb-2 flex w-full flex-wrap justify-start gap-2 text-left">
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
          <div className="mb-2 flex w-full flex-wrap justify-start gap-2 text-left">
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
            <span className="ml-4 whitespace-pre-wrap">{message.content}</span>
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
    <div className="flex">
      <div className="border-foreground/10 flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-white px-4 py-3 shadow-sm">
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
  /** Public/provider URLs paired with `imageUrls`. Used only if the
   * authenticated image proxy cannot render the primary URL. */
  imageFallbackUrls?: string[] | null;
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
  const { activeChatId } = store;
  const queryClient = useQueryClient();
  const { data: session, isPending: isSessionPending } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const modelId = 'Kimi K3';

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  function requireAuth(): boolean {
    // Avoid showing the auth dialog during the initial session lookup. A
    // logged-in visitor who clicks immediately should not get a false gate.
    if (isSessionPending) return false;
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

  // When the active chat resolves, hydrate local messages + scroll. Never let
  // an initial empty response replace a turn that is currently streaming: a
  // new chat is created before its first message is persisted, so that race
  // previously made the just-sent bubble disappear.
  useEffect(() => {
    if (!chatQuery.data?.messages || isThinking) return;
    const hydratedMessages = chatQuery.data.messages.map(
      (m: any, i: number) => ({
        id: i + 1,
        role: m.role,
        content: m.content,
      })
    );
    idRef.current = hydratedMessages.length;
    setMessages(hydratedMessages);
    // Deliberately omit `isThinking` from dependencies. If the initial empty
    // read arrived while streaming, changing back to idle must not replay that
    // stale response over the local transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, chatQuery.data]);

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
    let list: File[] = [];

    // The chat composer and the public playground share this expectation:
    // valid files in a mixed drag stay attached even when one item is invalid.
    for (const file of Array.from(files)) {
      const issue = getFileValidationIssue(file);
      if (issue) {
        notifyFileValidationIssue(file, issue);
        continue;
      }
      list.push(file);
    }
    if (!list.length) {
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
            if (!result || result.error || !result.url) {
              return { ...a, uploadStatus: 'error' };
            }
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
    // Keep the draft in place and open the login dialog before creating a
    // chat row or submitting a stream. This gives anonymous users a clear
    // next step instead of briefly rendering a blocked message in the thread.
    if (!requireAuth()) return;
    const text = input.trim();
    if (attachments.some((a) => a.uploadStatus === 'uploading')) return;
    const submittedAttachments = attachments.filter(isReadyAttachment);
    if (!text && submittedAttachments.length === 0) return;
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
      attachments: submittedAttachments.length
        ? submittedAttachments
        : undefined,
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
          attachments: submittedAttachments.map((a) => {
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
              // A stale session can expire between the client-side check and
              // the stream request. Treat that race exactly like the initial
              // login gate and keep the draft available after authentication.
              setAuthOpen(true);
              setMessages((prev) =>
                prev.filter(
                  (message) =>
                    message.id !== userMsg.id && message.id !== assistantId
                )
              );
              setInput(text);
              setAttachments(submittedAttachments);
              return;
            }
            // Restore the blocked draft and let the checkout dialog own the
            // next step. The user can retry the exact same prompt after a
            // successful purchase instead of having to type it again.
            setMessages((prev) =>
              prev.filter(
                (message) =>
                  message.id !== userMsg.id && message.id !== assistantId
              )
            );
            setInput(text);
            setAttachments(submittedAttachments);
            setBillingOpen(true);
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
            // The persistent endpoint saves the canonical pair before its
            // `done` event. Refresh it now so this transcript survives a
            // reload and the sidebar receives the updated session title.
            if (chatId) {
              queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
              queryClient.invalidateQueries({ queryKey: ['chats'] });
            }
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
  const hasPendingUploads = attachments.some(
    (attachment) => attachment.uploadStatus === 'uploading'
  );
  const composerProps = {
    input,
    setInput,
    onKeyDown: handleKeyDown,
    onSend: handleSend,
    canSend:
      !!input.trim() ||
      attachments.some((attachment) => isReadyAttachment(attachment)),
    isThinking: isThinking || hasPendingUploads,
    modelId,
    taRef,
    attachments,
    uploading: hasPendingUploads,
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
          <div className="flex w-full max-w-3xl translate-y-10 flex-col items-center sm:translate-y-12">
            <WelcomeState />
            <div className="mt-14 w-full">
              <Composer {...composerProps} />
            </div>
          </div>
        </div>
      )}

      <AuthPromptDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      <PlaygroundPaymentDialog
        open={billingOpen}
        onOpenChange={setBillingOpen}
      />
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

type Tile = {
  src: string;
  ratio: number;
  alt: string;
  /** Intrinsic-sized attributes for static gallery images. */
  width?: number;
  height?: number;
  // 'image' renders <img>; 'video' renders a looping muted <video> with an
  // underlying <img> poster fallback (so the cell still shows the first
  // frame when autoplay is throttled or the video fails to decode).
  // Default is 'image' so existing tiles in GALLERY_ITEMS don't need to
  // be touched.
  kind?: 'image' | 'video';
  // Image shown underneath a video tile. Used both as the <video poster>
  // attribute and as a static <img> fallback layer.
  poster?: string;
};

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

// Source dimensions are deliberately part of the catalog. The surrounding
// cards inherit each image's native aspect ratio, so full compositions stay
// intact instead of being cropped into a predefined gallery template.
const GALLERY_IMAGE_DIMENSIONS: Record<string, readonly [number, number]> = {
  'meigen-2015866705197580703.jpg': [960, 1200],
  'meigen-2032013831548125557.jpg': [896, 1200],
  'meigen-2036806218988315056-1.jpg': [904, 1200],
  'meigen-2049059204632080436-1.jpg': [1200, 1200],
  'meigen-2052074741050008057.jpg': [960, 1200],
  'meigen-2054127368365908220-1.jpg': [554, 1200],
  'meigen-2063092464592863250-1.jpg': [960, 1200],
  'meigen-2067745145655804012.jpg': [675, 1199],
  'meigen-2070794675179405365.jpg': [960, 1200],
  'meigen-2074182489141293070-1.jpg': [900, 1200],
  'meigen-2080212481402896518-1.jpg': [904, 1200],
  'meigen-2082385036268229117-1.jpg': [900, 1200],
  'meigen-community_298030b1-c8c1-4436-b88f-5ae556af9c6a.png': [1024, 1344],
  'meigen-community_3b7948d3-2ddf-4d48-827a-45950c8b690a.jpg': [1536, 2752],
  'meigen-community_5f68dfb7-b6d5-4734-b887-f5fed7c9d1af.jpg': [1696, 2528],
  'xinjia/meigen-2019001339985133694.jpg': [1024, 1024],
  'xinjia/meigen-2024104039827578910-1.jpg': [967, 1200],
  'xinjia/meigen-2032542713170838002-1.jpg': [662, 1186],
  'xinjia/meigen-2060729668958097717-1.jpg': [675, 1200],
  'xinjia/meigen-2069018297228575178-2.jpg': [675, 1199],
  'xinjia/meigen-2069018297228575178-3.jpg': [675, 1199],
  'xinjia/meigen-community_093ff2f3-b586-4e7f-a23c-63408a76158e.png': [
    1632, 2048,
  ],
  'xinjia/meigen-community_127719af-811c-4e1c-81cb-a26aeba3a263.png': [
    1344, 1776,
  ],
  'xinjia/meigen-community_37f3ab08-800a-456b-b8bb-ff26724222ea.png': [
    1024, 1344,
  ],
  'xinjia/meigen-community_4461cb95-6748-4232-99cc-3d23b67c0b63.png': [
    1344, 1776,
  ],
  'xinjia/meigen-community_892129d5-dae0-4764-b03c-6a11e2e12b26.png': [
    1360, 2048,
  ],
  'xinjia/meigen-community_a2cca04e-085b-444c-95bb-6d6e2ab3b9aa.png': [
    1008, 1792,
  ],
  'xinjia/meigen-community_b827f6c2-5165-428e-9992-61f1de9e8ae3.png': [
    1008, 1792,
  ],
  'xinjia/meigen-community_c18ad1be-f6fb-4e2b-970d-932dff8832b9.png': [
    1632, 2048,
  ],
  'xinjia/meigen-community_dff3afb9-3e67-4f21-a382-786bc9b8c466.png': [
    1152, 2048,
  ],
  'xinjia/meigen-community_e690fd0d-4ea6-488f-8592-c2dd0ac92c7e.png': [
    1152, 2048,
  ],
  'xinjia/meigen-community_fb7a6b33-4d3a-459f-87e5-c67f611dd9a2.png': [
    1344, 1776,
  ],
  'zaixinjia/meigen-2006643289185989070-1.jpg': [1024, 1024],
  'zaixinjia/meigen-2006643289185989070-4.jpg': [1024, 1024],
  'zaixinjia/meigen-2008986705962123774-1.jpg': [768, 1376],
  'zaixinjia/meigen-2010381897730339152-1.jpg': [1374, 2048],
  'zaixinjia/meigen-2024707382727889320-1.jpg': [670, 1200],
  'zaixinjia/meigen-2041163046874382357-1.jpg': [670, 1200],
  'zaixinjia/meigen-2048598185841734064.jpg': [784, 1168],
  'zaixinjia/meigen-2050472802327900342.jpg': [800, 1200],
  'zaixinjia/meigen-2050954496474570805.jpg': [800, 1200],
  'zaixinjia/meigen-2061832450842726614.jpg': [1024, 1024],
  'zaixinjia/meigen-2066386292217467241-1.jpg': [800, 1200],
  'zaixinjia/meigen-2082480882695491628-1.jpg': [900, 1200],
  'zaixinjia/meigen-community_0013511a-1eeb-4279-8490-eb0195f9a4df.png': [
    1024, 1344,
  ],
  'zaixinjia/meigen-community_0ed9e02e-7ad6-4b72-b2eb-2aef0a175cec.png': [
    1024, 1344,
  ],
  'zaixinjia/meigen-community_15849a4b-8001-4c6b-aac2-ceea6b9ff18a.png': [
    1024, 1280,
  ],
  'zaixinjia/meigen-community_24b38e2e-777e-4949-aa12-1747132346db.png': [
    1008, 1792,
  ],
  'zaixinjia/meigen-community_32dd8162-6fc0-4124-ba7d-887bfdda6d72.png': [
    1152, 2048,
  ],
  'zaixinjia/meigen-community_3bab0153-80b1-425a-abfb-96d239fb43cf.png': [
    1024, 1344,
  ],
  'zaixinjia/meigen-community_9786c744-2f71-4f16-abeb-fc5aa1cf7d6b.png': [
    1344, 1776,
  ],
  'zaixinjia/meigen-community_db1519d0-055f-4c18-b4e6-6d62bfba1e7f.png': [
    1344, 1776,
  ],
  'zaizaijia/meigen-2010358364048597154.jpg': [1024, 1536],
  'zaizaijia/meigen-2019629174374429017-1.jpg': [675, 1200],
  'zaizaijia/meigen-2020531946108158457-1.jpg': [675, 1200],
  'zaizaijia/meigen-2049363203998818532.jpg': [800, 1200],
  'zaizaijia/meigen-2064946524031988094.jpg': [898, 1200],
  'zaizaijia/meigen-2075143065493229752-2.jpg': [1199, 675],
  'zaizaijia/meigen-2075575662316749255-1.jpg': [1199, 675],
  'zaizaijia/meigen-2075575662316749255-2.jpg': [1199, 675],
  'zaizaijia/meigen-2079908139281809722.jpg': [960, 1200],
  'zaizaijia/meigen-2080143259557581285-1.jpg': [928, 1152],
  'zaizaijia/meigen-community_00e1b966-c37c-47ed-99f3-fd891271b517.png': [
    1008, 1792,
  ],
  'zaizaijia/meigen-community_3e031315-9073-47f3-bf6a-93c32cf50da9.png': [
    1008, 1792,
  ],
  'zaizaijia/meigen-community_5fe15de6-ea3c-4bd4-88db-0db201a8b7b4.png': [
    1152, 2048,
  ],
  'zaizaijia/meigen-community_6f65fc5d-7d3a-48d6-908c-2bf947fd1c23.png': [
    1360, 2048,
  ],
  'zaizaijia/meigen-community_85e0a391-9f8c-4860-9fac-c5446dc2d39c.png': [
    1024, 1024,
  ],
};

// Render every community image exactly once. The deterministic source order
// keeps SSR and CSR output identical without duplicating any scene.
const GALLERY_ITEMS: Tile[] = MEIGEN_IMAGE_FILES.map((fileName) => {
  const [width, height] = GALLERY_IMAGE_DIMENSIONS[fileName] ?? [1, 1];
  return {
    src: `/image/${fileName}`,
    ratio: width / height,
    alt: 'community image',
    width,
    height,
  };
});

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
 *
 * If `maxHeight` is set, the packer stops placing tiles the moment any
 * column would exceed it. That gives the background-wall variant a
 * viewport-sized layout without re-implementing the algorithm.
 */
function packMasonry(
  items: Tile[],
  containerWidth: number,
  columnCount: number,
  gap: number,
  maxHeight?: number
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
    // Background mode: bail when this tile would overflow the cap. The
    // remaining items stay off-screen — callers pick a catalog sized for
    // the largest expected viewport (we cycle to fill).
    if (maxHeight !== undefined && heights[target] + height > maxHeight) {
      break;
    }
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
                className="absolute inset-0 size-full object-contain"
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

/**
 * Community gallery for the image playground. It begins as a compact visual
 * corridor, then lets visitors expand into the complete collection on demand.
 */
function CommunityImageGrid({
  eagerFirstImage = false,
}: {
  eagerFirstImage?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  if (GALLERY_ITEMS.length === 0) return null;

  return (
    <section className="bg-white py-8 sm:py-12 dark:bg-[#050505]">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <ImageStreamHero
          images={GALLERY_ITEMS.slice(0, 18)}
          eagerFirstImage={eagerFirstImage}
          className="h-[440px] rounded-[1.75rem] border border-white/12 sm:h-[540px] sm:rounded-[2.25rem]"
        >
          <div className="flex h-full flex-col items-center justify-between px-5 py-7 text-center sm:px-10 sm:py-10">
            <header className="max-w-xl">
              <p className="text-[10px] font-semibold tracking-[0.24em] text-white/60 uppercase">
                {m['playground.image.gallery_eyebrow']()}
              </p>
              <h2 className="mt-3 text-[clamp(2rem,4vw,3.8rem)] leading-[0.98] font-semibold tracking-[-0.055em] text-balance text-white">
                {m['playground.image.gallery_title']()}
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-white/70 sm:text-base sm:leading-7">
                {m['playground.image.gallery_description']()}
              </p>
            </header>

            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((visible) => !visible)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-white/[0.09] px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-colors outline-none hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080c14]"
            >
              {showAll
                ? m['playground.image.gallery_show_less']()
                : m['playground.image.gallery_browse_all']()}
              <span aria-hidden className="text-base leading-none">
                {showAll ? '−' : '＋'}
              </span>
            </button>
          </div>
        </ImageStreamHero>

        <AnimatePresence initial={false}>
          {showAll && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="columns-2 gap-3 pt-5 sm:columns-3 sm:gap-4 lg:columns-4">
                {GALLERY_ITEMS.map((tile) => (
                  <figure
                    key={tile.src}
                    className="mb-3 break-inside-avoid overflow-hidden rounded-2xl bg-[#f5f5f7] p-1.5 sm:mb-4 sm:rounded-3xl sm:p-2 dark:bg-white/[0.06]"
                  >
                    <div
                      className="overflow-hidden rounded-[0.85rem] sm:rounded-[1.15rem]"
                      style={{ aspectRatio: tile.ratio }}
                    >
                      <img
                        src={tile.src}
                        alt={tile.alt}
                        width={tile.width}
                        height={tile.height}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-contain"
                      />
                    </div>
                  </figure>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  VideoGalleryBackground                                             */
/* ------------------------------------------------------------------ */

/**
 * Full-bleed masonry that fills the viewport for the video playground.
 * Packs as many tiles from `VIDEO_BACKGROUND_ITEMS` as fit inside the
 * viewport (height-capped packing via `packMasonry`'s `maxHeight` arg)
 * so the wall exactly covers the screen — no scroll, no overflow.
 *
 * Each video tile is two layers:
 *   1. <img poster> underneath — paints the first frame synchronously
 *      so the cell is never blank. Browsers throttle autoplay of many
 *      concurrent videos, so without this layer the wall would show
 *      empty/black cells until each <video> catches up.
 *   2. <video> on top — once it autoplays, the moving frames obscure
 *      the poster. `preload="metadata"` gives the browser the duration
 *      and dimensions without fetching the whole file. `muted +
 *      playsInline` are mandatory for autoplay on iOS Safari.
 *
 * `pointer-events: none` so the wall never blocks the chrome (header,
 * composer). `aria-hidden` so screen readers skip it.
 */
function VideoGalleryBackground() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Measure both the wall's width and the viewport height. Width drives
  // the column count + tile width; height caps how many tiles we pack.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const w = host.getBoundingClientRect().width;
      setWidth(w);
      setViewportHeight(window.innerHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const columnCount = columnsForWidth(window.innerWidth);
  const { tiles } = packMasonry(
    VIDEO_BACKGROUND_ITEMS,
    width,
    columnCount,
    GALLERY_GAP,
    viewportHeight
  );

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="relative size-full">
        {tiles.map((tile, i) => (
          <div
            key={`${tile.src}-${i}`}
            className="absolute overflow-hidden"
            style={{
              left: tile.left,
              top: tile.top,
              width: tile.width,
              height: tile.height,
            }}
          >
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
                alt=""
                loading="eager"
                decoding="async"
                onError={(e) => {
                  const wrapper = e.currentTarget.parentElement;
                  if (wrapper) wrapper.style.display = 'none';
                }}
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {/* Dark vignette — keeps the floating chrome readable over bright
          tiles. Stronger at top/bottom where the composer lives. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/30 to-black/70" />
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

// The server currently exposes one effective image model. Keep the richer
// picker implementation available for a future multi-provider rollout, but
// do not surface a selector that cannot change the generation request yet.
const SHOW_IMAGE_MODEL_PICKER = false;

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

// Aspect ratio palette — derived from the shared `ASPECT_RATIOS` module so
// client and server only ever submit upstream-supported ratio tokens.
const RATIO_MENU = ASPECT_RATIOS;

type ImageResolution = '1K' | '2K' | '4K';

type ImageModelChoice = 'gpt-image-2' | 'nano-banana-2-beta';

const IMAGE_MODEL_OPTIONS: Array<{
  value: ImageModelChoice;
  label: string;
}> = [
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'nano-banana-2-beta', label: 'Nano Banana 2' },
];

const IMAGE_RESOLUTION_OPTIONS: Array<{
  value: ImageResolution;
  cost: number;
}> = [
  { value: '1K', cost: 3 },
  { value: '2K', cost: 6 },
  { value: '4K', cost: 9 },
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

/** Compact model switcher — separate from, and immediately left of, size. */
function ImageModelSelect({
  value,
  onChange,
}: {
  value: ImageModelChoice;
  onChange: (model: ImageModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = IMAGE_MODEL_OPTIONS.find((option) => option.value === value)!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
        aria-label={m['playground.image.model_label']()}
      >
        <span>{active.label}</span>
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
        {IMAGE_MODEL_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'hover:bg-foreground/5 flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors',
                selected && 'bg-foreground/[0.06]'
              )}
            >
              {option.label}
              {selected ? (
                <Check className="text-foreground ml-auto size-3.5" />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Aspect ratio picker. The selected frame is retained with the task and is
 * passed to either automatic model route in its native ratio form.
 */
function AspectRatioMenu({
  value,
  onChange,
  resolution,
  onResolutionChange,
}: {
  value: string;
  onChange: (ratio: string) => void;
  resolution: ImageResolution;
  onResolutionChange: (resolution: ImageResolution) => void;
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
          {value} / {resolution}
        </span>
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(28rem,calc(100vw-2rem))] p-3"
      >
        <p className="text-foreground/45 px-1 pb-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
          {m['playground.image.aspect_label']()}
        </p>
        <div className="grid grid-cols-6 gap-1.5 max-[420px]:grid-cols-5">
          {RATIO_MENU.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => {
                onChange(r.value);
              }}
              aria-pressed={r.value === value}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 font-mono text-xs transition-colors',
                'hover:bg-foreground/5',
                r.value === value && 'bg-foreground/[0.08] text-foreground'
              )}
            >
              <RatioSwatch value={r.value} size={18} />
              <span className="whitespace-nowrap">{r.value}</span>
            </button>
          ))}
        </div>
        <div className="border-border/70 mt-3 border-t pt-3">
          <p className="text-foreground/45 px-1 pb-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
            {m['playground.image.resolution_label']()}
          </p>
          <div className="bg-foreground/[0.045] grid grid-cols-3 gap-1 rounded-xl p-1">
            {IMAGE_RESOLUTION_OPTIONS.map((option) => {
              const selected = resolution === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onResolutionChange(option.value)}
                  className={cn(
                    'text-muted-foreground rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors',
                    'hover:text-foreground',
                    selected && 'bg-background text-foreground shadow-sm'
                  )}
                >
                  {option.value}
                </button>
              );
            })}
          </div>
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
          'inline-flex items-center gap-2 px-1 py-2 text-black transition-opacity hover:opacity-70',
          open && 'opacity-70'
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

/* ------------------------------------------------------------------ */
/*  Chat model label                                                   */
/* ------------------------------------------------------------------ */

interface ChatModelMeta {
  test: RegExp;
  name: string;
}

const CHAT_MODEL_META: ChatModelMeta[] = [
  // ── Kimi (powers this chat) ────────────────────────────────────────────
  {
    test: /^kimi-k3/i,
    name: 'Kimi K3',
  },
];

function resolveChatModelMeta(id: string): ChatModelMeta {
  const lower = id.toLowerCase();
  return (
    CHAT_MODEL_META.find((m) => m.test.test(lower)) ?? {
      test: /^.*$/,
      name: id,
    }
  );
}

/**
 * The chat deployment currently has one wired model. Keep its label visible
 * beside the send button, but deliberately avoid exposing a non-functional
 * model picker until real model switching is available.
 */
function ChatModelPicker({ selectedId }: { selectedId: string }) {
  const selectedMeta = resolveChatModelMeta(selectedId);

  return (
    <span
      aria-label={m['playground.chat.model_label']()}
      className="inline-flex items-center px-1 py-2 text-sm font-medium tracking-tight text-black"
    >
      {selectedMeta.name}
    </span>
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
 * Image-generation history rendered as a chat transcript. Each task is a
 * right-aligned user prompt followed by its left-aligned generated image(s).
 * Conversations are chronological so fresh submissions appear at the bottom,
 * immediately above the composer, and earlier ones move upward naturally.
 */

function MyImageRows({
  rows,
  onSelect,
  onRegenerate,
  onEditPrompt,
  regenerateDisabled = false,
  highlightId,
  submitting,
}: {
  rows: ImageTaskRow[];
  onSelect: (id: string) => void;
  onRegenerate: (prompt: string) => void;
  onEditPrompt: (prompt: string) => void;
  regenerateDisabled?: boolean;
  highlightId?: string | null;
  /** Appears before the submit endpoint returns a real task id. */
  submitting?: { id: string; prompt: string } | null;
}) {
  // Processing tile stays visible AS LONG AS the row is still reported
  // as in-flight by the server. The previous 30s timeout used to drop
  // the spinner mid-generation, which made users think "did I click
  // submit?" — the side-panel / preview pane still tracks the task,
  // but the grid felt like it forgot the request. Now we keep the
  // placeholder until the row either resolves (URL arrives) or the
  // server reports a terminal failure status. Stale rows are still
  // protected by the polling logic in `ImagePlayground` (90s hard
  // ceiling, toast error if the request exceeds it).
  const visibleRows = rows.filter((r) => {
    const urls = r.imageUrls ?? (r.thumbnailUrl ? [r.thumbnailUrl] : []);
    // Any task that produced at least one image stays on the list.
    if (urls.length > 0) return true;
    // In-flight tasks — keep the spinner so the user sees the request
    // is still alive. No time cap: the row stays visible until the
    // server reports a terminal status (success / failed / canceled).
    if (r.status === 'processing' || r.status === 'pending') return true;
    // Terminal non-success status — the row still has no URLs to show,
    // so we keep the placeholder tile and let the in-progress UI
    // communicate "this didn't finish" (the actual reason text lives
    // in the per-batch footer below). The user explicitly asked for
    // the tile to NEVER disappear, so we keep it even when the task
    // failed or got cancelled.
    if (r.status === 'failed' || r.status === 'canceled') return true;
    return false;
  });

  if (visibleRows.length === 0 && !submitting) {
    // The section header above still names "Your generated images" and
    // the right-aligned "← Community" link is the way out, so the list
    // area is deliberately left blank — no sparkles placeholder, no
    // "your images will appear here" copy. The user knows where they
    // are from the chrome.
    return null;
  }

  // A chat transcript reads oldest-to-newest: every prompt is followed by
  // its result, and the newest conversation is appended just above the
  // composer. This is deliberately the opposite of the API's newest-first
  // response order.
  const chronologicalRows = [...visibleRows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex flex-col gap-10">
      {chronologicalRows.map((r) => {
        const urls = r.imageUrls ?? (r.thumbnailUrl ? [r.thumbnailUrl] : []);
        const isInFlight =
          (r.status === 'processing' || r.status === 'pending') &&
          urls.length === 0;
        const highlight = r.id === highlightId;

        return (
          <div key={r.id} className="flex w-full flex-col gap-5">
            <div className="flex justify-end">
              <ImagePromptBubble prompt={r.prompt} onEdit={onEditPrompt} />
            </div>
            <div className="flex w-full flex-col items-start gap-1">
              <div
                data-task-id={r.id}
                className={cn(
                  'flex w-full flex-wrap items-start gap-3',
                  highlight &&
                    'ring-foreground ring-offset-background rounded-xl ring-4 ring-offset-2'
                )}
              >
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
                      aspectRatio={r.options?.aspectRatio}
                      url={url}
                      fallbackUrl={r.imageFallbackUrls?.[i]}
                      prompt={r.prompt || 'Generated image'}
                      onSelect={() => onSelect(r.id)}
                      highlight={highlight && i === 0}
                      taskId={`${r.id}-${i}`}
                    />
                  ))
                )}
              </div>
              {urls.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onRegenerate(r.prompt ?? '')}
                  disabled={regenerateDisabled || !r.prompt?.trim()}
                  aria-label={m['playground.image.regenerate']()}
                  className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
                >
                  <RefreshCw className="size-3.5" />
                  <span>{m['playground.image.regenerate']()}</span>
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {submitting ? (
        <div className="flex w-full flex-col gap-5">
          <div className="flex justify-end">
            <ImagePromptBubble
              prompt={submitting.prompt}
              onEdit={onEditPrompt}
            />
          </div>
          <div className="flex w-full items-start">
            <ProcessingTile prompt={submitting.prompt} taskId={submitting.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImagePromptBubble({
  prompt,
  onEdit,
}: {
  prompt?: string | null;
  /** Places the prompt back into the composer so it can be revised. */
  onEdit: (prompt: string) => void;
}) {
  const copyablePrompt = prompt?.trim() ?? '';
  const displayedPrompt = copyablePrompt || '—';

  async function handleCopy() {
    if (!copyablePrompt || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(copyablePrompt);
      toast.success(m['playground.image.prompt_copied']());
    } catch {
      // Clipboard access can be denied in an embedded or non-secure context.
      // The prompt stays available in its message bubble either way.
    }
  }

  return (
    <TooltipProvider delay={200}>
      <div className="group/prompt relative flex max-w-[60%] flex-col items-end after:pointer-events-auto after:absolute after:top-full after:right-0 after:h-3 after:w-20 after:content-['']">
        <p className="w-fit max-w-full rounded-3xl rounded-br-md bg-[#f4f4f4] px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-black">
          {displayedPrompt}
        </p>
        {copyablePrompt ? (
          <div className="pointer-events-none absolute top-full right-0 z-10 mt-2 inline-flex -translate-y-1 items-center gap-1 p-0.5 text-black/55 opacity-0 transition-[opacity,transform] duration-150 group-hover/prompt:pointer-events-auto group-hover/prompt:translate-y-0 group-hover/prompt:opacity-100 focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={m['playground.image.copy_prompt']()}
                    className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/[0.06] hover:text-black focus-visible:bg-black/[0.06] focus-visible:text-black focus-visible:outline-none"
                  >
                    <Copy className="size-4" />
                  </button>
                }
              />
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-black/5 bg-white font-medium text-black shadow-lg"
              >
                {m['playground.image.copy_prompt']()}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onEdit(copyablePrompt)}
                    aria-label={m['playground.image.task_edit']()}
                    className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/[0.06] hover:text-black focus-visible:bg-black/[0.06] focus-visible:text-black focus-visible:outline-none"
                  >
                    <Pencil className="size-4" />
                  </button>
                }
              />
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-black/5 bg-white font-medium text-black shadow-lg"
              >
                {m['playground.image.task_edit']()}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
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
        // A broad frame reserves the same visual territory as the final
        // result. That keeps the generation progress in the exact spot
        // where the image will appear, instead of making it look like a
        // disconnected thumbnail.
        'bg-foreground/5 relative aspect-[16/9] w-56 shrink-0 overflow-hidden rounded-xl',
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
      {/* Centered spinner only — no prompt text. The prompt already
          lives in the per-batch footer below the row, so duplicating
          it on the tile adds noise without giving the user any new
          information. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Loader2 className="text-muted-foreground relative size-7 animate-spin" />
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
  aspectRatio,
  url,
  fallbackUrl,
  prompt,
  onSelect,
  highlight,
  taskId,
}: {
  aspectRatio?: string;
  url: string;
  fallbackUrl?: string | null;
  prompt: string;
  onSelect: () => void;
  highlight?: boolean;
  taskId: string;
}) {
  // New tasks retain the frame selected in the composer. Legacy tasks have
  // no saved selection, so they keep their intrinsic dimensions on load.
  const requestedRatio = parseAspectRatio(aspectRatio);
  const [ratio, setRatio] = useState(requestedRatio ?? 1);
  // Track whether the image is fully painted so the loading overlay
  // (spinner + progress bar) can stay visible all the way from submit
  // click through the in-flight spinner swap, through the polling
  // resolution, through the <img> byte download, and only then fade
  // out. Without this, the overlay would vanish the moment the URL
  // arrived, leaving a gap before the bytes actually painted.
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { activeSrc, useFallback } = useImageFallback(url, fallbackUrl);
  useEffect(() => {
    setRatio(requestedRatio ?? 1);
  }, [requestedRatio]);
  // If the image is already cached (browsers can resolve it
  // synchronously from the HTTP cache), `onLoad` may have already fired
  // before this effect ran — `imgRef.current.complete` is the only
  // reliable way to know. Without this, a cached image would show the
  // loading overlay forever.
  useEffect(() => {
    setIsLoaded(false);
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, [activeSrc]);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-task-id={taskId}
      style={{ aspectRatio: ratio }}
      className={cn(
        // Give every result an explicit reading width. A percentage width
        // inside this transcript's intrinsic flex row can collapse to the
        // image's min-content size, turning valid generations into slivers.
        // The fixed cap still keeps portrait results from taking over.
        'group bg-foreground/5 hover:ring-foreground/30 relative w-56 shrink-0 overflow-hidden rounded-xl hover:ring-2',
        // Pulse ring on the tile that just landed (sync submit or
        // polling resolution). Fades out via the parent state — the
        // class is removed when `highlight` flips back to false.
        highlight &&
          'ring-foreground ring-offset-background ring-4 ring-offset-2'
      )}
    >
      <img
        ref={imgRef}
        src={activeSrc}
        alt={prompt}
        // A fresh result is already in view after the submit scroll. Do not
        // make it wait behind the browser's lazy-image queue: requesting and
        // decoding it eagerly removes the last visible beat between the
        // gateway returning a URL and the image appearing in the reply.
        loading={highlight ? 'eager' : 'lazy'}
        decoding={highlight ? 'sync' : 'async'}
        fetchPriority={highlight ? 'high' : 'auto'}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (!requestedRatio && img.naturalWidth && img.naturalHeight) {
            setRatio(img.naturalWidth / img.naturalHeight);
          }
          setIsLoaded(true);
        }}
        onError={(e) => {
          if (useFallback()) {
            setIsLoaded(false);
            return;
          }
          e.currentTarget.style.display = 'none';
          // Treat errors as "loaded" too — otherwise the spinner would
          // sit on top of a hidden <img> forever and the user would
          // never know the tile failed.
          setIsLoaded(true);
        }}
        className={cn(
          'absolute inset-0 size-full rounded-lg object-cover transition-opacity duration-300',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
      />
      {/*
        Loading overlay — covers the tile until the underlying <img>
        paints its first frame. Pure spinner now (no prompt text) so
        the tile stays visually quiet at rest. The dark gradient + text
        hover overlay was removed per user request — the image stands
        on its own.
      */}
      {!isLoaded ? (
        <div
          className="bg-foreground/5 absolute inset-0 z-10 flex items-center justify-center rounded-lg"
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
          <div className="bg-foreground/10 absolute inset-x-0 bottom-0 h-1 overflow-hidden">
            <div data-progress-bar className="brand-gradient h-full" />
          </div>
        </div>
      ) : null}
    </button>
  );
}

/** Convert a persisted selection such as `"16:9"` into a CSS ratio. */
function parseAspectRatio(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const [width, height] = value.split(':').map(Number);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return width / height;
}

/**
 * Keep the authenticated same-origin proxy as the normal path, but fall back
 * to the matching public/provider URL when that proxy is unavailable. The
 * list endpoint already returns these paired URLs; keeping the decision in
 * the browser prevents one transient proxy failure from blanking the whole
 * image workspace.
 */
function useImageFallback(src: string, fallbackSrc?: string | null) {
  const [activeSrc, setActiveSrc] = useState(src);

  useEffect(() => {
    setActiveSrc(src);
  }, [src, fallbackSrc]);

  function useFallback() {
    if (!fallbackSrc || fallbackSrc === activeSrc) return false;
    setActiveSrc(fallbackSrc);
    return true;
  }

  return { activeSrc, useFallback };
}

/** A plain `<img>` with the same proxy → public URL failover as gallery tiles. */
function ImageWithFallback({
  src,
  fallbackSrc,
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  fallbackSrc?: string | null;
}) {
  const { activeSrc, useFallback } = useImageFallback(src, fallbackSrc);

  return (
    <img
      {...props}
      src={activeSrc}
      onError={(event) => {
        if (!useFallback()) onError?.(event);
      }}
    />
  );
}

export function ImagePlayground({
  initialTab = 'community',
  initialPrompt = '',
  myImagesPageHref,
  communityPageHref,
  autoPreviewFirst = false,
  autoSubmit = false,
  redirectOnSubmit = false,
  staticCommunity = false,
  eagerFirstCommunityImage = false,
}: {
  initialTab?: 'community' | 'mine';
  initialPrompt?: string;
  myImagesPageHref?: '/image-generator';
  communityPageHref?: '/photo-to-anime';
  autoPreviewFirst?: boolean;
  /** Submit the prompt as soon as this workspace finishes hydrating. */
  autoSubmit?: boolean;
  /** Send marketing-page submissions to the dedicated workspace first. */
  redirectOnSubmit?: boolean;
  /** Render the community waterfall in normal document flow, below the composer. */
  staticCommunity?: boolean;
  /** Use eager loading for only the first static community image. */
  eagerFirstCommunityImage?: boolean;
}) {
  const store = usePlaygroundStore();
  const { activeImageId } = store;
  const { data: session, isPending: isSessionPending } = useSession();

  const [tab, setTab] = useState<'community' | 'mine'>(initialTab);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const referenceDragDepthRef = useRef(0);
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
  // Lightbox — clicking a reference thumbnail opens the higher-res
  // `url` (not the local `previewUrl` blob) fullscreen so the user
  // can verify the uploaded file before sending it as part of the
  // request. `null` means closed.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const MAX_REFERENCES = 10;
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);
  // Covers the short handoff from the public page click to the moment the API
  // returns a durable task id. Seed it from the URL handoff so the destination
  // workspace paints the prompt bubble and its left-side preview on its very
  // first frame — never an empty transcript between the two pages.
  // This local reply is deliberately independent of the server task list.
  // It is created in the click handler, before React Query starts the POST,
  // which guarantees that the left-aligned processing frame paints on the
  // very next render even on a cold connection.
  const [submittingImage, setSubmittingImage] = useState<{
    id: string;
    prompt: string;
  } | null>(() =>
    autoSubmit && initialPrompt.trim()
      ? { id: 'submitting-image', prompt: initialPrompt.trim() }
      : null
  );
  const [authOpen, setAuthOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
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
  const didAutoPreviewRef = useRef(false);
  const didAutoSubmitRef = useRef<string | null>(null);
  // The image history reads as a conversation: its newest turn belongs above
  // the composer. Start there on entry, but only once per workspace mount so
  // a user scrolling through older work is never pulled back unexpectedly.
  const imageHistoryScrollRef = useRef<HTMLDivElement | null>(null);
  const imageHistoryContentRef = useRef<HTMLDivElement | null>(null);
  const didScrollImageHistoryRef = useRef(false);
  // Task id of the most recently landed image. Used to (a) scroll the
  // matching tile into view and (b) ring-highlight it for 2s so the
  // user knows which tile in the grid is their new one.
  const [recentlyLandedTaskId, setRecentlyLandedTaskId] = useState<
    string | null
  >(null);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [imageResolution, setImageResolution] = useState<ImageResolution>('1K');
  const [imageModel, setImageModel] = useState<ImageModelChoice>('gpt-image-2');
  // My Images tab — clicking a tile routes to the dedicated preview
  // page at /api-playground/image/$id rather than opening an overlay,
  // so the URL is shareable and back-navigation works.
  const navigate = useNavigate();

  // Keep the complete prompt visible while it is being written. A fixed
  // two-row textarea let wrapped lines run underneath the toolbar, which
  // made longer prompts look clipped before the user submitted them.
  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;

    const maxHeight = 192;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [prompt]);

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

  // The task list is newest-first at the API boundary but is rendered oldest
  // to newest as a transcript. Once it has mounted, put the viewport at its
  // visual end. The observer accounts for image decoding changing the height
  // after the initial paint; it is short-lived and then releases control to
  // the user.
  useEffect(() => {
    if (
      tab !== 'mine' ||
      !myImagesQuery.isFetched ||
      didScrollImageHistoryRef.current
    ) {
      return;
    }

    const scrollToLatest = () => {
      const container = imageHistoryScrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    const frame = window.requestAnimationFrame(scrollToLatest);
    const observer = new ResizeObserver(scrollToLatest);
    if (imageHistoryContentRef.current) {
      observer.observe(imageHistoryContentRef.current);
    }
    const settleTimer = window.setTimeout(() => observer.disconnect(), 1_000);
    didScrollImageHistoryRef.current = true;

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer.disconnect();
    };
  }, [myImagesQuery.isFetched, tab]);

  // The dedicated image workspace opens with the latest completed image in
  // focus, making its right-hand preview useful from the first paint. Once a
  // user closes the preview, respect that choice for the rest of the visit.
  useEffect(() => {
    if (didAutoPreviewRef.current || !autoPreviewFirst) return;
    const latest = (myImagesQuery.data?.tasks ?? []).find(
      (task) =>
        task.status === 'success' &&
        (task.imageUrls?.length || task.thumbnailUrl)
    );
    if (!latest) return;
    didAutoPreviewRef.current = true;
    setPreviewTaskId(latest.id);
  }, [autoPreviewFirst, myImagesQuery.data]);

  // The public composer hands its prompt to this workspace through the URL.
  // For an automatic handoff, move that text into the transcript immediately
  // and leave the destination composer clear for the user's next idea. A
  // direct workspace URL keeps the old, editable-composer behaviour.
  useEffect(() => {
    if (!initialPrompt) return;
    setPrompt(autoSubmit ? '' : initialPrompt);
    if (autoSubmit && initialPrompt.trim()) {
      setSubmittingImage({
        id: 'submitting-image',
        prompt: initialPrompt.trim(),
      });
    }
    setTab('mine');
  }, [autoSubmit, initialPrompt]);

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
  // Capped at 160 attempts. The fast phase covers normal image jobs with a
  // sub-second completion check; the 1.5s tail still leaves ample room for
  // a slow provider without making a finished image feel stuck.
  useEffect(() => {
    if (!pollingTaskId) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 160;

    const nextDelay = (n: number) => {
      // First 20 polls: 100ms. The next phase stays brisk enough that an
      // async task is normally surfaced within 250ms of completion; this is
      // the largest controllable part of image-generation latency after the
      // provider itself has finished rendering.
      if (n <= 20) return 100;
      if (n <= 44) return 250;
      if (n <= 80) return 750;
      return 1500;
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
    mutationFn: async ({ prompt: submittedPrompt }: { prompt: string }) => {
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
        model: imageModel,
        resolution: imageResolution,
        prompt: (() => {
          const main = submittedPrompt;
          if (!refsBlock) return main;
          if (!main) return refsBlock;
          return `${refsBlock}\n\n${main}`;
        })(),
      };
      if (references[0]?.url) body.referenceUrl = references[0].url;
      // Every image request produces a single result. Variations are made
      // through the per-result regenerate action, rather than a batch-size
      // control that obscures the price and can exceed the user's balance.
      body.n = 1;
      body.size = aspectRatio;
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
    // `submitImagePrompt` has already put the optimistic reply on screen.
    // Keep its id in the mutation context so a late success/error from an
    // older request can never clear a newer processing frame.
    onMutate: (submission) => {
      return submission;
    },
    onSuccess: (data, _variables, context) => {
      const submittedPrompt = context?.prompt || _variables.prompt;
      setSubmittingImage((current) =>
        current?.id === context?.id ? null : current
      );
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
        const isImmediate = data.status === 'success';
        const syntheticRow: any = {
          id: data.taskId,
          prompt: submittedPrompt,
          status: isImmediate ? 'success' : 'processing',
          model: data.task?.model ?? null,
          createdAt: data.task?.createdAt ?? new Date().toISOString(),
          // Sync returns taskResult.imageUrls populated. Async returns
          // [] so the row renders as a ProcessingTile in MyImageRows.
          imageUrls: isImmediate
            ? (data.task?.taskResult?.imageUrls ?? data.imageUrls ?? [])
            : [],
          thumbnailUrl: isImmediate
            ? (data.task?.taskResult?.imageUrls?.[0] ?? data.imageUrl ?? null)
            : null,
          options: {
            model: imageModel,
            resolution: imageResolution,
            aspectRatio,
          },
        };
        if (old?.tasks?.some((t: any) => t.id === data.taskId)) return old;
        return { tasks: [syntheticRow, ...(old?.tasks ?? [])] };
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
    onError: (e: Error, _variables, context) => {
      // Always clear the timer on error so the panel doesn't stay stuck
      // on "Generating... Ns" forever when the request fails.
      setGeneratingSince(null);
      setEstimatedTotal(null);
      setSubmittingImage((current) =>
        current?.id === context?.id ? null : current
      );
      const msg = e.message || '';
      const paymentRequired =
        msg === 'payment_required' ||
        /insufficient(?: paid)? credits|requires a paid (?:plan|credit)|payment required/i.test(
          msg
        );
      const isNoProvider = /not configured/i.test(msg);
      // Credit failures have a stable `payment_required` API marker. The
      // billing modal is the user-facing signal, so skip a competing toast
      // and send the user straight to checkout.
      if (paymentRequired) {
        setBillingOpen(true);
        return;
      }
      const key = isNoProvider ? 'playground.image.error_no_provider' : null;
      toast.error(key ? m[key]() : msg);
    },
  });

  function submitImagePrompt(submittedPrompt: string) {
    if (!submittedPrompt || submitMutation.isPending || pollingTaskId) return;
    // Image tasks require a session. Do this before a route change or API call
    // so the typed prompt remains visible underneath the login dialog.
    if (isSessionPending) return;
    if (!session?.user) {
      // A URL handoff can render its optimistic preview before we learn the
      // visitor is signed out. Remove it before opening the auth dialog so an
      // unsigned user is never left looking at a fake, permanent generation.
      if (autoSubmit) setSubmittingImage(null);
      setAuthOpen(true);
      return;
    }

    if (redirectOnSubmit) {
      navigate({
        to: '/image-generator',
        search: { prompt: submittedPrompt, autoSubmit: '1' },
      });
      return;
    }

    // Paint the pending assistant response *before* the mutation is queued.
    // The composer stays pinned at the bottom, so later prompts naturally
    // push completed replies upward while every new processing frame starts
    // at the left edge of its own conversation turn.
    const submission = {
      id: `submitting-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: submittedPrompt,
    };
    setTab('mine');
    setSubmittingImage(submission);
    submitMutation.mutate(submission);
  }

  function handleImageSubmit() {
    submitImagePrompt(prompt.trim());
  }

  function handleImageRegenerate(promptToRegenerate: string) {
    submitImagePrompt(promptToRegenerate.trim());
  }

  function handleEditImagePrompt(promptToEdit: string) {
    setPrompt(promptToEdit);
    // Returning the text to the composer is intentionally non-destructive:
    // the original generation stays in the transcript, while the user can
    // refine its wording and submit a new variation from the focused input.
    requestAnimationFrame(() => {
      const textarea = promptRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  // A prompt sent from the public gallery should start immediately after the
  // workspace opens. Wait for the session lookup before consuming the
  // one-shot flag: on a cold navigation it is briefly pending, and consuming
  // the flag then would leave the user on the workspace with no generation.
  // The ref still prevents duplicate API calls after the session resolves.
  useEffect(() => {
    const submittedPrompt = initialPrompt.trim();
    if (
      !autoSubmit ||
      !submittedPrompt ||
      isSessionPending ||
      didAutoSubmitRef.current === submittedPrompt
    ) {
      return;
    }
    didAutoSubmitRef.current = submittedPrompt;
    submitImagePrompt(submittedPrompt);
  }, [autoSubmit, initialPrompt, isSessionPending, session?.user]);

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

  /**
   * Takes the PNG blob exported by `AnnotationEditor` and adds it to
   * the composer's reference list. Same upload path as
   * `handleReferenceUpload` — wrapping the blob in a `File` and
   * routing it through `uploadMediaFiles` keeps the upload pipeline
   * (size cap, MIME check, storage rehost) in one place.
   *
   * The default `note` is left blank so the user can type their edit
   * instruction in the chip's inline note field; a pre-filled note
   * would lock them into "modify the marked area" and bury their
   * actual intent.
   */
  async function handleAddAnnotatedReference(blob: Blob, sourceTaskId: string) {
    if (!session?.user) {
      setAuthOpen(true);
      return;
    }
    if (references.length >= MAX_REFERENCES) {
      toast.error(
        m['playground.attachment.err_too_many_refs']({ max: MAX_REFERENCES })
      );
      return;
    }
    const filename = `annotated-${sourceTaskId.slice(0, 8)}-${Date.now()}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    setUploadingReference(true);
    try {
      const [uploaded] = await uploadMediaFiles([file]);
      setReferences((prev) => [
        ...prev,
        {
          url: uploaded?.url ?? '',
          previewUrl: URL.createObjectURL(file),
          filename,
          note: '',
        },
      ]);
      // Drop the user straight into the prompt field so they can
      // type the edit instruction without hunting for the composer.
      promptRef.current?.focus();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploadingReference(false);
    }
  }

  function handleReferencePaste(e: React.ClipboardEvent) {
    const images = imageFilesFromClipboard(e.clipboardData);
    if (!images.length) return;
    e.preventDefault();
    const dt = new DataTransfer();
    for (const f of images) dt.items.add(f);
    handleReferenceUpload(dt.files);
  }

  function isReferenceFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
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

  // The public → workspace handoff should land on the live preview rather
  // than leave it below a long image history. This runs for the optimistic
  // `submitting-image` tile before the task endpoint replies, so the click
  // flows directly into the exact place where the final image will appear.
  useEffect(() => {
    if (!submittingImage) return;
    const id = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-task-id="${submittingImage.id}"]`)
        ?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [submittingImage]);

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
        el.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
   */
  // Download is implemented inside `ImagePreviewPanel.handleDownload`
  // (top-level `window.location.href` so the browser honours the
  // `Content-Disposition: attachment` header and pops the Save As
  // dialog immediately). The old programmatic `<a download>` trick
  // was unreliable on cross-origin streaming responses in Chrome.

  return (
    <div
      className={cn(
        'w-full bg-white dark:bg-[#050505]',
        staticCommunity
          ? 'overflow-visible'
          : 'flex h-full min-h-0 flex-1 overflow-hidden'
      )}
    >
      {/* Center column — gallery / my-images grid + floating composer.
          Sits as the first sibling in the outer flex-row; the
          `ImagePreviewPanel` aside takes the second slot. flex-1 +
          min-w-0 lets the column shrink when the 620px panel opens
          without overflowing the viewport. */}
      <div
        className={cn(
          'relative flex min-w-0 flex-1 flex-col',
          staticCommunity ? 'overflow-visible' : 'min-h-0 overflow-hidden'
        )}
      >
        {/* Floating segmented tab bar — sits above the wall, centered.
          A white segmented control keeps the selector distinct from the
          image wall while the raised active tab signals the current view. */}
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <NoiseBackground
            containerClassName="pointer-events-auto h-10 w-fit rounded-full border border-black/[0.06] bg-white p-1.5 shadow-sm select-none dark:border-white/10 dark:bg-card"
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
                    onClick={() => {
                      if (t.id === 'community' && communityPageHref) {
                        navigate({ to: communityPageHref });
                        return;
                      }
                      if (t.id === 'mine' && myImagesPageHref) {
                        navigate({ to: myImagesPageHref });
                        return;
                      }
                      setTab(t.id);
                    }}
                    className={cn(
                      'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all outline-none',
                      active
                        ? 'text-foreground dark:bg-background bg-white shadow-[0_1px_3px_rgb(0_0_0_/_0.12)]'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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

        {/* The Community gallery is document content rather than a moving
          background: prompt first, then a static grid of every image. */}
        <div
          className={cn(
            'flex-1',
            staticCommunity ? 'overflow-visible' : 'overflow-hidden',
            tab === 'community' && 'order-2'
          )}
        >
          <div
            ref={imageHistoryScrollRef}
            className={cn(
              'no-scrollbar',
              staticCommunity
                ? 'h-auto overflow-visible'
                : 'h-full scroll-pb-72 overflow-y-auto overscroll-y-none'
            )}
          >
            {tab === 'community' ? (
              <div className="w-full py-8">
                <div
                  className={cn(
                    'w-full',
                    // The static generator page deliberately presents the
                    // community wall as a full-bleed visual surface. Keep
                    // the regular playground comfortably constrained, but
                    // let the editorial page's tiles meet both edges.
                    staticCommunity
                      ? 'max-w-none px-0'
                      : 'mx-auto max-w-7xl px-4'
                  )}
                >
                  <CommunityImageGrid
                    eagerFirstImage={eagerFirstCommunityImage}
                  />
                </div>
              </div>
            ) : (
              // My Images tab — packed masonry grid. Clicking a tile
              // surfaces the image in the right-side `ImagePreviewPanel`
              // instead of replacing the grid in place. The grid therefore
              // stays visible behind the panel so the user can hop between
              // their other generations without a back-and-forth dance.
              <div
                ref={imageHistoryContentRef}
                className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-4 pt-16 pb-10"
              >
                <section>
                  <MyImageRows
                    // The API is already newest-first. Keeping that order
                    // puts fresh, durable R2-backed images ahead of old
                    // provider URLs that may have expired.
                    rows={myImagesQuery.data?.tasks ?? []}
                    onSelect={(id) => {
                      // Inline preview — image paints immediately from
                      // the row's cached imageUrls[0] (no fetch). The
                      // grid is replaced by the preview view above; this
                      // 0-network-roundtrip path keeps the click snappy.
                      setPreviewTaskId(id);
                    }}
                    onRegenerate={handleImageRegenerate}
                    onEditPrompt={handleEditImagePrompt}
                    regenerateDisabled={
                      submitMutation.isPending || !!pollingTaskId
                    }
                    highlightId={recentlyLandedTaskId}
                    submitting={submittingImage}
                  />
                </section>
              </div>
            )}
          </div>
        </div>

        {/* The composer is a flex sibling rather than an overlay: image rows
          scroll only in the space above it, with a clear gap before input. */}
        <div
          className={cn(
            'pointer-events-none z-20 flex flex-col items-center justify-center px-4',
            tab === 'community'
              ? 'relative order-1 shrink-0 pt-16 pb-4'
              : 'relative order-3 shrink-0 bg-white/95 pt-4 pb-4 backdrop-blur-sm dark:bg-[#050505]/95'
          )}
        >
          <div
            onPaste={handleReferencePaste}
            onDragEnter={(event) => {
              if (!isReferenceFileDrag(event)) return;
              event.preventDefault();
              referenceDragDepthRef.current += 1;
              setIsReferenceDragging(true);
            }}
            onDragOver={(event) => {
              if (!isReferenceFileDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(event) => {
              if (!isReferenceFileDrag(event)) return;
              referenceDragDepthRef.current = Math.max(
                0,
                referenceDragDepthRef.current - 1
              );
              if (referenceDragDepthRef.current === 0) {
                setIsReferenceDragging(false);
              }
            }}
            onDrop={(event) => {
              if (!isReferenceFileDrag(event)) return;
              event.preventDefault();
              referenceDragDepthRef.current = 0;
              setIsReferenceDragging(false);
              handleReferenceUpload(event.dataTransfer.files);
            }}
            className={cn(
              'border-border pointer-events-auto relative w-full max-w-3xl rounded-[28px] border bg-white p-1.5 shadow-[0_14px_28px_-20px_rgba(15,23,42,0.42)] transition-[border-color,background-color,box-shadow] duration-200',
              isReferenceDragging &&
                'border-[#0071e3] bg-[#f5f9ff] shadow-[0_18px_38px_-20px_rgba(0,113,227,0.42)] ring-4 ring-[#0071e3]/12'
            )}
          >
            {isReferenceDragging && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[23px] border border-dashed border-[#0071e3]/45 bg-white/78 text-sm font-medium text-[#0071e3] backdrop-blur-[2px]"
              >
                <ImageIcon className="mr-2 size-4" />
                {m['playground.image.drop_images']()}
              </div>
            )}
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
                      {/* Clickable thumbnail — opens the full-res
                          reference image in the lightbox overlay below.
                          The X button (next sibling) sits on top with
                          `z-10` so it captures the click instead of
                          triggering this. */}
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(r.url)}
                        aria-label={r.filename}
                        className="absolute inset-0 size-full cursor-zoom-in"
                      >
                        <img
                          src={r.previewUrl}
                          alt={r.filename}
                          className="size-full object-cover"
                        />
                      </button>
                      {/* Always-visible 图N label — small dark chip in the
                        top-left so the user can refer to it elsewhere. */}
                      <span className="bg-foreground/80 text-background pointer-events-none absolute top-0.5 left-0.5 rounded px-1 text-[10px] leading-4 font-medium">
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
                        className="bg-foreground/70 text-background absolute top-0.5 right-0.5 z-10 inline-flex size-4 items-center justify-center rounded-full"
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
                  handleImageSubmit();
                }
              }}
              placeholder={m['playground.image.prompt_placeholder']()}
              rows={2}
              className="placeholder:text-muted-foreground block max-h-48 min-h-[4.5rem] w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed outline-none"
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
                  multiple
                  className="hidden"
                  disabled={references.length >= MAX_REFERENCES}
                  onChange={(e) => handleReferenceUpload(e.target.files)}
                />
                <Plus className="size-4" />
              </label>
              <ImageModelSelect value={imageModel} onChange={setImageModel} />
              <AspectRatioMenu
                value={aspectRatio}
                onChange={setAspectRatio}
                resolution={imageResolution}
                onResolutionChange={setImageResolution}
              />
              <button
                type="button"
                // Disable on submit OR while a previous task is still
                // polling. The previous code only checked isPending, which
                // let the user fire a second submit mid-poll — that meant
                // two credit deductions and two aiTask rows for one image.
                disabled={
                  !prompt.trim() || submitMutation.isPending || !!pollingTaskId
                }
                onClick={handleImageSubmit}
                className="bg-foreground text-background ml-auto inline-flex size-9 items-center justify-center rounded-full transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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

        <AuthPromptDialog
          open={authOpen}
          onClose={() => setAuthOpen(false)}
          callbackUrl="/image-generator"
        />
        <PlaygroundPaymentDialog
          open={billingOpen}
          onOpenChange={setBillingOpen}
        />
      </div>
      {/* Right-side preview panel — only mounted when there's an active
        preview. Leaving it out for the empty case lets the centre
        column (`max-w-3xl mx-auto`) re-centre against the full
        viewport width. Closing the panel (X) clears `previewTaskId`
        which unmounts this aside in the same tick; the dialog
        visibly slides back to the page centre. */}
      {previewTaskId ? (
        <ImagePreviewPanel
          taskId={previewTaskId}
          rows={myImagesQuery.data?.tasks ?? []}
          onSelect={setPreviewTaskId}
          onClose={() => setPreviewTaskId(null)}
          onAddToMessage={(blob, sourceTaskId) =>
            handleAddAnnotatedReference(blob, sourceTaskId)
          }
        />
      ) : null}
      {/* Reference lightbox — fullscreen overlay that opens when the
          user clicks a reference thumbnail in the composer. Shows the
          full-resolution URL (not the local blob preview) so the user
          can verify the uploaded file before it's sent as part of the
          request. Closes on backdrop click, the close button, or
          Escape — all routes funnel through `setLightboxUrl(null)` so
          the React unmount stays consistent. */}
      {lightboxUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={m['playground.image.lightbox_title']()}
          // Backdrop click closes the lightbox. The inner content
          // wrapper stops propagation so clicking the image itself
          // doesn't accidentally close it.
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setLightboxUrl(null);
            }
          }}
          tabIndex={-1}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
        >
          {/* Close button — positioned absolutely in the top-right so
              it doesn't take space from the centered image. Same z
              layer as the image, but a sibling so clicking it
              bubbles through and closes (intentional). */}
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
            className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ImagePreviewPanel — right-side preview surface                      */
/* ------------------------------------------------------------------ */

/**
 * The 620px preview column on the right edge of `ImagePlayground`.
 * Replaces the previous behaviour where clicking a thumbnail either
 * replaced the masonry grid in place (forcing the user to back-track to
 * keep browsing) or opened the raw image URL in a new browser tab via
 * `target="_blank"`.
 *
 * The panel only mounts when `taskId !== null` — its parent short-
 * circuits on the empty case so the 620px gutter collapses entirely and
 * the centre column (`max-w-3xl mx-auto` dialog + composer) centres
 * against the full viewport. Pressing the close (X) button clears the
 * parent state, the aside unmounts, and the dialog returns to the page
 * centre in one tick.
 *
 * Active state contents: toolbar (title / edit / download / close) +
 * full-bleed image + horizontal thumbnail strip across the bottom that
 * lets the user hop between their other generations without leaving
 * the panel.
 *
 * Data fetching is owned by the panel: `taskId` is the only input, and
 * react-query reuses the `['image-task', id]` cache key the parent
 * already populated — no second round-trip on first render.
 */
function ImagePreviewPanel({
  taskId,
  rows,
  onSelect,
  onClose,
  onAddToMessage,
}: {
  taskId: string | null;
  rows: ImageTaskRow[];
  onSelect: (id: string) => void;
  onClose: () => void;
  /**
   * Hands the user-annotated PNG (a freshly exported `Blob`) to the
   * parent for upload + composer attachment. Called by the annotation
   * editor's "Add to message" button — see `AnnotationEditor` below.
   */
  onAddToMessage: (blob: Blob, taskId: string) => void | Promise<void>;
}) {
  // No panel mounted when there's no active preview — `ImagePlayground`
  // skips the aside altogether in this case so the centre column gets
  // the full viewport width and the `max-w-3xl mx-auto` dialog centres
  // against the whole page (not against a 620px-stripped column).
  if (!taskId) return null;

  // Active state — fetch full task detail for prompt + higher-resolution
  // URLs. The same cache key is used elsewhere (the `['image-task', id]`
  // shape is shared with `ImagePreviewPage` at routes/api-playground/image/$id)
  // so this is free when the user just clicked a thumbnail.
  const detailQuery = useQuery({
    queryKey: ['image-task', taskId],
    queryFn: () => apiGet<{ task: any }>(`/api/ai-tasks/${taskId}`),
    enabled: !!taskId,
    staleTime: 30_000,
  });
  const detail = detailQuery.data?.task;
  const row = rows.find((r) => r.id === taskId);

  // Resolve the highest-quality URL we have. `detail.taskResult` carries
  // the resolved provider URLs from the polling endpoint; the row's
  // `thumbnailUrl` is the cached fallback when the request hasn't landed.
  const { previewUrls, previewFallbackUrls } = (() => {
    if (detail?.taskResult) {
      const r =
        typeof detail.taskResult === 'string'
          ? JSON.parse(detail.taskResult)
          : detail.taskResult;
      if (Array.isArray(r?.imageUrls) && r.imageUrls.length) {
        return {
          previewUrls: r.imageUrls,
          previewFallbackUrls: Array.isArray(r.imageFallbackUrls)
            ? r.imageFallbackUrls
            : [],
        };
      }
      if (typeof r?.imageUrl === 'string') {
        return {
          previewUrls: [r.imageUrl],
          previewFallbackUrls: Array.isArray(r.imageFallbackUrls)
            ? r.imageFallbackUrls
            : [],
        };
      }
    }
    if (row?.imageUrls?.length) {
      return {
        previewUrls: row.imageUrls,
        previewFallbackUrls: row.imageFallbackUrls ?? [],
      };
    }
    return { previewUrls: [], previewFallbackUrls: [] };
  })();
  const previewUrl = previewUrls[0] || row?.thumbnailUrl;
  const previewFallbackUrl = previewFallbackUrls[0];
  const previewAspectRatio = parseAspectRatio(row?.options?.aspectRatio);

  /**
   * Save-as download — proxy through `/api/ai-tasks/$id/image?download=1`
   * so the browser pops the native "Save As" dialog with a clean
   * filename (the proxy sets `Content-Disposition: attachment`).
   *
   * Why a top-level navigation instead of a synthetic `<a download>`?
   * Chrome / Edge silently ignore the `download` attribute on cross-
   * origin URLs (and even some same-origin blobs when the response is
   * a streaming passthrough), so the user gets a flash of "nothing
   * happened" instead of the OS file picker. Setting `window.location`
   * to the proxy URL forces the browser to actually parse the response
   * headers — `Content-Disposition: attachment` is the trigger for
   * the native save dialog, and a top-level navigation is the only
   * way Chrome reliably honours it.
   */
  function handleDownload() {
    const url = `/api/ai-tasks/${taskId}/image?download=1`;
    window.location.href = url;
  }

  // Header title. Single-image tasks render the generic "Image" label
  // (matches the alt-text on the underlying file); multi-image batches
  // get the "N images" count so the user knows the rest are sitting in
  // the task result, just not shown in this 1-up preview slot.
  const titleText =
    previewUrls.length > 1
      ? m['playground.image.preview_count']({ count: previewUrls.length })
      : m['playground.image.preview_default_label']();

  // Cap the strip to 12 most-recent tiles — beyond that the row gets
  // visually noisy and the count badge already gives a hint at full
  // history. `rows` arrives newest-first from the API, so no sort needed.
  const stripRows = rows.slice(0, 12);

  // Editor toggle — clicking the pencil opens the `AnnotationEditor`
  // modal over the entire preview panel. Reset on close so a fresh
  // open starts with an empty canvas.
  const [editing, setEditing] = useState(false);

  // Close the editor automatically when the underlying preview
  // changes (e.g. user picked a different thumbnail in the strip).
  // Without this the editor would still show the previous image after
  // a new selection lands.
  useEffect(() => {
    setEditing(false);
  }, [taskId]);

  return (
    <aside className="relative hidden w-[620px] shrink-0 flex-col overflow-hidden border-l bg-white md:flex dark:bg-[#050505]">
      {/* Toolbar — mirrors the reference: title left, icon cluster right.
          The "edit" pencil is a placeholder for future in-place editing;
          clicking it just acks the user for now instead of silently
          failing. External-link is intentionally absent (the previous
          `target="_blank"` behaviour was removed — see component header). */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <span className="truncate text-sm font-medium">{titleText}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Edit"
            title="Edit"
            // Opens the in-place annotation editor (rectangle / circle /
            // arrow / freehand / text + color picker + undo / clear).
            // Disabled while no image is loaded — the editor needs a
            // source bitmap to mark up.
            onClick={() => setEditing(true)}
            disabled={!previewUrl}
            className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            aria-label={m['playground.image.download']()}
            title={m['playground.image.download']()}
            onClick={handleDownload}
            disabled={!previewUrl}
            className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-8 items-center justify-center rounded-md transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Main image area — scrolls vertically when the picture is taller
            than the panel. Padding 24px keeps the image from kissing the
            rounded border. `max-h-none` lets a wide image overflow the
            viewport width rather than artificially resizing. */}
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div className="flex min-h-full items-center justify-center">
            {previewUrl && previewAspectRatio ? (
              <div
                className="w-full max-w-full overflow-hidden rounded-lg border shadow-sm"
                style={{ aspectRatio: previewAspectRatio }}
              >
                <ImageWithFallback
                  src={previewUrl}
                  fallbackSrc={previewFallbackUrl}
                  alt={
                    row?.prompt || m['playground.image.preview_default_label']()
                  }
                  className="size-full object-cover"
                  decoding="async"
                  loading="eager"
                />
              </div>
            ) : previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <ImageWithFallback
                src={previewUrl}
                fallbackSrc={previewFallbackUrl}
                alt={
                  row?.prompt || m['playground.image.preview_default_label']()
                }
                className="max-h-none max-w-full rounded-lg border object-contain shadow-sm"
                decoding="async"
                loading="eager"
              />
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                <span>{m['playground.image.generating']()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Thumbnail strip — horizontal scroll of all the user's images,
            active one outlined in the primary color. Clicking a tile
            routes through the same `onSelect` handler the masonry grid
            uses, so flipping between generations stays a single
            click deep even after many produces. */}
        {stripRows.length > 0 ? (
          <div className="shrink-0 overflow-x-auto border-t px-4 py-3">
            <div className="flex gap-2">
              {stripRows.map((r) => {
                const url = r.imageUrls?.[0] || r.thumbnailUrl;
                const fallbackUrl = r.imageFallbackUrls?.[0];
                if (!url) return null;
                const active = r.id === taskId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    title={r.prompt?.slice(0, 40) || undefined}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      'bg-muted hover:border-border size-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors',
                      active ? 'border-primary' : 'border-transparent'
                    )}
                  >
                    <ImageWithFallback
                      alt=""
                      src={url}
                      fallbackSrc={fallbackUrl}
                      className="size-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      {/* Annotation overlay — opens when the user clicks the pencil.
          The source image goes through the same-origin proxy
          (`/api/ai-tasks/$id/image`, no `download=1`) so the canvas
          stays untainted — without it, `drawImage` on a raw R2 URL
          silently fails (the browser blocks cross-origin pixels from
          being read by `toBlob`). `taskId` is guaranteed truthy here
          because this branch is gated on `previewTaskId`. */}
      {editing && taskId ? (
        <AnnotationEditor
          imageUrl={`/api/ai-tasks/${taskId}/image`}
          onCancel={() => setEditing(false)}
          onAddToMessage={async (blob) => {
            await onAddToMessage(blob, taskId);
            setEditing(false);
          }}
        />
      ) : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  AnnotationEditor — pencil-button modal                              */
/* ------------------------------------------------------------------ */

/**
 * Image annotation overlay opened from the preview panel's pencil
 * button. Lets the user mark areas to modify (rectangle / circle /
 * arrow / freehand / text) and ships the marked image back to the
 * composer as a fresh reference attachment via `onAddToMessage(blob)`.
 *
 * Drawing surface is an HTML5 `<canvas>` so the final mark-up is
 * exported losslessly via `canvas.toBlob` — no SVG → raster conversion,
 * no foreign-object HTML smuggling tricks. The canvas's internal size
 * is the image's natural size (export quality); CSS scales the element
 * down to fit the modal, and mouse coords are remapped through
 * `getBoundingClientRect` so on-screen clicks land at the right
 * pixel regardless of how the element has been scaled.
 *
 * The `imageUrl` is expected to be **same-origin** (the call site
 * passes `/api/ai-tasks/$id/image`, not the raw R2 URL). Without that,
 * the canvas would be tainted by the cross-origin `drawImage` and the
 * subsequent `toBlob` would throw a SecurityError on export.
 *
 * Tools: rectangle / circle / arrow / draw (freehand path) / text.
 * Colour picker is a fixed swatch strip — we don't need a full HSL
 * control for the "mark the region" use case. Undo pops the last
 * committed shape; Clear empties the list.
 */

type AnnotateTool = 'rectangle' | 'circle' | 'arrow' | 'draw' | 'text';

type AnnotateShape =
  | {
      id: string;
      type: 'rectangle';
      color: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'circle';
      color: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'arrow';
      color: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'draw';
      color: string;
      points: Array<[number, number]>;
    }
  | {
      id: string;
      type: 'text';
      color: string;
      x: number;
      y: number;
      text: string;
    };

const ANNOTATE_COLORS = [
  '#ef4444', // red (default — matches the red-mark screenshot)
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#ffffff', // white (high-contrast on dark images)
];

const ANNOTATE_STROKE_PX = 6; // visible at modal scale; rendered at the
// same px value on the export canvas so the
// mark width looks identical in the result

/**
 * Canvas-to-display scale for text rendering.
 *
 * The canvas backing store is the source image's natural pixel size
 * (e.g. 2048×2048), but the `<canvas>` is sized down by CSS to fit
 * the panel (e.g. ~900px wide). A fixed `fontPx = 20` on the
 * backing store therefore renders at only ~9px on screen — much
 * smaller than the editing textarea's 20px CSS.
 *
 * To make the saved text appear at the same 20px CSS as the
 * textarea, multiply by `canvas.width / display.width` so the
 * rendered glyphs always equal 20px on screen regardless of how
 * the user has the modal sized or how big the source image was.
 */
function getTextFontPx(canvas: HTMLCanvasElement | null): number {
  if (!canvas) return 20;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return 20;
  return (20 * canvas.width) / rect.width;
}

function drawAnnotateShape(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D,
  shape: AnnotateShape
): void {
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = ANNOTATE_STROKE_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.type === 'rectangle') {
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1);
    const h = Math.abs(shape.y2 - shape.y1);
    ctx.strokeRect(x, y, w, h);
    return;
  }

  if (shape.type === 'circle') {
    const cx = (shape.x1 + shape.x2) / 2;
    const cy = (shape.y1 + shape.y2) / 2;
    const rx = Math.abs(shape.x2 - shape.x1) / 2;
    const ry = Math.abs(shape.y2 - shape.y1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (shape.type === 'arrow') {
    const dx = shape.x2 - shape.x1;
    const dy = shape.y2 - shape.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    // Arrowhead size — scales with stroke so it stays proportional
    // when the canvas is shrunk for display.
    const headLen = Math.max(ANNOTATE_STROKE_PX * 3, 18);
    const headHalf = headLen * 0.45;
    // Stop the line short of the tip so the head sits cleanly on top.
    const tipX = shape.x2;
    const tipY = shape.y2;
    const baseX = tipX - ux * headLen;
    const baseY = tipY - uy * headLen;
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(baseX, baseY);
    ctx.stroke();
    // Head triangle
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + -uy * headHalf, baseY + ux * headHalf);
    ctx.lineTo(baseX - -uy * headHalf, baseY - ux * headHalf);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (shape.type === 'draw') {
    if (shape.points.length < 2) return;
    ctx.beginPath();
    const [first, ...rest] = shape.points;
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.stroke();
    return;
  }

  if (shape.type === 'text') {
    // Saved text scales to match the editing textarea's 20px CSS —
    // see `getTextFontPx` for the canvas-to-display ratio math. The
    // font is therefore always rendered at 20px on screen no matter
    // the source image's natural resolution.
    const fontPx = getTextFontPx(canvas);
    ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'top';
    // Multi-line support — the textarea lets the user Shift+Enter
    // for newlines, so a single fillText would silently drop them.
    // Each line advances by fontPx × lineHeight (matches the
    // textarea's `style.lineHeight: 1.25` so what the user types
    // matches what lands on the export).
    const lineHeight = 1.25;
    const lines = shape.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], shape.x, shape.y + i * fontPx * lineHeight);
    }
    return;
  }
}

/**
 * Measure the rendered bounding box of a `text` shape. Used by the
 * click-to-edit hit test to figure out whether the user clicked on
 * an existing label. Returns `width` and `height` in canvas pixels;
 * (0, 0) for empty strings.
 *
 * Must stay in sync with `drawAnnotateShape`'s text branch — if the
 * font here doesn't match the rendered font, the click hit-box
 * drifts away from the visible glyphs and the user clicks "near"
 * the label with no result.
 */
function measureTextShape(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D,
  text: string
): { w: number; h: number } {
  // Must match `drawAnnotateShape`'s text fontPx exactly so the
  // click-to-edit bbox lines up with the rendered glyphs.
  const fontPx = getTextFontPx(canvas);
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const lines = text.split('\n');
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxW) maxW = w;
  }
  return {
    w: maxW,
    h: lines.length * fontPx * 1.25,
  };
}

/**
 * Hit-test an existing `text` shape at the given canvas pixel coords.
 * Walks the shape stack top-down (newest shapes drawn last = on top)
 * so a click on overlapping labels picks the frontmost one.
 */
function findTextShapeAt(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shapes: AnnotateShape[]
): Extract<AnnotateShape, { type: 'text' }> | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type !== 'text') continue;
    const { w, h } = measureTextShape(canvas, ctx, s.text);
    if (x >= s.x && x <= s.x + w && y >= s.y && y <= s.y + h) {
      return s;
    }
  }
  return null;
}

function AnnotationEditor({
  imageUrl,
  onCancel,
  onAddToMessage,
}: {
  imageUrl: string;
  onCancel: () => void;
  onAddToMessage: (blob: Blob) => void | Promise<void>;
}) {
  // Image loading — done via fetch + Blob rather than a hidden `<img>`
  // because the `<img onLoad>` path proved unreliable here (zero-sized
  // elements can be deferred, and `<img>` errors don't surface cleanly
  // for same-origin proxies that may 401 if cookies aren't sent). The
  // fetch path explicitly sends cookies, surfaces HTTP errors as toasts,
  // and lands a fully-decoded HTMLImageElement ready for `drawImage`.
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<AnnotateTool>('draw');
  const [color, setColor] = useState<string>(ANNOTATE_COLORS[0]);
  const [shapes, setShapes] = useState<AnnotateShape[]>([]);
  // In-progress shape the user is currently dragging out — kept
  // outside `shapes` so we can preview without committing until
  // mouseup.
  const [draft, setDraft] = useState<AnnotateShape | null>(null);
  // For Backspace / selection: keep the last-completed shape id so the
  // user can delete the most recent mark without dragging it.
  const [lastId, setLastId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Inline text editor — when the Text tool is active and the user
  // clicks the canvas, we open a dashed-border textarea at the click
  // point instead of using `window.prompt`. `cx` / `cy` are canvas
  // pixel coords (where the text shape is anchored when committed);
  // `wx` / `wy` are wrapper pixel coords (where the textarea is
  // positioned absolutely on top of the canvas).
  const [editingText, setEditingText] = useState<{
    cx: number;
    cy: number;
    wx: number;
    wy: number;
    value: string;
  } | null>(null);
  // When `editingText` is open AND it represents a *re-edit* of an
  // existing text shape (not a brand-new one), this is that shape's
  // id. The shape is removed from `shapes` while the edit is in
  // flight (so the canvas doesn't double-paint it under the
  // textarea) and replaced — with updated text — on commit. Empty
  // re-edits delete the shape outright instead of leaving a blank
  // label behind.
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // Wrapper ref — the relative-positioned flex container that holds
  // the canvas. Used to convert mouse-event client coords into
  // wrapper-relative coords for positioning the textarea overlay.
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Fetch + decode the source image into an HTMLImageElement. Same-
  // origin proxy URL so the resulting bitmap doesn't taint the canvas;
  // the object URL is revoked on unmount so we don't leak memory if
  // the user opens/closes the editor repeatedly.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSourceImage(null);
    setImageError(null);
    (async () => {
      try {
        const res = await fetch(imageUrl, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) {
            URL.revokeObjectURL(objectUrl!);
            return;
          }
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          setSourceImage(img);
        };
        img.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          if (!cancelled) {
            setImageError('Failed to decode image');
            toast.error('Failed to load image');
          }
        };
        img.src = objectUrl;
      } catch (err) {
        if (!cancelled) {
          const msg = (err as Error).message || 'Failed to load image';
          setImageError(msg);
          toast.error(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl]);

  // Redraw on any change to the visible shape list. Keeps a single
  // effect so we never double-paint.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = sourceImage;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Skip the shape currently being re-edited — it's drawn on
    // top by the textarea overlay, painting it on the canvas too
    // would result in a 1-frame double-render right when the
    // edit starts (before the textarea mounts).
    for (const shape of shapes) {
      if (shape.id === editingShapeId) continue;
      drawAnnotateShape(canvas, ctx, shape);
    }
    if (draft) drawAnnotateShape(canvas, ctx, draft);
  }, [shapes, draft, sourceImage, editingShapeId]);

  // Convert a mouse event into canvas-space pixel coords. Without
  // this remap a click that "looks like" it hit (40, 50) on a canvas
  // scaled to 50% would draw at (80, 100) — the user's on-screen
  // cursor and the exported mark wouldn't line up.
  function eventToCanvas(e: React.MouseEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  function commitShape(shape: AnnotateShape) {
    setShapes((prev) => [...prev, shape]);
    setLastId(shape.id);
    setDraft(null);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!sourceImage) return;
    // If a text edit is in flight, commit it on any canvas click.
    // The user either meant to commit (a tap without drag — the
    // existing mouseup drops zero-size drafts, so nothing else
    // commits) or wanted to start a new shape (a drag — the draft
    // proceeds normally). Either way the text has to land first
    // or it would be silently overwritten.
    if (editingText) commitEditingText();
    const { x, y } = eventToCanvas(e);
    const id = crypto.randomUUID();
    if (tool === 'rectangle' || tool === 'circle' || tool === 'arrow') {
      setDraft({ id, type: tool, color, x1: x, y1: y, x2: x, y2: y });
      return;
    }
    if (tool === 'draw') {
      setDraft({ id, type: 'draw', color, points: [[x, y]] });
      return;
    }
    if (tool === 'text') {
      // Hit-test first — clicking an existing text label re-opens it
      // for editing instead of starting a fresh label on top. The
      // shape is removed from the stack during the edit (so we don't
      // double-paint it under the textarea) and updated in place on
      // commit.
      const canvas = canvasRef.current;
      const t = eventToWrapper(e);
      if (!canvas || !t) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const hit = findTextShapeAt(canvas, ctx, t.cx, t.cy, shapes);
      if (hit) {
        // Position the textarea at the existing label's anchor (not
        // the click point) so the box doesn't jump when reopened.
        const pos = canvasToWrapper(hit.x, hit.y);
        setEditingShapeId(hit.id);
        setShapes((prev) => prev.filter((s) => s.id !== hit.id));
        setEditingText({
          cx: hit.x,
          cy: hit.y,
          wx: pos.wx,
          wy: pos.wy,
          value: hit.text,
        });
        return;
      }
      // No hit — start a brand-new label at the click point.
      setEditingShapeId(null);
      setEditingText({
        cx: t.cx,
        cy: t.cy,
        wx: t.wx,
        wy: t.wy,
        value: '',
      });
      return;
    }
  }

  /**
   * Convert a mouse event into canvas-pixel coords (`cx` / `cy`) AND
   * wrapper-relative coords (`wx` / `wy`). The textarea overlay needs
   * the wrapper coords to position absolutely inside the centered
   * canvas container; the committed shape needs the canvas coords to
   * anchor to the right pixel.
   */
  function eventToWrapper(
    e: React.MouseEvent
  ): { cx: number; cy: number; wx: number; wy: number } | null {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return null;
    const wRect = wrapper.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - cRect.left) / cRect.width) * canvas.width;
    const cy = ((e.clientY - cRect.top) / cRect.height) * canvas.height;
    const wx = e.clientX - wRect.left;
    const wy = e.clientY - wRect.top;
    return { cx, cy, wx, wy };
  }

  /**
   * Inverse of `eventToWrapper` — convert canvas pixel coords back
   * into wrapper-relative display coords. Used when re-opening an
   * existing text label, so the textarea lands at the label's
   * original anchor rather than wherever the user clicked.
   */
  function canvasToWrapper(cx: number, cy: number): { wx: number; wy: number } {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return { wx: 0, wy: 0 };
    const wRect = wrapper.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect();
    const dx = (cx / canvas.width) * cRect.width;
    const dy = (cy / canvas.height) * cRect.height;
    return {
      wx: cRect.left - wRect.left + dx,
      wy: cRect.top - wRect.top + dy,
    };
  }

  /**
   * Commit the in-flight textarea content. Three branches:
   *  - re-edit with non-empty text → update the original shape in place
   *  - re-edit with empty text   → delete the original shape
   *  - new edit with non-empty text → insert a fresh shape
   *  - new edit with empty text   → drop (matches old prompt behaviour)
   */
  function commitEditingText() {
    const cur = editingText;
    if (!cur) return;
    const text = cur.value.trim();
    const editingId = editingShapeId;
    // Reset edit state first so the textarea unmounts before the
    // shape reappears underneath it (avoids a 1-frame flash where
    // both the textarea and the committed shape overlap).
    setEditingText(null);
    setEditingShapeId(null);
    if (!text) {
      if (editingId) {
        // Empty re-edit = delete. The shape was already removed
        // from `shapes` when the edit started, so there's nothing
        // to clean up — the deletion is implicit.
      }
      return;
    }
    if (editingId) {
      setShapes((prev) =>
        prev.map((s) => (s.id === editingId ? { ...s, text } : s))
      );
      return;
    }
    commitShape({
      id: crypto.randomUUID(),
      type: 'text',
      color,
      x: cur.cx,
      y: cur.cy,
      text,
    });
  }

  function cancelEditingText() {
    setEditingText(null);
  }

  // Auto-focus the textarea after it mounts so the user can start
  // typing immediately. Without this the textarea would render but
  // the user would have to click into it again — confusing, because
  // they JUST clicked to place it.
  useEffect(() => {
    if (editingText) {
      // rAF defers focus until after React commits the textarea to
      // the DOM (otherwise the ref is still null at this point).
      const id = requestAnimationFrame(() => {
        textAreaRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [editingText?.wx, editingText?.wy]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const { x, y } = eventToCanvas(e);
    if (
      draft.type === 'rectangle' ||
      draft.type === 'circle' ||
      draft.type === 'arrow'
    ) {
      setDraft({ ...draft, x2: x, y2: y });
      return;
    }
    if (draft.type === 'draw') {
      setDraft({ ...draft, points: [...draft.points, [x, y]] });
      return;
    }
  }

  function handleMouseUp() {
    if (!draft) return;
    // Drop degenerate shapes — a 0-pixel rectangle / circle / arrow
    // isn't useful and clutters the undo stack.
    if (
      draft.type === 'rectangle' ||
      draft.type === 'circle' ||
      draft.type === 'arrow'
    ) {
      if (
        Math.abs(draft.x2 - draft.x1) < 2 ||
        Math.abs(draft.y2 - draft.y1) < 2
      ) {
        setDraft(null);
        return;
      }
    }
    if (draft.type === 'draw' && draft.points.length < 2) {
      setDraft(null);
      return;
    }
    commitShape(draft);
  }

  // Backspace removes the most recent mark — matches the
  // "press Backspace to delete selected marks" copy in the footer.
  // We treat "most recent" as the last shape on the stack since full
  // selection on a freehand canvas is more code than this UX warrants.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Backspace') return;
      // Don't hijack Backspace when the user is typing in an input
      // (none exist today, but cheap insurance for the future).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setShapes((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice(0, -1);
        setLastId(next.length ? next[next.length - 1].id : null);
        return next;
      });
      // Also clear any in-flight drag — Backspace mid-drag should
      // abort the shape, not leave it dangling on mouseup.
      setDraft(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleUndo() {
    setShapes((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice(0, -1);
      setLastId(next.length ? next[next.length - 1].id : null);
      return next;
    });
  }

  function handleClear() {
    setShapes([]);
    setLastId(null);
    setDraft(null);
  }

  async function handleConfirm() {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    try {
      // toBlob is async and offloads the PNG encode to a worker —
      // sync toDataURL on a large canvas can stall the UI for several
      // hundred ms on lower-end machines.
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/png'
        );
      });
      await onAddToMessage(blob);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canUndo = shapes.length > 0;
  const canClear = shapes.length > 0 || draft !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={m['playground.image.annotate_title']()}
      className="bg-background absolute inset-0 z-50 flex flex-col"
    >
      {/* Toolbar — top. Mirrors the reference markup: tool cluster on
          the left, color swatch + undo + clear on the right. Each tool
          button is a plain `<button>` with an icon; the active tool
          uses the same `bg-secondary` highlight the reference uses for
          the "draw" tool. */}
      <div className="border-border flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-2">
        <ToolbarToolButton
          active={tool === 'rectangle'}
          label={m['playground.image.annotate_tool_rectangle']()}
          onClick={() => setTool('rectangle')}
        >
          <Square className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton
          active={tool === 'circle'}
          label={m['playground.image.annotate_tool_circle']()}
          onClick={() => setTool('circle')}
        >
          <Circle className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton
          active={tool === 'arrow'}
          label={m['playground.image.annotate_tool_arrow']()}
          onClick={() => setTool('arrow')}
        >
          <ArrowUpRight className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton
          active={tool === 'draw'}
          label={m['playground.image.annotate_tool_draw']()}
          onClick={() => setTool('draw')}
        >
          <Pencil className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton
          active={tool === 'text'}
          label={m['playground.image.annotate_tool_text']()}
          onClick={() => setTool('text')}
        >
          <Type className="size-4" />
        </ToolbarToolButton>

        {/* Color picker — Popover with a row of swatches. The visible
            swatch is the current color (matches the reference's
            "ring + offset" styling). */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={m['playground.image.annotate_tool_color']()}
              title={m['playground.image.annotate_tool_color']()}
              className="ring-background ring-offset-muted-foreground/20 hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 ml-1 inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:ring-3"
            >
              <span
                aria-hidden
                className="block size-4 rounded-full ring-2 ring-offset-1"
                style={{ backgroundColor: color }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="flex w-auto gap-1 p-2"
          >
            {ANNOTATE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  'size-6 rounded-full border-2 transition-all',
                  c === color
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:scale-110'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </PopoverContent>
        </Popover>

        <span className="flex-1" />

        <ToolbarToolButton
          active={false}
          label={m['playground.image.annotate_undo']()}
          onClick={handleUndo}
          disabled={!canUndo}
          // Use a wrapper span so we can disable while keeping the
          // same button shape as the tool cluster.
        >
          <Undo2 className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton
          active={false}
          label={m['playground.image.annotate_clear']()}
          onClick={handleClear}
          disabled={!canClear}
        >
          <Eraser className="size-4" />
        </ToolbarToolButton>
        <ToolbarToolButton active={false} label="Close" onClick={onCancel}>
          <X className="size-4" />
        </ToolbarToolButton>
      </div>

      {/* Canvas area — middle. The source image is fetched as a Blob
          (see useEffect above) and decoded into `sourceImage`; the
          canvas paints it at natural size plus every committed +
          draft shape. CSS constrains the displayed size to fit the
          modal viewport. While loading we show a spinner so the user
          knows the canvas isn't blank because the tool is broken. */}
      <div
        ref={wrapperRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
      >
        {sourceImage ? null : imageError ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <X className="size-4" />
            <span>{imageError}</span>
          </div>
        ) : (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>{m['playground.image.generating']()}</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          // Mouse coords are remapped to canvas pixels via the
          // bounding-rect ratio, so the displayed size is purely a
          // CSS concern.
          className={cn(
            'max-h-full max-w-full rounded-lg border shadow-sm',
            sourceImage ? 'bg-foreground/5' : 'hidden'
          )}
          style={{
            // Force a constrained display size that respects the
            // image's aspect ratio — `auto` here lets the browser
            // pick the largest size that fits the modal viewport.
            width: 'min(100%, 1100px)',
            height: 'auto',
            // Tool cursor — pointer for placement tools, crosshair
            // for shape tools, default for text.
            cursor:
              tool === 'text'
                ? 'text'
                : tool === 'rectangle' ||
                    tool === 'circle' ||
                    tool === 'arrow' ||
                    tool === 'draw'
                  ? 'crosshair'
                  : 'default',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {/* Inline text editor — dashed-border textarea overlaid on
            top of the canvas at the click point. Only mounted when
            the Text tool is active and the user has clicked the
            canvas (or has an in-flight edit). Commits on blur / Enter
            (without Shift), cancels on Escape. Auto-resizes vertically
            as the user types so multi-line labels stay readable. */}
        {editingText ? (
          <textarea
            ref={textAreaRef}
            value={editingText.value}
            // Track the latest value in state so the commit handler
            // (called from blur / keydown) reads the final text.
            onChange={(e) =>
              setEditingText({
                ...editingText,
                value: e.target.value,
              })
            }
            // Click outside or Enter commits. Shift+Enter still
            // inserts a newline (the standard textarea behaviour).
            onBlur={commitEditingText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEditingText();
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEditingText();
              }
            }}
            // Position absolutely at the click point. We offset by a
            // few pixels so the dashed border doesn't kiss the
            // cursor — feels cramped otherwise.
            style={{
              position: 'absolute',
              left: editingText.wx + 4,
              top: editingText.wy + 4,
              // Match the canvas-drawn text's font size so the user
              // sees roughly what they'll get on export. See
              // `drawAnnotateShape` for the canvas-side fontPx.
              fontSize: '20px',
              lineHeight: '1.25',
              // The user types in the SAME colour the selected circle
              // is showing — what they see is what lands on the
              // export. Inline style beats the Tailwind `text-*`
              // utility because the colour is dynamic (state-driven),
              // not a fixed token.
              color,
            }}
            // Dashed border, transparent background so the image
            // shows through, tight min-width so an empty textarea is
            // still obviously an active editor (not a 0×0 invisible
            // box). `border-current` picks up the same colour we set
            // on `style.color` so the dashed border matches the
            // text the user is typing.
            className="placeholder:text-muted-foreground/70 min-w-[8rem] resize-none rounded-md border-2 border-dashed border-current bg-transparent px-2 py-1 font-sans font-semibold outline-none"
            rows={1}
            placeholder={m['playground.image.annotate_tool_text']()}
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}
      </div>

      {/* Footer — mirrors the reference markup: hint on the left,
          Cancel + primary "Add to message" on the right. The confirm
          button stays disabled while the image is still loading or a
          confirm is in flight (the export is async). */}
      <div className="border-border flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-muted-foreground min-w-0 text-xs">
          {m['playground.image.annotate_hint']()}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-border bg-background hover:bg-muted inline-flex h-8 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors"
          >
            {m['playground.image.annotate_cancel']()}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!sourceImage || busy}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              m['playground.image.annotate_confirm']()
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolbarToolButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md border border-transparent transition-colors outline-none select-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
        'disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'hover:bg-muted hover:text-foreground',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
      )}
    >
      {children}
    </button>
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
      // Mirror the image playground — pop the billing modal instead of a
      // toast when credits run out, so the user can top up in one click.
      if (/insufficient/i.test(msg)) {
        setBillingOpen(true);
        return;
      }
      const key = /not configured/i.test(msg)
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

        {/* Community wall background — packed masonry of mixed images +
            looping AI videos, filling the viewport. Dark vignette on top
            keeps the floating composer legible. */}
        <VideoGalleryBackground />
        {!seedanceEnabled && (
          <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto px-4 py-6">
            <div className="border-foreground/15 bg-card/70 text-foreground/75 flex items-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-sm backdrop-blur-md">
              <Film className="size-4" />
              {m['playground.video.disabled_notice']()}
            </div>
          </div>
        )}

        {/* Floating white segmented tab bar — matches ImagePlayground. */}
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <NoiseBackground
            containerClassName="pointer-events-auto h-10 w-fit rounded-full border border-black/[0.06] bg-white p-1.5 shadow-sm select-none dark:border-white/10 dark:bg-card"
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
                        ? 'text-foreground dark:bg-background bg-white shadow-[0_1px_3px_rgb(0_0_0_/_0.12)]'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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

          {/* Active video result */}
          {activeVideoUrl && (
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
          )}
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
