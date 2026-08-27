import { useEffect, useMemo, useRef, useState } from 'react';
import { Images, Sparkles } from 'lucide-react';

import {
  DEFAULT_ASPECT_RATIOS,
  DEFAULT_IMAGE_GENERATOR_COPY,
  DEFAULT_IMAGE_GENERATOR_NAV,
} from './defaults';
import { ImageGallery } from './image-gallery';
import { PromptComposer } from './prompt-composer';
import { ResultViewer } from './result-viewer';
import type {
  GeneratedImage,
  ImageGenerationTask,
  ImageGeneratorReference,
  ImageGeneratorTab,
  ImageGeneratorWorkspaceProps,
} from './types';
import { cn, makeId } from './utils';
import { WorkspaceSidebar } from './workspace-sidebar';

export function ImageGeneratorWorkspace({
  brand = 'Image studio',
  className,
  communityImages = [],
  copy: copyOverrides,
  defaultAspectRatio = '',
  defaultImageCount = 1,
  defaultModel,
  initialPrompt = '',
  initialTab = 'community',
  isAuthenticated = true,
  maxReferences = 10,
  models = [],
  myImages = [],
  navItems = DEFAULT_IMAGE_GENERATOR_NAV,
  onDownload,
  onGenerate,
  onRequireAuth,
  onTaskSelect,
  showSidebar = true,
  supportedAspectRatios = DEFAULT_ASPECT_RATIOS,
}: ImageGeneratorWorkspaceProps) {
  const copy = { ...DEFAULT_IMAGE_GENERATOR_COPY, ...copyOverrides };
  const [tab, setTab] = useState<ImageGeneratorTab>(initialTab);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [references, setReferences] = useState<ImageGeneratorReference[]>([]);
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio);
  const [imageCount, setImageCount] = useState(
    Math.min(4, Math.max(1, defaultImageCount))
  );
  const [model, setModel] = useState(defaultModel ?? models[0]);
  const [busy, setBusy] = useState(false);
  const [localTasks, setLocalTasks] = useState<ImageGenerationTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<ImageGenerationTask | null>(
    null
  );
  const [previewReference, setPreviewReference] =
    useState<ImageGeneratorReference | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const referencesRef = useRef(references);

  const mergedMyImages = useMemo(() => {
    const byId = new Map<string, ImageGenerationTask>();
    localTasks.forEach((task) => byId.set(task.id, task));
    myImages.forEach((task) => byId.set(task.id, task));
    return [...byId.values()].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [localTasks, myImages]);

  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  useEffect(() => {
    return () => {
      referencesRef.current.forEach((reference) => {
        if (reference.file && reference.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(reference.previewUrl);
        }
      });
    };
  }, []);

  const addFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const remaining = Math.max(0, maxReferences - references.length);
    const accepted = imageFiles.slice(0, remaining).map((file) => ({
      id: makeId('reference'),
      file,
      name: file.name,
      note: '',
      previewUrl: URL.createObjectURL(file),
    }));
    if (accepted.length) setReferences((items) => [...items, ...accepted]);
    if (imageFiles.length > remaining)
      setMessage(copy.uploadLimit(maxReferences));
  };

  const removeReference = (id: string) => {
    setReferences((items) => {
      const found = items.find((item) => item.id === id);
      if (found?.file && found.previewUrl.startsWith('blob:'))
        URL.revokeObjectURL(found.previewUrl);
      return items.filter((item) => item.id !== id);
    });
  };

  const selectTask = (task: ImageGenerationTask) => {
    setSelectedTask(task);
    onTaskSelect?.(task);
  };

  const generate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && !references.length) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    if (!onGenerate) {
      setMessage(copy.noProvider);
      return;
    }

    setBusy(true);
    setMessage(null);
    const input = {
      prompt: trimmedPrompt,
      references,
      aspectRatio,
      imageCount,
      model,
    };
    const optimisticId = makeId('generation');
    const optimisticTask: ImageGenerationTask = {
      id: optimisticId,
      prompt: trimmedPrompt || 'Reference-led image',
      status: 'processing',
      createdAt: new Date(),
      model,
    };
    setLocalTasks((tasks) => [optimisticTask, ...tasks]);
    setTab('mine');

    try {
      const task = await onGenerate(input);
      if (task) {
        setLocalTasks((tasks) => [
          task,
          ...tasks.filter((entry) => entry.id !== optimisticId),
        ]);
        setSelectedTask(task.status === 'success' ? task : null);
      } else {
        setLocalTasks((tasks) =>
          tasks.map((entry) =>
            entry.id === optimisticId
              ? { ...entry, status: 'queued' as const }
              : entry
          )
        );
      }
      setPrompt('');
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : 'Unable to start image generation.';
      setLocalTasks((tasks) =>
        tasks.map((entry) =>
          entry.id === optimisticId
            ? { ...entry, status: 'failed' as const, error: detail }
            : entry
        )
      );
      setMessage(detail);
    } finally {
      setBusy(false);
    }
  };

  const download = (image: GeneratedImage, task: ImageGenerationTask) => {
    if (onDownload) {
      onDownload(image, task);
      return;
    }
    const link = document.createElement('a');
    link.href = image.src;
    link.download = `${task.id}-${image.id}.png`;
    link.rel = 'noopener';
    link.click();
  };

  const visibleImages = tab === 'community' ? communityImages : mergedMyImages;

  return (
    <div
      className={cn(
        'flex h-[min(100svh,900px)] min-h-[620px] w-full overflow-hidden rounded-[30px] border border-black/[0.08] bg-white font-sans text-neutral-950 shadow-[0_28px_80px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-[#090a0d] dark:text-white dark:shadow-[0_28px_80px_rgba(0,0,0,0.38)]',
        className
      )}
    >
      {showSidebar ? (
        <WorkspaceSidebar brand={brand} navItems={navItems} />
      ) : null}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
          <div className="pointer-events-auto inline-flex h-10 items-center gap-1 rounded-full border border-black/[0.07] bg-white/92 p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.1)] backdrop-blur-md dark:border-white/10 dark:bg-[#17181d]/92">
            <TabButton
              active={tab === 'community'}
              icon={<Sparkles className="size-3.5" />}
              onClick={() => setTab('community')}
            >
              {copy.community}
            </TabButton>
            <TabButton
              active={tab === 'mine'}
              icon={<Images className="size-3.5" />}
              onClick={() => setTab('mine')}
            >
              {copy.mine}
            </TabButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_-20%,rgba(14,165,233,0.1),transparent_36%)] px-3 pt-16 pb-5 sm:px-5">
          <ImageGallery
            activeTaskId={selectedTask?.id}
            emptyMessage={
              tab === 'community' ? copy.emptyCommunity : copy.emptyMine
            }
            images={visibleImages}
            onSelect={selectTask}
            variant={tab}
          />
        </div>

        <div className="shrink-0 border-t border-black/[0.06] bg-white/94 px-3 py-3 backdrop-blur-md sm:px-5 dark:border-white/10 dark:bg-[#090a0d]/94">
          <PromptComposer
            aspectRatio={aspectRatio}
            busy={busy}
            imageCount={imageCount}
            maxReferences={maxReferences}
            model={model}
            models={models}
            onAddFiles={addFiles}
            onAspectRatioChange={setAspectRatio}
            onChangeNote={(id, note) =>
              setReferences((items) =>
                items.map((item) => (item.id === id ? { ...item, note } : item))
              )
            }
            onGenerate={generate}
            onImageCountChange={setImageCount}
            onModelChange={setModel}
            onPreviewReference={setPreviewReference}
            onPromptChange={setPrompt}
            onRemoveReference={removeReference}
            prompt={prompt}
            ratios={supportedAspectRatios}
            references={references}
            strings={{
              addReference: copy.addReference,
              aspectRatio: copy.aspectRatio,
              dropImages: copy.dropImages,
              generate: isAuthenticated ? copy.generate : copy.signInToGenerate,
              generating: copy.generating,
              imageCount: copy.imageCount,
              model: copy.model,
              promptPlaceholder: copy.promptPlaceholder,
              referenceNote: copy.referenceNote,
              removeReference: copy.removeReference,
              uploadLimit: copy.uploadLimit(maxReferences),
            }}
          />
          {message ? (
            <p
              role="status"
              className="mx-auto mt-2 max-w-3xl px-2 text-xs text-rose-600 dark:text-rose-300"
            >
              {message}
            </p>
          ) : null}
        </div>
      </main>

      <ResultViewer
        onClose={() => setSelectedTask(null)}
        onDownload={download}
        task={selectedTask}
        title={copy.result}
      />

      {previewReference ? (
        <button
          type="button"
          onClick={() => setPreviewReference(null)}
          aria-label="Close reference preview"
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
        >
          <img
            src={previewReference.url ?? previewReference.previewUrl}
            alt={previewReference.name}
            className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </button>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all',
        active
          ? 'bg-neutral-950 text-white shadow-sm dark:bg-white dark:text-neutral-950'
          : 'text-neutral-500 hover:bg-black/[0.045] hover:text-neutral-950 dark:text-white/45 dark:hover:bg-white/[0.08] dark:hover:text-white'
      )}
    >
      {icon}
      {children}
    </button>
  );
}
