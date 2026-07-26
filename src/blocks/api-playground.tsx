import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Film,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import { signIn, useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { streamChat } from '@/lib/chat-stream';
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
      {/* Single feature pill — sits at the top of the welcome state so it
          doesn't fight the greeting for attention. */}
      <div className="mb-6 inline-flex">
        <button
          type="button"
          className="border-foreground/15 bg-background hover:bg-foreground/5 inline-flex items-center rounded-full border px-5 py-1.5 text-sm font-medium transition-colors"
        >
          <span aria-hidden className="mr-1.5">
            📄
          </span>
          Document Analysis
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
