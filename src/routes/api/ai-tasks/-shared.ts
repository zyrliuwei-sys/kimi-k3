import type { AIFile, SaveFilesFunction } from '@/core/ai';
import { envConfigs } from '@/config';
import { getStorage } from '@/modules/storage/service';

/**
 * Shared helpers for the /api/ai-tasks routes (Web & Motion video replicate).
 * Colocated non-route file (the `-` prefix keeps it off the route tree).
 */

export const DEFAULT_PROMPT =
  'Faithfully recreate this video in high quality, preserving the original content, motion, and composition.';
export const DEFAULT_MODEL = 'fal-ai/kling-video/o1/video-to-video/edit';
export const DEFAULT_CREDIT_COST = 10;

/** Parse the JSON `taskResult`/`taskInfo` blob stored on an aiTask row. */
export function parseTaskResult(raw: any): Record<string, any> {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

/**
 * SSRF guard for the source video URL. Fal fetches the URL server-side, so a
 * user must not be able to point it at an arbitrary (incl. internal) address —
 * only origins we control (our R2/public storage domain, the app URL, or
 * localhost for dev) are accepted.
 */
export function isAllowedVideoUrl(raw: string, hosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return hosts.includes(url.hostname);
}

export function allowedVideoHosts(configs: Record<string, any>): string[] {
  const hosts = new Set<string>();
  const add = (val?: string) => {
    if (!val) return;
    try {
      hosts.add(new URL(val).hostname);
    } catch {
      // Bare host (no scheme), e.g. "cdn.example.com" — strip any path/port.
      const clean = val
        .trim()
        .replace(/^https?:\/\//, '')
        .split('/')[0];
      if (clean) hosts.add(clean);
    }
  };
  add(configs.r2_domain);
  add(configs.r2_endpoint);
  add(envConfigs.app_url);
  hosts.add('localhost'); // dev uploads + local tunnels
  return [...hosts];
}

/**
 * Build a saveFiles fn that rehosts generated outputs to the storage provider
 * (so Fal's temporary URLs don't expire). Returns undefined when storage isn't
 * configured — callers then degrade to Fal's temporary URLs.
 */
export async function buildRehostSaveFiles(): Promise<
  SaveFilesFunction | undefined
> {
  const storage = await getStorage();
  if (!storage) return undefined;
  return async (files: AIFile[]): Promise<AIFile[]> => {
    const out: AIFile[] = [];
    for (const f of files) {
      const res = await storage.downloadAndUpload({
        url: f.url,
        key: f.key,
        contentType: f.contentType,
        disposition: 'inline',
      });
      out.push({ ...f, url: res.url || f.url });
    }
    return out;
  };
}
