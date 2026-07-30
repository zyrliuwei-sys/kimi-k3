import { EvolinkImageProvider } from './evolink-image';
import { EvolinkVideoProvider, SEEDANCE_VIDEO_MODEL } from './evolink-video';
import { FalProvider } from './fal';
import { AIFile, AIMediaType, AIProvider, SaveFilesFunction } from './types';

export * from './evolink-image';
export * from './evolink-video';

export * from './aspect-ratios';
export * from './image-urls';

export * from './types';

/**
 * AI Manager to manage all AI providers
 */
export class AIManager {
  private providers: AIProvider[] = [];
  private defaultProvider?: AIProvider;
  private _saveFiles?: SaveFilesFunction;

  /**
   * Set the save files function for custom storage integration
   */
  setSaveFiles(fn: SaveFilesFunction) {
    this._saveFiles = fn;
  }

  /**
   * Get the save files function
   */
  get saveFiles(): SaveFilesFunction | undefined {
    return this._saveFiles;
  }

  addProvider(provider: AIProvider, isDefault = false) {
    this.providers.push(provider);
    if (isDefault) {
      this.defaultProvider = provider;
    }
  }

  getProvider(name: string): AIProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  getMediaTypes(): string[] {
    return Object.values(AIMediaType);
  }

  getDefaultProvider(): AIProvider | undefined {
    if (!this.defaultProvider && this.providers.length > 0) {
      this.defaultProvider = this.providers[0];
    }
    return this.defaultProvider;
  }
}

export const aiManager = new AIManager();

/**
 * Build a request-scoped AIManager with the Fal provider registered. Mirrors
 * getStorage()/getAuth(): the caller (an API route) passes the DB configs and
 * an optional `saveFiles` fn that rehosts generated outputs to the storage
 * provider. Returns null when Fal isn't configured (no fal_api_key) so routes
 * can surface a clear "not configured" error instead of crashing.
 *
 * Lives in core/ (not modules/) and takes configs/saveFiles as args so it stays
 * free of module imports; the route supplies both.
 */
export function getAIManager(
  configs: Record<string, any>,
  opts?: { saveFiles?: SaveFilesFunction }
): AIManager | null {
  const apiKey = configs?.fal_api_key;
  if (!apiKey) return null;

  const manager = new AIManager();
  manager.addProvider(
    new FalProvider({
      apiKey,
      customStorage: !!opts?.saveFiles,
      saveFiles: opts?.saveFiles,
    }),
    true
  );
  return manager;
}

export interface ImageProviderPick {
  provider: AIProvider;
  // The provider name as recorded on `provider.name` — used for the aiTask
  // row's `provider` column so analytics / refunds know which one ran.
  name: string;
  // The default model id we want to use when the caller didn't override.
  // Routes can still pass their own model through `image_model` admin key.
  defaultModel: string;
}

/**
 * Pick the image provider. **Evolink only** — this deployment is wired
 * to a single image gen provider (gpt-image-2 on Evolink). The menu hard
 * -codes just this one model so the wire-up is easy to debug before we
 * re-enable the others. If we ever add a second provider, re-introduce
 * the fallback chain here.
 */
export async function pickImageProvider(
  configs: Record<string, any>
): Promise<ImageProviderPick | null> {
  if (!configs?.evolink_api_key) return null;
  const evolink = new EvolinkImageProvider({
    apiKey: configs.evolink_api_key,
    baseUrl: configs.evolink_base_url,
  });
  // Hardcoded fallback — admin can override via `evolink_image_model`,
  // but only `gpt-image-2` is exposed in the menu right now.
  const model = configs.evolink_image_model || 'gpt-image-2';
  return {
    provider: evolink as unknown as AIProvider,
    name: 'evolink-image',
    defaultModel: model,
  };
}

/**
 * Video provider pick. Used by `POST /api/ai-tasks` for text-to-video
 * (Seedance 2.0 via Evolink). The video provider doesn't implement the
 * generic `AIProvider.generate()` interface — call `provider.submit()`
 * directly with `SeedanceVideoOptions`.
 */
export interface VideoProviderPick {
  provider: EvolinkVideoProvider;
  /** Stable provider identifier persisted on the aiTask row. */
  name: 'evolink-video';
  /** Default model id — admin can override via `evolink_video_model`. */
  defaultModel: string;
}

/**
 * Pick the video provider. **Evolink (Seedance) only** — the same
 * `evolink_api_key` powers chat, image, and video. If we ever add a
 * second video provider, re-introduce the fallback chain here.
 */
export async function pickVideoProvider(
  configs: Record<string, any>
): Promise<VideoProviderPick | null> {
  if (!configs?.evolink_api_key) return null;
  const evolink = new EvolinkVideoProvider({
    apiKey: configs.evolink_api_key,
    baseUrl: configs.evolink_base_url,
  });
  const model = configs.evolink_video_model || SEEDANCE_VIDEO_MODEL;
  return {
    provider: evolink,
    name: 'evolink-video',
    defaultModel: model,
  };
}

export * from './kie';
export * from './replicate';
export * from './gemini';
export * from './fal';
