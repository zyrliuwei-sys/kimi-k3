import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, Upload, X } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { ApiError, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

/**
 * First-screen upload area — the hero's primary CTA.
 *
 * The dropzone + preview are REAL (native drag/drop + FileReader, no external
 * package). There is NO generation backend yet, so we stay honest: on upload
 * we open a popup that (a) shows the preview, (b) collects the visitor's email
 * into the `waitlist` table (lead capture), and (c) offers a real Pro upsell
 * (priority / more quota — NOT a fake "remove watermark" for a video that
 * doesn't exist). When a real image→video pipeline ships, the actual
 * generate + watermarked-download flow goes here.
 */
const MAX_BYTES = 10 * 1024 * 1024;

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function UploadStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const clearPreview = useCallback(() => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const acceptFile = useCallback(
    (file: File | undefined) => {
      setError('');
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('Please drop an image (PNG / JPG)');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('Image is larger than 10MB');
        return;
      }
      clearPreview();
      setPreview(URL.createObjectURL(file));
      setFileName(file.name);
      setEmail('');
      setStatus('idle');
      setModalOpen(true); // open the conversion popup on upload
    },
    [clearPreview]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files?.[0]);
    e.target.value = '';
  }

  function reset() {
    clearPreview();
    setFileName('');
    setStatus('idle');
    setError('');
    setModalOpen(false);
  }

  async function submit() {
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError(m['landing.upload.invalid_email']());
      return;
    }
    setStatus('submitting');
    setError('');
    try {
      await apiPost('/api/lead/waitlist', { email: em });
      setStatus('success');
    } catch (e: unknown) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : 'Request failed');
    }
  }

  return (
    <div className="border-foreground/10 bg-card rounded-[1.75rem] border p-4 shadow-[0_40px_90px_-40px_rgba(13,11,8,0.45)] sm:p-6">
      {/* social proof — honest, no fabricated numbers */}
      <p className="text-foreground/55 mb-4 text-center text-xs font-medium sm:text-[13px]">
        {m['landing.upload.proof']()}
      </p>

      {/* dropzone / preview */}
      {!preview ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex aspect-[16/10] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
            dragging
              ? 'border-[#7c3aed] bg-[#7c3aed]/5'
              : 'border-foreground/20 bg-muted/30 hover:border-foreground/35'
          )}
        >
          <span className="brand-gradient grid size-14 place-items-center rounded-2xl shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)]">
            <Upload className="size-6 text-white" />
          </span>
          <p className="text-foreground/90 max-w-md text-lg leading-snug font-semibold sm:text-xl">
            {m['landing.upload.title']()}
          </p>
          <p className="text-foreground/55 text-sm">
            {m['landing.upload.drop']()}
          </p>
          <p className="text-foreground/40 text-xs">
            {m['landing.upload.hint']()}
          </p>
        </div>
      ) : (
        <div className="bg-muted/30 border-foreground/10 relative overflow-hidden rounded-2xl border">
          <img
            src={preview}
            alt={fileName}
            className="aspect-[16/10] w-full object-cover"
          />
          <div className="bg-background/85 absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2.5 backdrop-blur">
            {status === 'success' ? (
              <span className="inline-flex items-center gap-1.5 px-1 text-[13px] font-medium">
                <CheckCircle2 className="size-4 text-emerald-500" />
                {m['landing.upload.success_title']()}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="brand-gradient inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white"
              >
                {m['landing.upload.modal_button']()}
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="text-foreground/70 hover:text-foreground inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1.5 text-xs font-medium dark:bg-white/10"
            >
              <X className="size-3.5" />
              {m['landing.upload.reset']()}
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onInput}
        className="hidden"
      />

      {/* honest disclaimer — no fake generation claim */}
      <p className="text-foreground/45 mt-3 text-center text-xs">
        {m['landing.upload.disclaimer']()}
      </p>
      {error && !preview && (
        <p className="mt-2 text-center text-sm text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}

      {/* conversion popup (email → waitlist + real Pro upsell) */}
      {modalOpen && preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={reset}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-card border-foreground/10 relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={reset}
              className="text-foreground/50 hover:text-foreground absolute top-3 right-3 grid size-8 place-items-center rounded-full"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            {status === 'success' ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span className="brand-gradient grid size-12 place-items-center rounded-2xl">
                  <CheckCircle2 className="size-6 text-white" />
                </span>
                <h3 className="text-lg font-semibold">
                  {m['landing.upload.success_title']()}
                </h3>
                <p className="text-foreground/65 text-sm leading-relaxed">
                  {m['landing.upload.success_desc']()}
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="text-foreground/60 hover:text-foreground mt-1 text-sm underline underline-offset-4"
                >
                  {m['landing.upload.reset']()}
                </button>
              </div>
            ) : (
              <>
                <div className="bg-muted/40 border-foreground/10 mb-4 overflow-hidden rounded-xl border">
                  <img
                    src={preview}
                    alt={fileName}
                    className="h-36 w-full object-cover"
                  />
                </div>
                <h3 className="text-lg font-semibold">
                  {m['landing.upload.modal_title']()}
                </h3>
                <p className="text-foreground/65 mt-1.5 text-sm leading-relaxed">
                  {m['landing.upload.modal_body']()}
                </p>

                <div className="mt-4 flex flex-col gap-2.5">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit();
                    }}
                    placeholder={m['landing.upload.email_placeholder']()}
                    className="border-foreground/15 bg-background h-11 rounded-xl border px-4 text-[15px] outline-none focus:border-[#7c3aed]"
                  />
                  <button
                    type="button"
                    onClick={submit}
                    disabled={status === 'submitting'}
                    className="brand-gradient inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white shadow-[0_18px_44px_-18px_rgba(124,58,237,0.75)] transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === 'submitting' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {m['landing.upload.modal_button']()}
                  </button>
                  <Link
                    href="/pricing"
                    onClick={reset}
                    className="text-foreground/60 hover:text-foreground mt-1 text-center text-[13px] underline underline-offset-4"
                  >
                    {m['landing.upload.modal_upsell']()}
                  </Link>
                </div>

                {error && (
                  <p className="mt-2.5 text-center text-sm text-amber-600 dark:text-amber-400">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
