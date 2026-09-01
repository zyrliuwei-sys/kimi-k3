/**
 * IndexNow protocol client.
 *
 * This module intentionally has no database dependency: callers resolve the
 * active configuration first, then pass it in. That keeps publishing usable
 * from any server route without coupling this module to the config module.
 */

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const MAX_URLS_PER_REQUEST = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type IndexNowConfig = Pick<
  Record<string, string>,
  'app_url' | 'indexnow_enabled' | 'indexnow_key'
>;

export type IndexNowStatus = {
  enabled: boolean;
  configured: boolean;
  keyLocation?: string;
  reason?: string;
};

export type IndexNowSubmissionResult = {
  submitted: number;
  accepted: boolean;
  skipped?: boolean;
  status?: number;
  message: string;
};

function configuredOrigin(config: IndexNowConfig): URL | null {
  const appUrl = config.app_url?.trim();
  if (!appUrl) return null;

  try {
    const url = new URL(appUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function isValidIndexNowKey(key: string | undefined): key is string {
  return !!key && KEY_PATTERN.test(key);
}

/** Return display-safe setup state. The key itself is never returned. */
export function getIndexNowStatus(config: IndexNowConfig): IndexNowStatus {
  const key = config.indexnow_key?.trim();
  const origin = configuredOrigin(config);

  if (!isValidIndexNowKey(key)) {
    return {
      enabled: false,
      configured: false,
      reason: 'Set a valid IndexNow key (8–128 letters, numbers, or dashes).',
    };
  }

  if (!origin) {
    return {
      enabled: false,
      configured: false,
      reason: 'Set a valid App URL before enabling IndexNow.',
    };
  }

  const keyLocation = new URL(`/${key}.txt`, origin).href;
  if (config.indexnow_enabled !== 'true') {
    return {
      enabled: false,
      configured: true,
      keyLocation,
      reason: 'IndexNow is disabled in Admin Settings.',
    };
  }

  return { enabled: true, configured: true, keyLocation };
}

function canonicalizeUrls(urls: string[], origin: URL): string[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('Provide at least one URL to submit.');
  }
  if (urls.length > MAX_URLS_PER_REQUEST) {
    throw new Error(
      `IndexNow accepts at most ${MAX_URLS_PER_REQUEST.toLocaleString()} URLs per request.`
    );
  }

  const accepted = new Set<string>();
  for (const value of urls) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Every IndexNow URL must be a non-empty string.');
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid IndexNow URL: ${value}`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`IndexNow only accepts http(s) URLs: ${value}`);
    }
    if (url.host !== origin.host) {
      throw new Error(
        `IndexNow URLs must use the configured host (${origin.host}).`
      );
    }

    // Fragments are not part of an HTTP resource and must not be submitted.
    url.hash = '';
    accepted.add(url.href);
  }

  return [...accepted];
}

/**
 * Publish changed same-host URLs to the shared IndexNow endpoint.
 *
 * A notification is deliberately best-effort at its call sites: failure to
 * reach a search engine must never undo a successfully saved article.
 */
export async function submitIndexNowUrls(params: {
  config: IndexNowConfig;
  urls: string[];
}): Promise<IndexNowSubmissionResult> {
  const status = getIndexNowStatus(params.config);
  if (!status.enabled || !status.keyLocation) {
    return {
      submitted: 0,
      accepted: false,
      skipped: true,
      message: status.reason || 'IndexNow is not configured.',
    };
  }

  const origin = configuredOrigin(params.config);
  const key = params.config.indexnow_key.trim();
  if (!origin || !isValidIndexNowKey(key)) {
    // getIndexNowStatus already guards this; keep the type narrowing local.
    throw new Error('IndexNow is not configured correctly.');
  }

  const urlList = canonicalizeUrls(params.urls, origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: origin.host,
        key,
        keyLocation: status.keyLocation,
        urlList,
      }),
      signal: controller.signal,
    });

    if (response.status === 200 || response.status === 202) {
      return {
        submitted: urlList.length,
        accepted: true,
        status: response.status,
        message:
          response.status === 202
            ? 'URLs received; IndexNow key validation is pending.'
            : 'URLs submitted to IndexNow.',
      };
    }

    const detail = (await response.text()).trim().slice(0, 300);
    return {
      submitted: urlList.length,
      accepted: false,
      status: response.status,
      message: detail
        ? `IndexNow rejected the request (${response.status}): ${detail}`
        : `IndexNow rejected the request (${response.status}).`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return {
      submitted: urlList.length,
      accepted: false,
      message: `Could not reach IndexNow: ${reason}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
