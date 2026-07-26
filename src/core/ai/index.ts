import { EvolinkImageProvider } from './evolink-image';
import { FalProvider } from './fal';
import { AIFile, AIMediaType, AIProvider, SaveFilesFunction } from './types';

export * from './evolink-video';

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
 * to a single image gen provider (gpt-image-2 on Evolink). If
 * we ever add a second provider, re-introduce the fallback chain here.
 */
export async function pickImageProvider(
  configs: Record<string, any>
): Promise<ImageProviderPick | null> {
  if (!configs?.evolink_api_key) return null;
  const evolink = new EvolinkImageProvider({
    apiKey: configs.evolink_api_key,
    baseUrl: configs.evolink_base_url,
  });
  // Hardcoded default — admin can override via `evolink_image_model`.
  const model = configs.evolink_image_model || 'gpt-image-2';
  return {
    provider: evolink as unknown as AIProvider,
    name: 'evolink-image',
    defaultModel: model,
  };
}

export * from './kie';
export * from './replicate';
export * from './gemini';
export * from './fal';
