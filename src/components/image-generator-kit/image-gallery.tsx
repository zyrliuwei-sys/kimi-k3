import { ImageIcon, LoaderCircle, OctagonAlert, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

import type { ImageGenerationTask } from './types';
import { cn, formatRelativeTime } from './utils';

type ImageGalleryProps = {
  activeTaskId?: string;
  emptyMessage: string;
  images: ImageGenerationTask[];
  onSelect: (task: ImageGenerationTask) => void;
  variant: 'community' | 'mine';
};

export function ImageGallery({
  activeTaskId,
  emptyMessage,
  images,
  onSelect,
  variant,
}: ImageGalleryProps) {
  if (!images.length) {
    return (
      <div className="flex min-h-72 items-center justify-center px-6 text-center">
        <div className="max-w-xs">
          <span className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-black/[0.07] bg-white text-sky-600 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-sky-300">
            <ImageIcon className="size-5" />
          </span>
          <p className="mt-4 text-sm leading-6 text-neutral-500 dark:text-white/45">
            {emptyMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid auto-rows-[150px] grid-cols-2 gap-2.5 sm:auto-rows-[190px] sm:grid-cols-3 lg:grid-cols-4 lg:gap-3">
      {images.map((task, index) => (
        <GalleryTile
          key={task.id}
          active={task.id === activeTaskId}
          index={index}
          onClick={() => onSelect(task)}
          task={task}
          variant={variant}
        />
      ))}
    </div>
  );
}

function GalleryTile({
  active,
  index,
  onClick,
  task,
  variant,
}: {
  active: boolean;
  index: number;
  onClick: () => void;
  task: ImageGenerationTask;
  variant: 'community' | 'mine';
}) {
  const hero = task.images?.[0];
  const tall = index % 7 === 1 || index % 11 === 6;
  const wide = index % 9 === 4;
  const isProcessing = task.status === 'queued' || task.status === 'processing';

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: Math.min(index * 0.035, 0.22) }}
      onClick={onClick}
      className={cn(
        'group relative isolate overflow-hidden rounded-[20px] border text-left shadow-[0_1px_1px_rgba(0,0,0,0.04),0_14px_32px_rgba(31,41,55,0.1)] transition-[transform,border-color,box-shadow] duration-300 outline-none hover:z-10 hover:-translate-y-1 hover:shadow-[0_22px_42px_rgba(15,23,42,0.18)] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-3 dark:border-white/10 dark:shadow-[0_14px_32px_rgba(0,0,0,0.35)]',
        tall && 'row-span-2',
        wide && 'col-span-2',
        active
          ? 'border-sky-500 ring-2 ring-sky-400/30 dark:border-sky-300'
          : 'border-white/60 dark:border-white/10',
        !hero && 'bg-[#eef3f9] dark:bg-[#16171c]'
      )}
    >
      {hero ? (
        <img
          src={hero.src}
          alt={hero.alt ?? task.prompt}
          loading={index < 4 ? 'eager' : 'lazy'}
          className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-[1.055]"
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.02)_42%,rgba(2,6,23,0.76)_100%)]" />

      {isProcessing ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-sky-950/[0.12] text-center text-white backdrop-blur-[2px]">
          <span className="flex size-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-md">
            <LoaderCircle className="size-5 animate-spin" />
          </span>
          <span className="mt-2.5 text-[10px] font-semibold tracking-[0.15em] uppercase">
            Generating
          </span>
        </div>
      ) : task.status === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-950/65 px-5 text-center text-white">
          <OctagonAlert className="size-5" />
          <span className="mt-2 text-xs font-medium">
            {task.error ?? 'Generation failed'}
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-10 p-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="line-clamp-2 text-xs leading-5 font-medium text-white/90">
            {task.prompt}
          </p>
          {variant === 'community' ? (
            <Sparkles className="size-3.5 shrink-0 text-sky-100" />
          ) : null}
        </div>
        <p className="mt-1.5 text-[10px] font-semibold tracking-[0.12em] text-white/55 uppercase">
          {task.model ?? formatRelativeTime(task.createdAt)}
        </p>
      </div>
    </motion.button>
  );
}
