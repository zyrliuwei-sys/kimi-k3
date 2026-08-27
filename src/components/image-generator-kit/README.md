# Image Generator Kit

A copy-ready React + Tailwind image-generation workspace, extracted from the
`/image-generator` product experience. It is deliberately independent of this
repository's router, auth client, state store, query client, API client, and
translation system.

## What to copy

Copy this entire `image-generator-kit` directory into the destination project.
The kit only needs these peer dependencies:

```bash
pnpm add lucide-react motion
```

It uses Tailwind utility classes and React 19 APIs. No shadcn component,
TanStack Query, router, or backend SDK is required.
The included `package.json` lists the exact peer-dependency contract if you
prefer to publish the directory as a private package later.

## Smallest integration

```tsx
import {
  ImageGeneratorWorkspace,
  type ImageGenerationInput,
} from './components/image-generator-kit';

export function CreateImagePage() {
  return (
    <ImageGeneratorWorkspace
      brand="Northstar"
      models={['Flux Pro', 'GPT Image']}
      onGenerate={async (input: ImageGenerationInput) => {
        const response = await fetch('/api/images', {
          method: 'POST',
          body: JSON.stringify({
            prompt: input.prompt,
            ratio: input.aspectRatio,
            count: input.imageCount,
          }),
        });
        const data = await response.json();
        return {
          id: data.id,
          status: data.status,
          prompt: input.prompt,
          model: input.model,
          images: data.imageUrls.map((src: string, index: number) => ({
            id: `${data.id}-${index}`,
            src,
          })),
        };
      }}
    />
  );
}
```

`onGenerate` can return either a completed task (`status: 'success'`) or an
asynchronous task (`status: 'queued'` / `'processing'`). For asynchronous
generation, refresh your data in the parent and pass it back through `myImages`;
an item with the same ID replaces the kit's optimistic task.

## API contract

`onGenerate` receives:

```ts
{
  prompt: string;
  references: ImageGeneratorReference[]; // includes File for local uploads
  aspectRatio: string; // '' means Smart
  imageCount: number; // 1–4
  model?: string;
}
```

The kit has no opinion about authentication, subscriptions, or persistence:

- Set `isAuthenticated={false}` and pass `onRequireAuth` to open your own sign-in flow.
- Pass `communityImages` and `myImages` from any data layer.
- Pass `onDownload` when images require a signed endpoint or a server proxy.
- Pass `copy` to replace individual English strings without modifying the kit.

## Standalone pieces

The top-level workspace is composed from individually exported components:

- `PromptComposer` — auto-growing prompt field, drag/drop references, controls, and submit state.
- `ReferenceUploader` — file picker, drag/drop target, notes, previews, and remove controls.
- `GenerationControls` — output count, aspect ratio, and model menus.
- `ImageGallery` — responsive editorial gallery with queued/processing/failed states.
- `ResultViewer` — keyboard-accessible image preview and output chooser.
- `WorkspaceSidebar` — optional hover-expand navigation rail.

## Important production note

The default browser download works for same-origin or CORS-enabled image URLs.
For private provider URLs, implement `onDownload` and route that callback to a
same-origin download endpoint in your own application.
