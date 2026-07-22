import { getAllConfigs } from '@/modules/config/service';

import { RemoteScreenshotProvider } from './remote';

export interface ScreenshotResult {
  body: Uint8Array;
  contentType: string;
}

export interface ScreenshotProvider {
  readonly name: string;
  screenshot(url: string): Promise<ScreenshotResult>;
}

/**
 * Resolve a screenshot provider from DB config. Returns null when not
 * configured (caller surfaces a friendly "not configured" message) — same
 * pattern as the AI/storage/email providers. Remote HTTP API only, because the
 * prod target is Cloudflare Workers where a local headless browser can't run.
 */
export function getScreenshotManager(
  configs: Record<string, any>
): ScreenshotProvider | null {
  if (!configs.screenshot_api_base || !configs.screenshot_api_key) return null;
  return new RemoteScreenshotProvider({
    baseUrl: configs.screenshot_api_base,
    apiKey: configs.screenshot_api_key,
  });
}

export async function getScreenshot(): Promise<ScreenshotProvider | null> {
  return getScreenshotManager(await getAllConfigs());
}
