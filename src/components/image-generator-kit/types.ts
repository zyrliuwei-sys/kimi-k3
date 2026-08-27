import type { ReactNode } from 'react';

export type ImageGeneratorTab = 'community' | 'mine';

export type ImageGenerationStatus =
  | 'queued'
  | 'processing'
  | 'success'
  | 'failed';

export type ImageGeneratorReference = {
  /** Stable ID used for removal and per-reference notes. */
  id: string;
  /** Local File when the reference originated from this browser. */
  file?: File;
  name: string;
  note?: string;
  previewUrl: string;
  url?: string;
};

export type GeneratedImage = {
  id: string;
  src: string;
  alt?: string;
};

export type ImageGenerationTask = {
  id: string;
  prompt: string;
  status: ImageGenerationStatus;
  createdAt?: string | Date;
  error?: string;
  estimatedSeconds?: number;
  images?: GeneratedImage[];
  model?: string;
};

export type ImageGenerationInput = {
  prompt: string;
  references: ImageGeneratorReference[];
  aspectRatio: string;
  imageCount: number;
  model?: string;
};

export type ImageGeneratorNavItem = {
  icon?: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
};

export type ImageGeneratorCopy = {
  addReference: string;
  aspectRatio: string;
  community: string;
  create: string;
  dropImages: string;
  emptyCommunity: string;
  emptyMine: string;
  generate: string;
  generating: string;
  imageCount: string;
  mine: string;
  model: string;
  noProvider: string;
  promptPlaceholder: string;
  referenceNote: string;
  removeReference: string;
  result: string;
  signInToGenerate: string;
  uploadLimit: (max: number) => string;
};

export type ImageGeneratorWorkspaceProps = {
  /** Your product name, rendered in the optional desktop sidebar. */
  brand?: ReactNode;
  className?: string;
  communityImages?: ImageGenerationTask[];
  copy?: Partial<ImageGeneratorCopy>;
  defaultAspectRatio?: string;
  defaultImageCount?: number;
  defaultModel?: string;
  initialPrompt?: string;
  initialTab?: ImageGeneratorTab;
  /** Set false to hide the desktop navigation rail. */
  isAuthenticated?: boolean;
  maxReferences?: number;
  models?: string[];
  myImages?: ImageGenerationTask[];
  navItems?: ImageGeneratorNavItem[];
  /** Called for the active image's download control. */
  onDownload?: (image: GeneratedImage, task: ImageGenerationTask) => void;
  /** Connect this callback to your generation endpoint. */
  onGenerate?: (
    input: ImageGenerationInput
  ) => Promise<ImageGenerationTask | void> | ImageGenerationTask | void;
  /** Invoked when an unauthenticated visitor attempts a generation. */
  onRequireAuth?: () => void;
  /** Receives the selected task, useful for analytics or URL routing. */
  onTaskSelect?: (task: ImageGenerationTask) => void;
  showSidebar?: boolean;
  supportedAspectRatios?: readonly string[];
};
