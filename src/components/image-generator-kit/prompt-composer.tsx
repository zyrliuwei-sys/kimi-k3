import { useEffect, useRef } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';

import { GenerationControls } from './generation-controls';
import { ReferenceUploader } from './reference-uploader';
import type { ImageGeneratorReference } from './types';

type PromptComposerProps = {
  aspectRatio: string;
  busy: boolean;
  imageCount: number;
  maxReferences: number;
  model?: string;
  models: string[];
  onAddFiles: (files: File[]) => void;
  onAspectRatioChange: (value: string) => void;
  onChangeNote: (id: string, note: string) => void;
  onGenerate: () => void;
  onImageCountChange: (value: number) => void;
  onModelChange: (value: string) => void;
  onPreviewReference: (reference: ImageGeneratorReference) => void;
  onPromptChange: (value: string) => void;
  onRemoveReference: (id: string) => void;
  prompt: string;
  ratios: readonly string[];
  references: ImageGeneratorReference[];
  strings: {
    addReference: string;
    aspectRatio: string;
    dropImages: string;
    generate: string;
    generating: string;
    imageCount: string;
    model: string;
    promptPlaceholder: string;
    referenceNote: string;
    removeReference: string;
    uploadLimit: string;
  };
};

export function PromptComposer({
  aspectRatio,
  busy,
  imageCount,
  maxReferences,
  model,
  models,
  onAddFiles,
  onAspectRatioChange,
  onChangeNote,
  onGenerate,
  onImageCountChange,
  onModelChange,
  onPreviewReference,
  onPromptChange,
  onRemoveReference,
  prompt,
  ratios,
  references,
  strings,
}: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 184)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 184 ? 'auto' : 'hidden';
  }, [prompt]);

  const submit = () => {
    if (!busy && (prompt.trim() || references.length)) onGenerate();
  };

  return (
    <div className="w-full rounded-[28px] border border-black/[0.09] bg-white p-1.5 shadow-[0_20px_48px_-30px_rgba(15,23,42,0.45)] transition-shadow focus-within:shadow-[0_24px_56px_-30px_rgba(2,132,199,0.38)] dark:border-white/10 dark:bg-[#18191d] dark:shadow-[0_20px_48px_-30px_rgba(0,0,0,0.8)]">
      <ReferenceUploader
        disabled={busy}
        maxReferences={maxReferences}
        onAddFiles={onAddFiles}
        onChangeNote={onChangeNote}
        onPreview={onPreviewReference}
        onRemove={onRemoveReference}
        references={references}
        strings={{
          addReference: strings.addReference,
          dropImages: strings.dropImages,
          referenceNote: strings.referenceNote,
          removeReference: strings.removeReference,
          uploadLimit: strings.uploadLimit,
        }}
      />
      <textarea
        ref={textareaRef}
        value={prompt}
        rows={2}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={strings.promptPlaceholder}
        className="block max-h-[184px] min-h-[72px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 text-neutral-950 outline-none placeholder:text-neutral-400 dark:text-white dark:placeholder:text-white/30"
      />
      <div className="flex items-center gap-1 px-1 pb-1">
        <GenerationControls
          aspectRatio={aspectRatio}
          imageCount={imageCount}
          model={model}
          models={models}
          onAspectRatioChange={onAspectRatioChange}
          onImageCountChange={onImageCountChange}
          onModelChange={onModelChange}
          ratios={ratios}
          strings={{
            aspectRatio: strings.aspectRatio,
            imageCount: strings.imageCount,
            model: strings.model,
          }}
        />
        <button
          type="button"
          disabled={busy || (!prompt.trim() && !references.length)}
          onClick={submit}
          aria-label={busy ? strings.generating : strings.generate}
          className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white transition-all hover:scale-105 hover:bg-sky-600 disabled:pointer-events-none disabled:opacity-35 dark:bg-white dark:text-neutral-950 dark:hover:bg-sky-200"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
