import type { ScreenshotProvider, ScreenshotResult } from './index';

interface RemoteConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Remote screenshot provider — a GET endpoint that returns an image bytes for
 * `?url=`. Defaults follow the ScreenshotOne-style API (`access_key`, `output`,
 * `type`, `viewport_*`, `full_page`, `delay`); the base URL + key are set in
 * Admin → Settings → AI → Screenshot. Works on Node and Cloudflare Workers
 * alike (a plain fetch).
 */
export class RemoteScreenshotProvider implements ScreenshotProvider {
  readonly name = 'remote';
  configs: RemoteConfig;

  constructor(configs: RemoteConfig) {
    this.configs = configs;
  }

  async screenshot(url: string): Promise<ScreenshotResult> {
    const endpoint = new URL(this.configs.baseUrl);
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('access_key', this.configs.apiKey);
    endpoint.searchParams.set('output', 'image');
    endpoint.searchParams.set('type', 'png');
    endpoint.searchParams.set('viewport_width', '1440');
    endpoint.searchParams.set('viewport_height', '900');
    endpoint.searchParams.set('full_page', 'true');
    endpoint.searchParams.set('delay', '2');

    const res = await fetch(endpoint.href, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Screenshot service error (${res.status})`);
    }
    const contentType = res.headers.get('content-type')?.split(';')[0] || '';
    if (!contentType.startsWith('image/')) {
      throw new Error('Screenshot service did not return an image');
    }
    const body = new Uint8Array(await res.arrayBuffer());
    return { body, contentType };
  }
}
