import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import type { GeneratedImage, ImageGenerationTask } from './types';

type ResultViewerProps = {
  onClose: () => void;
  onDownload?: (image: GeneratedImage, task: ImageGenerationTask) => void;
  task: ImageGenerationTask | null;
  title: string;
};

export function ResultViewer({
  onClose,
  onDownload,
  task,
  title,
}: ResultViewerProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const images = task?.images ?? [];
  const image = images[imageIndex];

  useEffect(() => {
    setImageIndex(0);
  }, [task?.id]);

  useEffect(() => {
    if (!task) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose, task]);

  return (
    <AnimatePresence>
      {task ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#07111f]/72 p-4 backdrop-blur-md"
        >
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="flex max-h-[calc(100svh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#111217] text-white shadow-2xl"
          >
            <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{title}</p>
                <p className="mt-0.5 truncate text-[10px] tracking-[0.11em] text-white/40 uppercase">
                  {task.model ?? task.status}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {image ? (
                  <button
                    type="button"
                    onClick={() => onDownload?.(image, task)}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Download image"
                  >
                    <Download className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close preview"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
              {image ? (
                <img
                  src={image.src}
                  alt={image.alt ?? task.prompt}
                  className="mx-auto max-h-[72svh] max-w-full rounded-xl object-contain shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
                />
              ) : (
                <div className="flex min-h-80 items-center justify-center text-sm text-white/55">
                  This generation has no image to preview yet.
                </div>
              )}
            </div>

            <footer className="border-t border-white/10 px-4 py-3 sm:px-5">
              <p className="line-clamp-2 text-sm leading-6 text-white/65">
                {task.prompt}
              </p>
              {images.length > 1 ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
                  {images.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setImageIndex(index)}
                      className={`size-12 shrink-0 overflow-hidden rounded-lg border-2 ${
                        index === imageIndex
                          ? 'border-sky-300'
                          : 'border-transparent opacity-60'
                      }`}
                      aria-label={`Show output ${index + 1}`}
                    >
                      <img
                        src={entry.src}
                        alt=""
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
