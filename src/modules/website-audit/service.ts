/**
 * Website Auditor — orchestration service.
 *
 * End-to-end audit pipeline:
 *   URL → normalize + hash → cache lookup → pricing decision
 *   → fetch (SSRF-guarded) + parse → LLM call (with JSON retry)
 *   → save report to aiTask + cache.
 *
 * Errors are normalized to specific error codes so the API route can map
 * them to user-friendly messages. Credits are deducted atomically inside
 * `createTask()` (FIFO via `consume()`); on any failure after deduction the
 * task is flipped to FAILED, and `ai-tasks/service.ts` auto-refunds via
 * `revoke()`.
 *
 * Two public entry points:
 *   - `runAudit({userId, url})` — full pipeline (called by POST handler)
 *   - `getAuditReport({taskId, userId})` — fetch persisted report (GET handler)
 */

import { openaiChatCompletion, type ChatTurn } from '@/core/ai/chat';
import { estimateStringTokens } from '@/core/ai/token-estimate';
import {
  AITaskStatus,
  createTask,
  findTask,
  updateTask,
} from '@/modules/ai-tasks/service';
import { getAllConfigs } from '@/modules/config/service';

import { getGlobalBenchmarks } from './benchmark';
import { getCachedReport, hashUrl, setCachedReport } from './cache';
import { decodeHtml, fetchAuditResources } from './fetcher';
import { buildSiteData } from './parser';
import {
  decideAuditCost,
  readPricingConfig,
  type PricingReason,
} from './pricing';
import { buildAuditMessages } from './prompts';
import { AuditReportSchema, type AuditReport } from './schema';

// ─── Public types ──────────────────────────────────────────────────────────

export type AuditErrorCode =
  | 'invalid_url'
  | 'protocol_blocked'
  | 'private_ip_blocked'
  | 'dns_lookup_failed'
  | 'unreachable'
  | 'too_many_redirects'
  | 'body_too_large'
  | 'not_html'
  | 'input_too_large'
  | 'audit_llm_unavailable'
  | 'audit_llm_timeout'
  | 'audit_llm_invalid_json'
  | 'insufficient_credits'
  | 'unknown';

export interface RunAuditParams {
  userId: string;
  url: string;
}

export interface AuditRunResult {
  taskId: string;
  status: 'success';
  report: AuditReport;
  cached: boolean;
  costCredits: number;
  reason: PricingReason;
}

export class AuditError extends Error {
  constructor(
    public readonly code: AuditErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'AuditError';
  }
}

// ─── Main entry ────────────────────────────────────────────────────────────

export async function runAudit(
  params: RunAuditParams
): Promise<AuditRunResult> {
  const start = Date.now();
  // eslint-disable-next-line no-console
  const log = (step: string, extra?: unknown) =>
    console.log(`[audit-run] step=${step} url=${params.url}`, extra ?? '');

  log('start');

  // 1. Normalize + hash (URL syntax + tracking-param stripping).
  const { normalized, hash } = hashUrl(params.url);
  log('hashed', { hash: hash.slice(0, 12) });

  // 2. Cache lookup — short-circuits everything.
  const cached = await getCachedReport(hash);
  if (cached) {
    log('cache-hit');
    return writeCachePassthrough(params, normalized, hash, cached.report);
  }
  log('cache-miss');

  // 3. Pricing decision (cache + first-free + standard).
  const configs = await getAllConfigs();
  const pricing = readPricingConfig(configs);
  log('configs-loaded', { firstFree: pricing.firstFree });
  let decision;
  try {
    decision = await decideAuditCost({
      userId: params.userId,
      urlHash: hash,
      config: pricing,
    });
  } catch (e: any) {
    throw new AuditError('insufficient_credits', e?.message);
  }
  log('priced', { reason: decision.reason, cost: decision.cost });

  // 4. Resolve LLM config (fails early if no provider is configured).
  const llm = resolveLlmConfig(configs);
  if (!llm) throw new AuditError('audit_llm_unavailable');
  log('llm-resolved', { provider: llm.provider, model: llm.model });

  // 5. Pre-create task to deduct credits + reserve a row.
  // createTask throws 'Insufficient credits' when balance < costCredits; we
  // catch and re-throw as a typed error so the route maps it to 402 cleanly.
  let task;
  try {
    task = await createTask({
      userId: params.userId,
      mediaType: 'audit',
      provider: llm.provider,
      model: llm.model,
      prompt: normalized,
      costCredits: decision.cost,
    });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.toLowerCase().includes('insufficient')) {
      throw new AuditError('insufficient_credits', msg);
    }
    throw e;
  }
  log('task-created', { taskId: task.id, cost: decision.cost });

  // 6-12. Fetch + parse + LLM + persist. Any failure here → mark FAILED
  // (which auto-refunds the credits).
  let report: AuditReport | null = null;
  try {
    log('fetch-start');
    const audit = await fetchAuditResources(params.url);
    log('fetch-done', {
      status: audit.fetch.statusCode,
      bodyBytes: audit.fetch.bodyBytes.byteLength,
    });

    const html = decodeHtml(audit.fetch.bodyBytes, audit.fetch.contentType);
    log('decoded', { htmlLen: html.length });

    const siteData = buildSiteData({
      html,
      fetch: audit.fetch,
      robotsTxt: audit.robotsTxt,
      llmsTxt: audit.llmsTxt,
      sitemapXml: audit.sitemapXml,
    });
    log('parsed', {
      headings: siteData.headings.length,
      images: siteData.images.length,
    });

    const messages = buildAuditMessages(siteData);
    const promptText = messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    const inputTokens = estimateStringTokens(promptText);
    log('tokens', { inputTokens });
    const maxTokens = Number(configs.audit_max_input_tokens) || 80_000;
    if (inputTokens > maxTokens) {
      throw new AuditError('input_too_large', `${inputTokens} > ${maxTokens}`);
    }

    log('llm-call-start');
    const timeoutMs = Number(configs.audit_timeout_ms) || 90_000;
    const raw = await withTimeout(
      openaiChatCompletion({
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        messages,
      }),
      timeoutMs,
      'audit_llm_timeout' as AuditErrorCode
    );
    log('llm-call-done', {
      rawLen: typeof raw === 'string' ? raw.length : 'n/a',
    });

    // Try once; on parse failure retry once with a stricter instruction.
    const parsed = AuditReportSchema.safeParse(extractJson(raw));
    let finalJson: string;
    if (parsed.success) {
      finalJson = JSON.stringify(parsed.data);
      log('llm-parsed-ok', { score: parsed.data.overall?.score });
    } else {
      log('llm-parse-fail-retry');
      const retryMessages: ChatTurn[] = [
        ...messages,
        {
          role: 'user',
          content:
            'Your previous response did not match the required JSON schema. ' +
            'Respond with ONLY the corrected JSON object — no markdown fence, no prose.',
        },
      ];
      const retryRaw = await withTimeout(
        openaiChatCompletion({
          apiKey: llm.apiKey,
          baseUrl: llm.baseUrl,
          model: llm.model,
          messages: retryMessages,
        }),
        timeoutMs,
        'audit_llm_timeout' as AuditErrorCode
      );
      const retryParsed = AuditReportSchema.safeParse(extractJson(retryRaw));
      if (!retryParsed.success) {
        throw new AuditError('audit_llm_invalid_json');
      }
      finalJson = JSON.stringify(retryParsed.data);
      log('llm-parsed-retry-ok', { score: retryParsed.data.overall?.score });
    }

    report = JSON.parse(finalJson) as AuditReport;

    // Stamp server-known fields; never trust the LLM to fill these correctly.
    report.url = params.url;
    report.finalUrl = report.finalUrl || audit.fetch.finalUrl;
    report.fetchedAt = new Date().toISOString();
    report.durationMs = Date.now() - start;
    report.pageStats.statusCode = audit.fetch.statusCode;
    report.pageStats.redirectChain = audit.fetch.redirectChain;
    report.pageStats.htmlSizeBytes = audit.fetch.bodyBytes.byteLength;
    report.pageStats.lang = siteData.htmlLang;
    report.pageStats.hasSitemap = !!siteData.sitemapXml?.exists;
    report.pageStats.hasLlmsTxt = !!siteData.llmsTxt?.exists;
    report.pageStats.hasRobotsTxt = !!siteData.robotsTxt?.exists;
    report.pageStats.hasFavicon = !!audit.fetch.headers['link']; // approximate
    log('stamp-done');

    const ttlDays = Number(configs.audit_cache_ttl_days) || 7;
    await setCachedReport({
      url: normalized,
      urlHash: hash,
      report,
      ttlDays,
    });
    log('cache-written');

    await updateTask({
      taskId: task.id,
      status: AITaskStatus.SUCCESS,
      taskResult: report,
    });
    log('task-done');
  } catch (err: any) {
    log('error', { code: err?.code, msg: err?.message });
    await updateTask({ taskId: task.id, status: AITaskStatus.FAILED });
    if (err instanceof AuditError) throw err;
    // eslint-disable-next-line no-console
    console.error(
      '[audit-run] pipeline failure:',
      err?.stack || err?.message || err
    );
    throw err;
  }

  return {
    taskId: task.id,
    status: 'success',
    report: report!,
    cached: false,
    costCredits: decision.cost,
    reason: decision.reason,
  };
}

// ─── Cache passthrough ─────────────────────────────────────────────────────

async function writeCachePassthrough(
  params: RunAuditParams,
  normalized: string,
  hash: string,
  cachedReport: AuditReport
): Promise<AuditRunResult> {
  const task = await createTask({
    userId: params.userId,
    mediaType: 'audit',
    provider: 'cache',
    model: 'cache-hit',
    prompt: normalized,
    costCredits: 0,
  });
  await updateTask({
    taskId: task.id,
    status: AITaskStatus.SUCCESS,
    taskResult: cachedReport,
  });
  return {
    taskId: task.id,
    status: 'success',
    report: cachedReport,
    cached: true,
    costCredits: 0,
    reason: 'cache_hit',
  };
}

// ─── LLM config resolver ───────────────────────────────────────────────────

function resolveLlmConfig(
  configs: Record<string, any>
): { provider: string; apiKey: string; baseUrl: string; model: string } | null {
  const provider = String(
    configs.audit_llm_provider || 'evolink'
  ).toLowerCase();
  if (provider === 'evolink') {
    const apiKey = (configs.evolink_api_key || '').toString();
    if (!apiKey) return null;
    const baseUrl = (
      configs.evolink_base_url || 'https://api.evolink.ai/v1'
    ).toString();
    const model = (
      configs.audit_llm_model ||
      configs.evolink_model ||
      'kimi-k3'
    ).toString();
    return { provider: 'evolink', apiKey, baseUrl, model };
  }
  if (provider === 'openai') {
    const apiKey = (configs.openai_api_key || '').toString();
    if (!apiKey) return null;
    const baseUrl = (
      configs.openai_base_url || 'https://api.openai.com/v1'
    ).toString();
    const model = (
      configs.audit_llm_model ||
      configs.openai_model ||
      'gpt-4o-mini'
    ).toString();
    return { provider: 'openai', apiKey, baseUrl, model };
  }
  return null;
}

// ─── JSON extraction + timeout helpers ──────────────────────────────────────

/**
 * Pull a JSON object out of an LLM response, forgiving of ```json fences
 * and stray prose. Falls back to returning the trimmed whole text.
 */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return text.trim();
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  code: AuditErrorCode
): Promise<T> {
  let timer: any = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new AuditError(code)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Read API (used by GET handler) ─────────────────────────────────────────

export async function getAuditReport(
  taskId: string,
  userId: string
): Promise<AuditReport | null> {
  const task = await findTask(taskId);
  if (!task || task.userId !== userId) return null;
  if (task.status !== AITaskStatus.SUCCESS) return null;
  if (!task.taskResult) return null;
  if (typeof task.taskResult !== 'string') {
    return task.taskResult as unknown as AuditReport;
  }
  try {
    return JSON.parse(task.taskResult) as AuditReport;
  } catch {
    return null;
  }
}

export async function getBenchmarkIfEnabled(): Promise<
  Awaited<ReturnType<typeof getGlobalBenchmarks>>
> {
  const configs = await getAllConfigs();
  if (configs.audit_global_benchmark_enabled === 'false') return null;
  return getGlobalBenchmarks();
}
