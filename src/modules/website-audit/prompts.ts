/**
 * Website Auditor — LLM prompts.
 *
 * Three pieces:
 *   1. SYSTEM_PROMPT (en + zh) sets role, dimensions, output contract.
 *   2. buildUserPrompt(siteData) renders the SiteData the model needs.
 *   3. detectLocale(siteData) picks 'zh' for Chinese pages, 'en' otherwise
 *      — the model is then asked to write all prose in that locale.
 *
 * Why locale-aware prompts: A Chinese-language page about CTAs in English
 * would be a confusing report. The audit "speaks" the customer's language
 * so each finding reads as something they understand immediately.
 *
 * The model is asked for STRICT JSON output. We don't rely on providers'
 * `response_format` flag (some OpenAI-compatible gateways ignore it) —
 * instead we parse + `safeParse` + retry-once-on-failure in `service.ts`.
 */

import type { ChatTurn } from '@/core/ai/chat';

import type { SiteData } from './schema';

// ────────────────────────────────────────────────────────────────────────────
// System prompt (single English block — model can follow either language but
// scoring logic and section names stay in English so the schema doesn't slip)
// ────────────────────────────────────────────────────────────────────────────

export const AUDIT_SYSTEM_PROMPT = `You are kimik3's Website Audit Engine.

TASK
You will receive the parsed metadata of a public web page (URL, HTTP details, HTML head tags, headings, images, scripts, semantic HTML signals, JSON-LD blocks, visible text preview, side probes for robots.txt/llms.txt/sitemap.xml, security response headers).

Produce a structured audit across exactly 7 dimensions. For each dimension:
- Score 0–100 (integer)
- Grade A/B/C/D/F (A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F < 60)
- 1–2 sentence summary
- 3–10 findings (fewer if the dimension is clean)

Each finding must have:
- id (kebab-case string)
- dimension (one of: seo, ui, performance, a11y, aiReadability, codeQuality, content)
- severity: critical | high | medium | low
- title: short issue label
- evidence: cite the actual HTML/headers/JSON-LD when useful
- fix: specific, actionable instruction
- cursorPrompt: a complete, paste-ready prompt for Cursor

After sections, emit:
- priorities: ranked top ≤10 fixes ordered by expected ROI across dimensions
- cursorPrompts: map finding.id → cursorPrompt (same content, indexed for fast UI lookup)

DIMENSION DEFINITIONS

1) SEO
   - <title> length 30–60 with primary keyword; <meta name="description"> 120–160 with CTA
   - H1 uniqueness; heading hierarchy (no skipped levels: h1 → h3 is bad)
   - <link rel="canonical"> present and self-referential when appropriate
   - Open Graph: og:title, og:description, og:image, og:url
   - Twitter Card: twitter:card, twitter:title
   - JSON-LD structured data (Organization / WebSite / BreadcrumbList / Article / Product / FAQ — depends on page type)
   - Image alt coverage
   - Internal link sanity; canonical URL pattern
   - robots.txt reachable + sitemap.xml referenced
   - hreflang for multilingual sites

2) UI / VISUAL
   - Semantic HTML5 landmarks (header, nav, main, footer used; excessive div-soup is bad)
   - Typography: ≤ 2–3 font families; clear size scale; readable body
   - Color contrast on text/backgrounds (best-effort from inline styles)
   - CTA prominence: actionable copy ("Start free trial" not "Click here")
   - Density: not wall-of-text; reasonable whitespace (heuristic from DOM)
   - Inline-style abuse (>50 inline styles usually indicates a missing design system)

3) PERFORMANCE
   - HTML size sanity (target <100 KB)
   - Script count: > 15 external scripts is high
   - Blocking render: preconnect/preload hints absent
   - Image optimization: explicit width/height to avoid CLS; loading="lazy" below the fold
   - Total structural payload size

4) ACCESSIBILITY (a11y)
   - <html lang> attribute set
   - All <img> have non-empty alt OR explicit alt="" for decorative
   - Form inputs have associated <label> or aria-label
   - ARIA roles on landmarks only when enhancing
   - Color contrast ratio (rough from inline styles)
   - Skip-to-content link or equivalent
   - Heading order respects hierarchy

5) AI READABILITY (LLM citation & discovery — distinctive kimik3 angle)
   - llms.txt (https://llmstxt.org) present at site root
   - llms-full.txt present and substantial
   - robots.txt explicitly allows GPTBot, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended
   - JSON-LD coverage and granularity (Article has author + datePublished; Organization has name + logo + sameAs links)
   - E-E-A-T signals: about / contact pages linked; author bios present
   - Semantic HTML (no div-soup) — easier for LLM chunkers
   - Citation-friendly content: explicit dates, named sources, statistics, definitions

6) CODE QUALITY
   - Code quality dimension is gated — set section to null unless source was uploaded. When null, section.codeQuality = null in the JSON.
   - When source provided: analyze HTML semantic correctness, inline-style ratio, framework fingerprint, accessibility attributes in source.

7) CONTENT (copy)
   - H1 clarity and uniqueness (passes the "what does this page do" test)
   - Value proposition above the fold
   - CTA wording strength
   - Trust signals: testimonials, customer logos, certifications, numbers
   - Reading level (target 6th–10th grade for marketing copy)
   - Specificity: named numbers ("save 4 hours/week") beat vague ("improve productivity")

OUTPUT LOCALE
Write all prose (summary, titles, evidence, fix, cursorPrompt) in {{OUTPUT_LOCALE}}.
Numbers, identifiers, and technical terms stay in English.

OUTPUT FORMAT — STRICT JSON
Respond with ONLY a JSON object matching this exact shape (no prose, no markdown fence, no commentary):

{
  "url": "<string>",
  "finalUrl": "<string>",
  "fetchedAt": "<ISO8601>",
  "durationMs": 0,
  "pageStats": {
    "statusCode": 0,
    "redirectChain": [{"url":"","status":0}],
    "htmlSizeBytes": 0,
    "scriptCount": 0,
    "externalScriptHosts": [],
    "stylesheetCount": 0,
    "imageCount": 0,
    "imageAltsMissing": 0,
    "fontsCount": 0,
    "iframeCount": 0,
    "formCount": 0,
    "internalLinks": 0,
    "externalLinks": 0,
    "hasViewport": true,
    "hasCharset": true,
    "hasSitemap": true,
    "hasLlmsTxt": true,
    "hasRobotsTxt": true,
    "hasFavicon": true,
    "securityHeaders": {"csp":true,"xFrameOptions":true,"hsts":true,"referrerPolicy":true,"xContentTypeOptions":true,"permissionsPolicy":true},
    "analyticsDetected": [],
    "lang": "<string|null>"
  },
  "overall": {"score":0,"grade":"A"},
  "summary": "<2-3 sentences>",
  "locale": "{{OUTPUT_LOCALE_CODE}}",
  "sections": {
    "seo": {"score":0,"grade":"A","summary":"...","findings":[...]},
    "ui": {"score":0,"grade":"A","summary":"...","findings":[...]},
    "performance": {"score":0,"grade":"A","summary":"...","findings":[...]},
    "a11y": {"score":0,"grade":"A","summary":"...","findings":[...]},
    "aiReadability": {"score":0,"grade":"A","summary":"...","findings":[...]},
    "codeQuality": null,
    "content": {"score":0,"grade":"A","summary":"...","findings":[...]}
  },
  "priorities": [{"findingId":"","title":"","severity":"high","dimension":"seo","estimatedImpact":"high","cursorPrompt":"..."}],
  "cursorPrompts": {"finding.id":"..."}
}

CONSTRAINTS
- finding.id values must be globally unique (use dimension prefix: "seo.missing.canonical", etc.)
- Be specific. Do not say "consider improving X" — say exactly what to do.
- Cite evidence by quoting the actual HTML tag/value when relevant.
- cursorPrompt MUST be paste-ready into Cursor (no placeholders, no "TODO").
- If you have nothing meaningful to add for a dimension, omit findings but still emit score/grade/summary.
- Do not invent facts that aren't in the SiteData. If a value is missing, mark the field null/0 and skip related findings.`;

// ────────────────────────────────────────────────────────────────────────────
// Locale detection
// ────────────────────────────────────────────────────────────────────────────

/** Heuristic — `zh` / `zh-CN` / `zh-Hans` / `zh-TW` all count as Chinese. */
export function detectLocale(siteData: SiteData): 'en' | 'zh' {
  const lang = (siteData.htmlLang ?? '').toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  // Secondary signal: high Chinese character density in visible text
  const sample = siteData.visibleTextPreview.slice(0, 1500);
  if (sample) {
    const cjkChars = (sample.match(/[一-鿿]/g) || []).length;
    const totalChars = sample.replace(/\s/g, '').length || 1;
    if (cjkChars / totalChars > 0.3) return 'zh';
  }
  return 'en';
}

// ────────────────────────────────────────────────────────────────────────────
// User-message payload (SiteData rendered as a compact JSON blob)
// ────────────────────────────────────────────────────────────────────────────

const USER_PROMPT_TEMPLATE = `SITE METADATA
The following JSON describes the page you must audit. Use ONLY this data; do not assume anything else.

\`\`\`json
{{SITE_DATA}}
\`\`\`

REMINDERS
- Output JSON only. No prose, no markdown fence outside the JSON.
- Locale: {{OUTPUT_LOCALE_NAME}}.
- url / finalUrl / fetchedAt / pageStats: fill from the metadata above (echo accurately).
- durationMs: estimate based on your processing — set a reasonable integer (e.g. 1500–8000).
- Be specific in evidence: paste the actual HTML snippet or attribute value when relevant.
- For codeQuality, set the section to \`null\` (no source was uploaded).`;

/**
 * Strip very large fields from SiteData before stringifying to keep the
 * user prompt within budget. The model doesn't need every byte of script
 * source — counts suffice for the rubric.
 */
function compactSiteData(siteData: SiteData): Record<string, unknown> {
  const s = siteData;
  return {
    url: s.url,
    finalUrl: s.finalUrl,
    fetchedAt: s.fetchedAt,
    statusCode: s.statusCode,
    contentType: s.contentType,
    charset: s.charset,
    htmlSizeBytes: s.htmlSizeBytes,
    htmlLang: s.htmlLang,
    hasViewport: s.hasViewport,
    hasCharset: s.hasCharset,
    metaTags: s.metaTags.slice(0, 80),
    linkTags: s.linkTags.slice(0, 60),
    headings: s.headings.slice(0, 100),
    images: {
      total: s.images.length,
      withoutAlt: s.imagesWithoutAlt,
      withoutDims: s.imagesWithoutDims,
      samples: s.images.slice(0, 25),
    },
    internalLinkCount: s.internalLinkCount,
    externalLinkCount: s.externalLinkCount,
    scriptCount: s.scriptCount,
    externalScriptHosts: s.externalScriptHosts.slice(0, 30),
    stylesheetCount: s.stylesheetCount,
    fontFamilies: s.fontFamilies,
    iframeCount: s.iframeCount,
    formCount: s.formCount,
    inputCountWithoutLabel: s.inputCountWithoutLabel,
    inlineStyleCount: s.inlineStyleCount,
    imagesWithoutAlt: s.imagesWithoutAlt,
    imagesWithoutDims: s.imagesWithoutDims,
    jsonLd: s.jsonLd,
    hasMain: s.hasMain,
    hasNav: s.hasNav,
    hasHeader: s.hasHeader,
    hasFooter: s.hasFooter,
    hasArticle: s.hasArticle,
    hasAside: s.hasAside,
    visibleTextPreview: s.visibleTextPreview.slice(0, 6000),
    securityHeaders: s.securityHeaders,
    robotsTxt: s.robotsTxt
      ? {
          exists: true,
          allowsAiBots: s.robotsTxt.allowsAiBots,
          // robots.txt raw is huge — only show first 1KB
          rawPreview: s.robotsTxt.raw?.slice(0, 1024),
        }
      : { exists: false },
    llmsTxt: s.llmsTxt
      ? {
          exists: true,
          rawPreview: s.llmsTxt.raw?.slice(0, 2048),
        }
      : { exists: false },
    sitemapXml: s.sitemapXml
      ? {
          exists: true,
          urlCount: s.sitemapXml.urlCount,
          rawPreview: s.sitemapXml.raw?.slice(0, 1024),
        }
      : { exists: false },
  };
}

export function buildUserPrompt(
  siteData: SiteData,
  locale: 'en' | 'zh'
): string {
  const localeName = locale === 'zh' ? 'Chinese (Simplified)' : 'English';
  const systemWithLocale = AUDIT_SYSTEM_PROMPT.replace(
    '{{OUTPUT_LOCALE}}',
    localeName
  ).replace('{{OUTPUT_LOCALE_CODE}}', locale);
  const user = USER_PROMPT_TEMPLATE.replace(
    '{{SITE_DATA}}',
    JSON.stringify(compactSiteData(siteData), null, 2)
  )
    .replace('{{OUTPUT_LOCALE}}', localeName)
    .replace('{{OUTPUT_LOCALE_NAME}}', localeName);

  // Concatenate system + user as a single user message (the chat-completions
  // wrapper takes a system turn separately). Service layer is responsible for
  // splitting into messages.
  return `${systemWithLocale}\n\n${user}`;
}

/** Convenience: build the messages array (`openaiChatCompletion` takes ChatTurn[]). */
export function buildAuditMessages(siteData: SiteData): ChatTurn[] {
  const locale = detectLocale(siteData);
  return [
    {
      role: 'system',
      content:
        "You are kimik3's Website Audit Engine — a precise, evidence-based web auditor that produces strict JSON output matching the AuditReport schema. Follow output contract strictly: no prose outside JSON, write all findings in the detected locale, cite real HTML evidence, and never invent facts not present in the input.",
    },
    { role: 'user', content: buildUserPrompt(siteData, locale) },
  ];
}
