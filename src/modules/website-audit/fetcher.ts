/**
 * Website Auditor — fetch orchestrator.
 *
 * Builds on top of `safeFetch` to:
 *   1. Fetch the main HTML page with the right body/time cap.
 *   2. Reject non-HTML responses early (avoid feeding JSON / images to the
 *      parser).
 *   3. In parallel, probe three "side resources" against the same origin
 *      (`robots.txt`, `llms.txt`, `sitemap.xml`) so the audit covers AI
 *      discoverability and crawlability.
 *
 * Each side probe uses `safeFetch` too — no separate SSRF path. Probes are
 * bounded by their own small body cap (32 KB) and run with `allSettled` so a
 * single failure doesn't kill the main fetch.
 */

import { safeFetch, type SafeFetchResult } from './safe-fetch';
import type { RobotsProbe, SideProbe } from './schema';

const MAIN_FETCH_MAX_BODY = 8 * 1024 * 1024;
const SIDE_PROBE_MAX_BODY = 32 * 1024;
const SIDE_PROBE_TIMEOUT_MS = 4_000;
const AI_BOT_KEYS: ReadonlyArray<keyof RobotsProbe['allowsAiBots']> = [
  'GPTBot',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
];

export interface AuditFetchOutput {
  fetch: SafeFetchResult;
  baseUrl: URL;
  robotsTxt?: RobotsProbe;
  llmsTxt?: SideProbe;
  sitemapXml?: SideProbe & { urlCount?: number };
}

export class FetchHttpError extends Error {
  constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'FetchHttpError';
  }
}

export async function fetchAuditResources(
  input: string,
  options: { probeSides?: boolean } = {}
): Promise<AuditFetchOutput> {
  const probeSides = options.probeSides ?? true;

  const main = await safeFetch(input, {
    maxBodyBytes: MAIN_FETCH_MAX_BODY,
  });

  // Reject non-HTML early — we can't audit a PDF or a JSON API the same way.
  if (!/text\/html|application\/xhtml\+xml/i.test(main.contentType)) {
    throw new FetchHttpError(
      'not_html',
      `Unexpected content-type: ${main.contentType}`
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(main.finalUrl);
  } catch {
    throw new FetchHttpError('invalid_final_url');
  }

  if (!probeSides) {
    return { fetch: main, baseUrl };
  }

  const origin = baseUrl.origin;
  const probes = await Promise.allSettled([
    probePath(origin, '/robots.txt'),
    probePath(origin, '/llms.txt'),
    probePath(origin, '/sitemap.xml'),
  ]);

  const robotsTxt = parseRobotsProbe(probes[0]);
  const llmsTxt = parseSimpleProbe(probes[1]);
  const sitemapXml = parseSitemapProbe(probes[2]);

  return { fetch: main, baseUrl, robotsTxt, llmsTxt, sitemapXml };
}

// ─── Side probes ────────────────────────────────────────────────────────────

async function probePath(
  origin: string,
  pathname: string
): Promise<SafeFetchResult | null> {
  try {
    const result = await safeFetch(`${origin}${pathname}`, {
      maxBodyBytes: SIDE_PROBE_MAX_BODY,
      connectTimeoutMs: SIDE_PROBE_TIMEOUT_MS,
      readTimeoutMs: SIDE_PROBE_TIMEOUT_MS,
      userAgent: 'Mozilla/5.0 (compatible; Kimik3Audit/1.0)',
    });
    if (result.statusCode < 200 || result.statusCode >= 300) return null;
    return result;
  } catch {
    return null;
  }
}

function parseRobotsProbe(
  r: PromiseSettledResult<SafeFetchResult | null>
): RobotsProbe | undefined {
  if (r.status !== 'fulfilled' || !r.value) return undefined;
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(
    r.value.bodyBytes
  );
  const lines = raw.split(/\r?\n/);
  const allows: RobotsProbe['allowsAiBots'] = {
    GPTBot: false,
    ClaudeBot: false,
    'Claude-Web': false,
    PerplexityBot: false,
    'Google-Extended': false,
  };
  let currentAgents: string[] = [];
  const apply = () => {
    if (!currentAgents.length) return;
    const allow = currentAgents.some((a) =>
      AI_BOT_KEYS.some((bot) => bot.toLowerCase() === a.toLowerCase())
    );
    if (allow) {
      for (const a of currentAgents) {
        const k = AI_BOT_KEYS.find(
          (bot) => bot.toLowerCase() === a.toLowerCase()
        );
        if (k) (allows as Record<string, boolean>)[k] = true;
      }
    }
  };
  for (const line of lines) {
    const trimmed = line.replace(/^﻿/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (key === 'user-agent') {
      apply();
      currentAgents = [value];
    } else if (key === 'allow' || key === 'disallow') {
      // We only care whether the section applies; values don't change bot-set
      // status. Continue walking lines to detect next user-agent.
      // The end-of-section "apply" flushes correctly.
    } else if (key === 'sitemap') {
      // Unused in this minimal parser.
    }
  }
  apply();
  return { exists: true, raw, allowsAiBots: allows };
}

function parseSimpleProbe(
  r: PromiseSettledResult<SafeFetchResult | null>
): SideProbe | undefined {
  if (r.status !== 'fulfilled' || !r.value) return undefined;
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(
    r.value.bodyBytes
  );
  return { exists: true, raw };
}

function parseSitemapProbe(
  r: PromiseSettledResult<SafeFetchResult | null>
): (SideProbe & { urlCount?: number }) | undefined {
  const base = parseSimpleProbe(r);
  if (!base) return undefined;
  const urlCount = (base.raw?.match(/<url[\s>]/g) ?? []).length;
  return { exists: true, raw: base.raw, urlCount };
}

// ─── HTML decoder helper ────────────────────────────────────────────────────

/** Best-effort decode — handles BOM + utf-8, falls back to latin-1. */
export function decodeHtml(body: Uint8Array, declaredCharset?: string): string {
  // Strip UTF-8 BOM if present; the TextDecoder handles it but is slow.
  if (
    body.length >= 3 &&
    body[0] === 0xef &&
    body[1] === 0xbb &&
    body[2] === 0xbf
  ) {
    return new TextDecoder('utf-8').decode(body.subarray(3));
  }
  const enc = (declaredCharset || '').toLowerCase().trim();
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc, { fatal: false }).decode(body);
    } catch {
      /* fall through */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(body);
  } catch {
    return new TextDecoder('latin1').decode(body);
  }
}
