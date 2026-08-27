import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { ImagePlus, X, ZoomIn } from 'lucide-react';

import type { ImageGeneratorReference } from './types';
import { cn } from './utils';

type ReferenceUploaderProps = {
  disabled?: boolean;
  maxReferences: number;
  onAddFiles: (files: File[]) => void;
  onChangeNote: (id: string, note: string) => void;
  onPreview: (reference: ImageGeneratorReference) => void;
  onRemove: (id: string) => void;
  references: ImageGeneratorReference[];
  strings: {
    addReference: string;
    dropImages: string;
    referenceNote: string;
    removeReference: string;
    uploadLimit: string;
  };
};

export function ReferenceUploader({
  disabled,
  maxReferences,
  onAddFiles,
  onChangeNote,
  onPreview,
  onRemove,
  references,
  strings,
}: ReferenceUploaderProps) {
  const inputId = useId();
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const add = (files: FileList | null) => {
    if (!files || disabled) return;
    onAddFiles(Array.from(files));
  };

  const isFileDrag = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div
      onDragEnter={(event) => {
        if (!isFileDrag(event) || disabled) return;
        event.preventDefault();
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event) || disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event) || disabled) return;
        event.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        add(event.dataTransfer.files);
      }}
      className={cn(
        'relative transition-[background-color,border-color,box-shadow] duration-200',
        isDragging &&
          'rounded-2xl bg-sky-50/90 ring-4 ring-sky-500/15 dark:bg-sky-400/10'
      )}
    >
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border border-dashed border-sky-500/60 bg-white/78 text-sm font-medium text-sky-700 backdrop-blur-sm dark:bg-[#111216]/80 dark:text-sky-200">
          <ImagePlus className="mr-2 size-4" />
          {strings.dropImages}
        </div>
      ) : null}

      {references.length ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5">
          {references.map((reference, index) => (
            <div key={reference.id} className="group/reference relative w-16">
              <div className="relative size-16 overflow-hidden rounded-xl border border-black/[0.07] bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]">
                <button
                  type="button"
                  onClick={() => onPreview(reference)}
                  aria-label={`Preview ${reference.name}`}
                  className="absolute inset-0 block size-full cursor-zoom-in"
                >
                  <img
                    src={reference.previewUrl}
                    alt={reference.name}
                    className="size-full object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover/reference:bg-black/30 group-hover/reference:opacity-100">
                    <ZoomIn className="size-4" />
                  </span>
                </button>
                <span className="pointer-events-none absolute top-1 left-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(reference.id)}
                  aria-label={strings.removeReference}
                  className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-black/65 text-white transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
                >
                  <X className="size-3" />
                </button>
              </div>
              <input
                value={reference.note ?? ''}
                onChange={(event) =>
                  onChangeNote(reference.id, event.target.value)
                }
                aria-label={`${reference.name} note`}
                placeholder={strings.referenceNote}
                className="mt-1.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[10px] text-neutral-700 transition-colors outline-none placeholder:text-neutral-400 hover:border-black/[0.07] focus:border-sky-400/60 dark:text-white/75 dark:placeholder:text-white/30 dark:hover:border-white/10"
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 pt-2.5">
        <label
          htmlFor={inputId}
          title={
            references.length >= maxReferences
              ? strings.uploadLimit
              : strings.addReference
          }
          className={cn(
            'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-black/[0.045] hover:text-neutral-950 dark:text-white/45 dark:hover:bg-white/[0.07] dark:hover:text-white',
            (disabled || references.length >= maxReferences) &&
              'pointer-events-none opacity-35'
          )}
        >
          <ImagePlus className="size-4" />
          <span className="sr-only">{strings.addReference}</span>
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          multiple
          disabled={disabled || references.length >= maxReferences}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            add(event.target.files);
            event.target.value = '';
          }}
          className="hidden"
        />
        {references.length ? (
          <p className="min-w-0 truncate text-[10px] font-medium tracking-[0.08em] text-neutral-400 uppercase dark:text-white/30">
            {references.length} / {maxReferences} references
          </p>
        ) : null}
      </div>
    </div>
  );
}
