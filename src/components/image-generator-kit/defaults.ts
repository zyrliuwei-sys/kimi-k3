import type { ImageGeneratorCopy, ImageGeneratorNavItem } from './types';

export const DEFAULT_ASPECT_RATIOS = [
  '',
  '1:1',
  '4:5',
  '3:4',
  '16:9',
  '9:16',
] as const;

export const DEFAULT_IMAGE_GENERATOR_COPY: ImageGeneratorCopy = {
  addReference: 'Add reference',
  aspectRatio: 'Frame',
  community: 'Discover',
  create: 'Create',
  dropImages: 'Drop reference images here',
  emptyCommunity: 'Bring a few community images to make this gallery yours.',
  emptyMine: 'Your finished images will collect here.',
  generate: 'Generate',
  generating: 'Generating',
  imageCount: 'Outputs',
  mine: 'My images',
  model: 'Model',
  noProvider: 'Connect onGenerate to create images.',
  promptPlaceholder:
    'Describe an image, mood, scene, or the details you want to preserve…',
  referenceNote: 'What should this image guide?',
  removeReference: 'Remove reference',
  result: 'Latest result',
  signInToGenerate: 'Sign in to generate',
  uploadLimit: (max) => `You can add up to ${max} reference images.`,
};

export const DEFAULT_IMAGE_GENERATOR_NAV: ImageGeneratorNavItem[] = [
  { label: 'Studio' },
  { label: 'Library' },
];
