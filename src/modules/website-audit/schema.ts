/**
 * Website Auditor — type & zod schema definitions.
 *
 * Three layers:
 *   1. `SiteData`        — internal: what `parser.ts` extracts from HTML.
 *   2. `AuditReport`     — output: what `service.ts` saves to aiTask.taskResult
 *                          and what the LLM must produce.
 *   3. shared enums      — Dimension / Severity / Grade.
 *
 * zod is the source of truth: types are inferred via `z.infer<...>`. The LLM
 * output is validated with `.safeParse(...)` and a single retry on failure
 * (handled in `service.ts`, not here).
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Shared enums
// ────────────────────────────────────────────────────────────────────────────

export const DimensionEnum = z.enum([
  'seo',
  'ui',
  'performance',
  'a11y',
  'aiReadability',
  'codeQuality',
  'content',
]);
export type Dimension = z.infer<typeof DimensionEnum>;

export const SeverityEnum = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeverityEnum>;

export const GradeEnum = z.enum(['A', 'B', 'C', 'D', 'F']);
export type Grade = z.infer<typeof GradeEnum>;

// ────────────────────────────────────────────────────────────────────────────
// Parser output (internal, before LLM)
// ────────────────────────────────────────────────────────────────────────────

export const MetaTagSchema = z.object({
  name: z.string().optional(),
  property: z.string().optional(),
  content: z.string().optional(),
  httpEquiv: z.string().optional(),
  charset: z.string().optional(),
});
export type MetaTag = z.infer<typeof MetaTagSchema>;

export const LinkTagSchema = z.object({
  rel: z.string().optional(),
  href: z.string().optional(),
  hreflang: z.string().optional(),
  type: z.string().optional(),
  sizes: z.string().optional(),
  as: z.string().optional(),
});
export type LinkTag = z.infer<typeof LinkTagSchema>;

export const SiteHeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
});
export type SiteHeading = z.infer<typeof SiteHeadingSchema>;

export const SiteImageSchema = z.object({
  src: z.string(),
  alt: z.string().nullable(),
  width: z.string().optional(),
  height: z.string().optional(),
  loading: z.string().optional(),
  hasWidthHeight: z.boolean(),
});
export type SiteImage = z.infer<typeof SiteImageSchema>;

export const SideProbeSchema = z.object({
  exists: z.boolean(),
  raw: z.string().optional(),
});
export type SideProbe = z.infer<typeof SideProbeSchema>;

export const RobotsProbeSchema = z.object({
  exists: z.boolean(),
  raw: z.string().optional(),
  allowsAiBots: z.object({
    GPTBot: z.boolean(),
    ClaudeBot: z.boolean(),
    'Claude-Web': z.boolean(),
    PerplexityBot: z.boolean(),
    'Google-Extended': z.boolean(),
  }),
});
export type RobotsProbe = z.infer<typeof RobotsProbeSchema>;

export const SiteDataSchema = z.object({
  // Identity
  url: z.string(),
  finalUrl: z.string(),
  fetchedAt: z.string(),
  statusCode: z.number().int(),
  contentType: z.string(),
  charset: z.string().nullable(),
  htmlSizeBytes: z.number().int(),
  htmlLang: z.string().nullable(),

  // Head
  metaTags: z.array(MetaTagSchema),
  linkTags: z.array(LinkTagSchema),
  hasViewport: z.boolean(),
  hasCharset: z.boolean(),

  // Structure
  headings: z.array(SiteHeadingSchema).max(200),
  images: z.array(SiteImageSchema).max(80),
  internalLinkCount: z.number().int(),
  externalLinkCount: z.number().int(),

  // Resources
  scriptCount: z.number().int(),
  externalScriptHosts: z.array(z.string()).max(20),
  stylesheetCount: z.number().int(),
  fontFamilies: z.array(z.string()).max(20),
  iframeCount: z.number().int(),
  formCount: z.number().int(),
  inputCountWithoutLabel: z.number().int(),
  inlineStyleCount: z.number().int(),
  imagesWithoutAlt: z.number().int(),
  imagesWithoutDims: z.number().int(),

  // Structured data
  jsonLd: z.array(z.any()).max(20),

  // Semantic HTML signals
  hasMain: z.boolean(),
  hasNav: z.boolean(),
  hasHeader: z.boolean(),
  hasFooter: z.boolean(),
  hasArticle: z.boolean(),
  hasAside: z.boolean(),

  // Visible text content (truncated preview for the LLM prompt)
  visibleTextPreview: z.string(),

  // Response headers
  securityHeaders: z.object({
    csp: z.boolean(),
    xFrameOptions: z.boolean(),
    hsts: z.boolean(),
    referrerPolicy: z.boolean(),
    xContentTypeOptions: z.boolean(),
    permissionsPolicy: z.boolean(),
  }),

  // Side probes (parallel HEAD/GET against same origin)
  robotsTxt: RobotsProbeSchema.optional(),
  llmsTxt: SideProbeSchema.optional(),
  sitemapXml: SideProbeSchema.extend({
    urlCount: z.number().int().optional(),
  }).optional(),
});
export type SiteData = z.infer<typeof SiteDataSchema>;

// ────────────────────────────────────────────────────────────────────────────
// LLM output (AuditReport) — what the model must produce
// ────────────────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  id: z.string(),
  dimension: DimensionEnum,
  severity: SeverityEnum,
  title: z.string(),
  evidence: z.string(),
  fix: z.string(),
  /** Pre-built copy-paste prompt for Cursor — generated by the LLM itself. */
  cursorPrompt: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SectionSchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: GradeEnum,
  /** Short (1-2 sentence) prose summary for this dimension. */
  summary: z.string().optional(),
  findings: z.array(FindingSchema).max(15),
});
export type Section = z.infer<typeof SectionSchema>;

export const PriorityFixSchema = z.object({
  findingId: z.string(),
  title: z.string(),
  severity: SeverityEnum,
  dimension: DimensionEnum,
  estimatedImpact: z.enum(['high', 'medium', 'low']),
  cursorPrompt: z.string(),
});
export type PriorityFix = z.infer<typeof PriorityFixSchema>;

export const AuditReportSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  fetchedAt: z.string(),
  durationMs: z.number().int(),
  pageStats: z.object({
    statusCode: z.number().int(),
    redirectChain: z.array(
      z.object({ url: z.string(), status: z.number().int() })
    ),
    htmlSizeBytes: z.number().int(),
    scriptCount: z.number().int(),
    externalScriptHosts: z.array(z.string()),
    stylesheetCount: z.number().int(),
    imageCount: z.number().int(),
    imageAltsMissing: z.number().int(),
    fontsCount: z.number().int(),
    iframeCount: z.number().int(),
    formCount: z.number().int(),
    internalLinks: z.number().int(),
    externalLinks: z.number().int(),
    hasViewport: z.boolean(),
    hasCharset: z.boolean(),
    hasSitemap: z.boolean().optional(),
    hasLlmsTxt: z.boolean().optional(),
    hasRobotsTxt: z.boolean().optional(),
    hasFavicon: z.boolean(),
    securityHeaders: z.record(z.string(), z.boolean()),
    analyticsDetected: z.array(z.string()),
    lang: z.string().nullable(),
  }),
  overall: z.object({
    score: z.number().int().min(0).max(100),
    grade: GradeEnum,
  }),
  /** 2-3 sentence executive summary in the report's locale. */
  summary: z.string(),
  /** 'en' | 'zh' — chosen from the URL / <html lang>. */
  locale: z.enum(['en', 'zh']),
  sections: z.object({
    seo: SectionSchema,
    ui: SectionSchema,
    performance: SectionSchema,
    a11y: SectionSchema,
    aiReadability: SectionSchema,
    /** Null when the user didn't upload source code (v1 default). */
    codeQuality: SectionSchema.nullable(),
    content: SectionSchema,
  }),
  /** Top ≤10 fixes ranked by expected ROI — the user's "what to fix first" list. */
  priorities: z.array(PriorityFixSchema).max(20),
  /** finding.id → full prompt, the same content as finding.cursorPrompt but
   *  indexed for quick lookup when the UI renders a finding card. */
  cursorPrompts: z.record(z.string(), z.string()),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Public site-data shape sent to the LLM (compressed from SiteData)
// ────────────────────────────────────────────────────────────────────────────

/** Trimmed view of SiteData used to build the LLM prompt. */
export type SiteDataForLLM = Pick<
  SiteData,
  | 'url'
  | 'finalUrl'
  | 'statusCode'
  | 'htmlSizeBytes'
  | 'htmlLang'
  | 'hasViewport'
  | 'hasCharset'
  | 'metaTags'
  | 'linkTags'
  | 'headings'
  | 'images'
  | 'internalLinkCount'
  | 'externalLinkCount'
  | 'scriptCount'
  | 'externalScriptHosts'
  | 'stylesheetCount'
  | 'fontFamilies'
  | 'iframeCount'
  | 'formCount'
  | 'inputCountWithoutLabel'
  | 'inlineStyleCount'
  | 'imagesWithoutAlt'
  | 'imagesWithoutDims'
  | 'jsonLd'
  | 'hasMain'
  | 'hasNav'
  | 'hasHeader'
  | 'hasFooter'
  | 'hasArticle'
  | 'hasAside'
  | 'visibleTextPreview'
  | 'securityHeaders'
> & {
  robotsTxt?: RobotsProbe;
  llmsTxt?: SideProbe;
  sitemapXml?: SideProbe & { urlCount?: number };
};
