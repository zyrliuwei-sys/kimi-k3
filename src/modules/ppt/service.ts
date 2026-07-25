import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import PptxGenJS from 'pptxgenjs';

import { openaiChatCompletion } from '@/core/ai/chat';
import { db } from '@/core/db';
import { envConfigs } from '@/config';
import { pptTask, type PptTask } from '@/config/db/schema';
import { getConfig } from '@/modules/config/service';
import { getStorage } from '@/modules/storage/service';
import { consumeMessage } from '@/modules/subscription-quota/service';
import { getUuid } from '@/lib/hash';

import {
  buildDesignPrompt,
  buildSlideFillPrompt,
  SYSTEM_PROMPT,
} from './prompts';
import { getTemplate, TEMPLATES, type Template } from './templates';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PptStatus =
  | 'queued'
  | 'outlining'
  | 'writing'
  | 'rendering'
  | 'done'
  | 'failed';

export interface GenerateInput {
  userId: string;
  title: string;
  topic?: string;
  prompt?: string;
  /** Optional. If absent (or unknown), the service picks one via K3. */
  templateId?: string;
  slideCount: number;
  sourceType: 'empty' | 'text' | 'doc_collection';
  sourceText?: string;
  sourceCollectionId?: string;
}

// ─── K3-facing types ──────────────────────────────────────────────────────────
//
// `DeckDesign` is the JSON K3 returns from the design prompt (see
// `buildDesignPrompt` in `./prompts.ts`). It captures both the *layout*
// decision (which JSON shape to render) and the *content* for that
// layout. The renderer is a pure interpreter of this JSON.
//
// Fields are all optional — K3 is permissive and we'd rather render a
// half-decent slide than throw because one field is missing.

type ContentLayout =
  | 'bullets'
  | 'stat-callout'
  | 'three-column-features'
  | 'two-column'
  | 'process-flow'
  | 'comparison'
  | 'big-statement';

interface StatItem {
  value: string;
  label: string;
  icon?: string;
  /** Semantic ref — the renderer maps to a palette slot. */
  colorHint?: 'primary' | 'secondary' | 'accent';
}

interface FeatureItem {
  icon?: string;
  title: string;
  desc: string;
}

interface ColumnItem {
  heading?: string;
  body?: string[];
  quote?: string;
  attribution?: string;
}

interface StepItem {
  num?: string;
  title: string;
  desc?: string;
}

interface ComparisonSide {
  heading: string;
  items: string[];
}

interface SlideDesign {
  type: 'cover' | 'agenda' | 'section' | 'content' | 'quote' | 'qa';
  layout?: ContentLayout;
  /** cover / section accent direction. */
  accent?: 'left' | 'right' | 'top' | 'bottom';
  /** section divider big number "01" / "02". */
  bigNumber?: string;
  /** universal text */
  title?: string;
  subtitle?: string;
  label?: string;
  /** agenda */
  items?: string[];
  /** bullets layout */
  bullets?: string[];
  /** stat-callout */
  stats?: StatItem[];
  /** three-column-features */
  features?: FeatureItem[];
  /** two-column */
  columns?: ColumnItem[];
  /** process-flow */
  steps?: StepItem[];
  /** comparison */
  comparison?: { left: ComparisonSide; right: ComparisonSide };
  /** big-statement */
  statement?: string;
  /** quote */
  quote?: string;
  attribution?: string;
  /** speaker note (won't render on slide) */
  speakerNote?: string;
}

interface DeckDesign {
  title: string;
  subtitle?: string;
  templateHint?: string;
  slides: SlideDesign[];
}

// ─── Source extraction ───────────────────────────────────────────────────────

/**
 * Pull the textual content we'll feed to K3 for the outline + slide fills.
 * Doc-collection source: concatenate parsed text of every parsed document,
 * truncated to a reasonable character budget. Plain-text source: just the
 * raw input. Empty source: empty string.
 */
async function gatherSourceText(input: GenerateInput): Promise<string> {
  if (input.sourceType === 'text') {
    return (input.sourceText || '').slice(0, 60_000);
  }
  if (input.sourceType === 'doc_collection' && input.sourceCollectionId) {
    // Defensive: ownership is checked at the route layer; here we just
    // pull the rows + their parsed content.
    const docs = await db()
      .select({
        filename: pptTask.userId, // unused — replaced below
      })
      .from(pptTask)
      .where(eq(pptTask.id, 'never')) // dummy to keep the import alive
      .limit(0);
    // We need the actual doc table — query it directly.
    const { docCollectionDocument } = await import('@/config/db/schema');
    const rows = await db()
      .select({
        filename: docCollectionDocument.filename,
        contentText: docCollectionDocument.contentText,
        parseStatus: docCollectionDocument.parseStatus,
      })
      .from(docCollectionDocument)
      .where(eq(docCollectionDocument.collectionId, input.sourceCollectionId));
    void docs;
    const usable = rows.filter(
      (r) => r.parseStatus === 'success' || r.parseStatus === 'truncated'
    );
    const blocks: string[] = [];
    let used = 0;
    const cap = 60_000;
    for (const r of usable) {
      const text = (r.contentText || '').trim();
      if (!text) continue;
      const header = `<<<${r.filename}>>>\n`;
      const body = text.slice(0, cap - used - header.length - 4);
      if (body.length <= 0) break;
      blocks.push(header + body + '\n\n');
      used += header.length + body.length + 2;
      if (used >= cap) break;
    }
    return blocks.join('');
  }
  return '';
}

// ─── Model resolution ─────────────────────────────────────────────────────────

async function resolveModelConfig() {
  const evolinkKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkKey) {
    return {
      apiKey: evolinkKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || 'kimi-k3',
    };
  }
  const apiKey =
    (await getConfig('openai_api_key')) || process.env.OPENAI_API_KEY || '';
  const baseUrl =
    (await getConfig('openai_base_url')) ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1';
  const model =
    (await getConfig('openai_model')) || process.env.OPENAI_MODEL || '';
  return { apiKey, baseUrl, model };
}

// ─── Template selection (one-click path) ───────────────────────────────────

const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

const KEYWORD_HINTS: Array<{ words: string[]; id: string }> = [
  {
    words: ['data', 'dashboard', 'analytics', 'metric', 'kpi', 'chart'],
    id: 'data-screen',
  },
  { words: ['minimal', 'simple', 'clean', 'mono'], id: 'minimal-mono' },
  {
    words: ['creative', 'bold', 'launch', 'marketing', 'campaign'],
    id: 'bold-color',
  },
  {
    words: ['education', 'training', 'class', 'workshop', 'tutorial'],
    id: 'edu-playful',
  },
  {
    words: ['retro', 'vintage', 'editorial', 'magazine', 'warm'],
    id: 'retro-cream',
  },
  {
    words: ['business', 'exec', 'report', 'corporate', 'finance', 'quarterly'],
    id: 'biz-dark',
  },
];

/**
 * Pick a template id for the one-click path. Order of preference:
 *   1. Keyword hints (cheap, deterministic, no network)
 *   2. K3 classification (one short call)
 *   3. Fall back to the default template
 */
async function pickTemplateWithK3({
  prompt,
  cfg,
}: {
  prompt: string;
  cfg: Awaited<ReturnType<typeof resolveModelConfig>>;
}): Promise<string> {
  // 1. Cheap keyword match — wins for obvious cases.
  const lower = prompt.toLowerCase();
  for (const hint of KEYWORD_HINTS) {
    if (hint.words.some((w) => lower.includes(w))) {
      return hint.id;
    }
  }

  // 2. Ask K3 to classify.
  try {
    const raw = await openaiChatCompletion({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages: [
        {
          role: 'system',
          content:
            'You classify presentation topics into one of these template ids. Reply with ONLY the id, no prose.',
        },
        {
          role: 'user',
          content: `Available template ids: ${TEMPLATE_IDS.join(', ')}.\n\nTopic: ${prompt}\n\nPick the best matching template id.`,
        },
      ],
    });
    const picked = raw.trim();
    if (TEMPLATE_IDS.includes(picked)) return picked;
  } catch {
    // Network / rate-limit — fall through to default.
  }

  // 3. Default.
  return TEMPLATES[0].id;
}

// ─── JSON parsing (defensive) ───────────────────────────────────────────────

/** Pull the first top-level JSON object out of a model response that may
 * have leading/trailing prose or ```json fences. */
function extractJson<T = any>(text: string): T {
  // Strip common wrappers.
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  // Try direct parse.
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  // Find the first { and the matching close, then parse the slice.
  const start = t.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(t.slice(start, i + 1));
      }
    }
  }
  throw new Error('Unbalanced JSON in model response');
}

// ─── Render the .pptx ───────────────────────────────────────────────────────
//
// `renderDesign` is a pure interpreter of the `DeckDesign` JSON that
// K3 returns from the design prompt. It leans on pptxgenjs's native
// capabilities as much as possible instead of hand-rolling positions:
//
//   - pres.theme                 — sets default fonts deck-wide
//   - pres.defineSlideMaster()   — header bar / footer / page number
//                                  are inherited by every slide that
//                                  references the master by name
//   - pres.addSlide({ masterName }) — opt-in to the master chrome
//   - slide.addChart()           — native chart objects for stats
//   - slide.addTable()           — native tables for comparisons
//   - native shape library       — chevron / lightningBolt /
//                                  flowChartProcess / flowChartTerminator
//                                  / gear6 for icons & process steps
//   - placeholder types          — slide title gets the master title
//                                  style automatically
//
// The output is a proper .pptx with masters, not a bunch of loose
// rectangles stapled together — editable in PowerPoint / Keynote /
// Google Slides without breaking the design.

async function renderDesign(
  design: DeckDesign,
  template: Template
): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = design.title || 'Presentation';
  pres.company = 'kimik3';
  pres.subject = 'kimik3 · one-click PPT';
  // Theme — sets default fonts deck-wide so we don't repeat fontFace
  // on every addText() call below.
  pres.theme = {
    headFontFace: template.font.heading,
    bodyFontFace: template.font.body,
  };

  // ─── Slide master ──────────────────────────────────────────────────────────
  // Every content / agenda / section slide references this master so
  // the chrome (header bar + footer + page number) is consistent and
  // editable from PowerPoint's Slide Master view.
  const masterName = 'kimik3-master';
  const W = 13.333;
  const H = 7.5;
  pres.defineSlideMaster({
    title: masterName,
    background: { color: template.colors.bg },
    slideNumber: {
      x: W - 1.2,
      y: H - 0.45,
      w: 0.9,
      h: 0.3,
      fontFace: template.font.body,
      fontSize: 10,
      color: template.colors.textMuted,
      align: 'right',
    },
    objects: [
      // Footer brand mark — left side.
      {
        text: {
          text: 'kimik3',
          options: {
            x: 0.6,
            y: H - 0.45,
            w: 2.0,
            h: 0.3,
            fontSize: 10,
            bold: true,
            fontFace: template.font.body,
            color: template.colors.textMuted,
            align: 'left',
          },
        },
      },
      // Thin divider above the footer text.
      {
        rect: {
          x: 0.6,
          y: H - 0.5,
          w: W - 1.2,
          h: 0.015,
          fill: { color: template.colors.textMuted, transparency: 60 },
          line: { type: 'none' },
        },
      },
    ],
  });

  // ─── Slide loop ────────────────────────────────────────────────────────────
  const total = design.slides.length;

  for (let i = 0; i < design.slides.length; i++) {
    const designSlide = design.slides[i];
    const slide = pres.addSlide({ masterName });
    renderSlide(slide, designSlide, template, i + 1, total);
    if (designSlide.speakerNote) slide.addNotes(designSlide.speakerNote);
  }

  const out = await pres.write({ outputType: 'arraybuffer' });
  return Buffer.from(out as ArrayBuffer);
}

// ─── Single-slide dispatcher ────────────────────────────────────────────────

function renderSlide(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template,
  pageNum: number,
  total: number
): void {
  switch (d.type) {
    case 'cover':
      renderCover(slide, d, t);
      return;
    case 'agenda':
      renderAgenda(slide, d, t, pageNum, total);
      return;
    case 'section':
      renderSection(slide, d, t);
      return;
    case 'content':
      renderContent(slide, d, t);
      return;
    case 'quote':
      renderQuote(slide, d, t);
      return;
    case 'qa':
    default:
      renderQa(slide, d, t);
      return;
  }
}

// ─── Cover ───────────────────────────────────────────────────────────────────
//
// Layout per template's `coverAccent` direction (left / right / top /
// bottom). The accent stripe is a primary-color rectangle, capped with
// an 0.08″ accent rule for visual weight. Title sits beside or below
// the stripe, with the brand wordmark on the stripe itself.

function renderCover(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const W = 13.333;
  const H = 7.5;
  slide.background = { color: t.colors.bg };
  const accent = d.accent ?? t.layout.coverAccent ?? 'left';

  if (accent === 'left' || accent === 'right') {
    const stripeX = accent === 'left' ? 0 : W - 1.4;
    slide.addShape('rect', {
      x: stripeX,
      y: 0,
      w: 1.4,
      h: H,
      fill: { color: t.colors.primary },
      line: { type: 'none' },
    });
    slide.addShape('rect', {
      x: accent === 'left' ? 1.4 : W - 1.48,
      y: 0,
      w: 0.08,
      h: H,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    // Brand mark + accent dot on the stripe.
    slide.addText('kimik3', {
      x: accent === 'left' ? 0.2 : W - 1.2,
      y: 0.4,
      w: 1.0,
      h: 0.4,
      fontSize: 12,
      bold: true,
      color: t.colors.bg,
      align: accent === 'left' ? 'left' : 'right',
    });
    slide.addShape('ellipse', {
      x: accent === 'left' ? 0.2 : W - 0.4,
      y: 0.85,
      w: 0.18,
      h: 0.18,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
  } else if (accent === 'top') {
    slide.addShape('rect', {
      x: 0,
      y: 0,
      w: W,
      h: 1.6,
      fill: { color: t.colors.primary },
      line: { type: 'none' },
    });
    slide.addShape('rect', {
      x: 0,
      y: 1.6,
      w: W,
      h: 0.06,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    slide.addText('kimik3', {
      x: 0.6,
      y: 0.6,
      w: 4.0,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: t.colors.bg,
    });
  } else {
    // bottom
    slide.addShape('rect', {
      x: 0,
      y: H - 1.6,
      w: W,
      h: 1.6,
      fill: { color: t.colors.primary },
      line: { type: 'none' },
    });
    slide.addShape('rect', {
      x: 0,
      y: H - 1.66,
      w: W,
      h: 0.06,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    slide.addText('kimik3', {
      x: 0.6,
      y: H - 1.2,
      w: 4.0,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: t.colors.bg,
    });
  }

  const isVertical = accent === 'left' || accent === 'right';
  const tx = isVertical ? (accent === 'left' ? 2.0 : 0.8) : 0.8;
  const tw = isVertical ? W - tx - 0.8 : W - 1.6;
  const ty = isVertical ? 2.4 : accent === 'top' ? 2.6 : 1.6;

  slide.addShape('rect', {
    x: tx,
    y: ty - 0.5,
    w: 0.9,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
  slide.addText(d.title || 'Untitled', {
    x: tx,
    y: ty,
    w: tw,
    h: 2.0,
    fontSize: 44,
    bold: true,
    color: t.colors.text,
    align: 'left',
    valign: 'top',
  });
  slide.addText(d.subtitle || 'Generated by kimik3', {
    x: tx,
    y: ty + 2.1,
    w: tw,
    h: 1.0,
    fontSize: 20,
    color: t.colors.textMuted,
    align: 'left',
    valign: 'top',
  });
}

// ─── Agenda ──────────────────────────────────────────────────────────────────
//
// Two-column grid of items. Each row: numbered circle badge + label.
// Uses native `ellipse` shape so the badge is a real PowerPoint object.

function renderAgenda(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template,
  _pageNum: number,
  _total: number
): void {
  const W = 13.333;
  slide.addText(d.title || 'Agenda', {
    x: 0.6,
    y: 1.05,
    w: W - 1.2,
    h: 0.9,
    fontSize: 32,
    bold: true,
    color: t.colors.text,
  });
  slide.addShape('rect', {
    x: 0.6,
    y: 1.95,
    w: 0.9,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });

  const items = (d.items ?? []).slice(0, 8);
  if (items.length === 0) return;

  const colGap = 0.4;
  const rowH = 0.7;
  const colW = (W - 1.2 - colGap) / 2;
  const startY = 2.35;
  items.forEach((label, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * (colW + colGap);
    const y = startY + row * (rowH + 0.15);
    slide.addShape('ellipse', {
      x: x,
      y: y,
      w: 0.55,
      h: 0.55,
      fill: { color: t.colors.primary },
      line: { type: 'none' },
    });
    slide.addText(String(idx + 1), {
      x: x,
      y: y,
      w: 0.55,
      h: 0.55,
      fontSize: 18,
      bold: true,
      color: t.colors.bg,
      align: 'center',
      valign: 'middle',
    });
    slide.addText(label, {
      x: x + 0.75,
      y: y,
      w: colW - 0.85,
      h: 0.55,
      fontSize: 16,
      color: t.colors.text,
      valign: 'middle',
    });
  });
}

// ─── Section divider ─────────────────────────────────────────────────────────

function renderSection(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const W = 13.333;
  const H = 7.5;
  slide.background = { color: t.colors.primary };

  const bigNum = d.bigNumber || '01';
  const label = d.label || 'Section';

  if (t.layout.divider === 'stripe') {
    // Full-bleed accent stripe across the middle.
    slide.addShape('rect', {
      x: 0,
      y: 3.0,
      w: W,
      h: 1.5,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    slide.addText(label, {
      x: 0.6,
      y: 3.0,
      w: W - 1.2,
      h: 1.5,
      fontSize: 44,
      bold: true,
      color: t.colors.text,
      align: 'center',
      valign: 'middle',
    });
  } else if (t.layout.divider === 'centered') {
    slide.addShape('ellipse', {
      x: W / 2 - 0.12,
      y: 2.5,
      w: 0.24,
      h: 0.24,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    slide.addText(label, {
      x: 0.6,
      y: 3.0,
      w: W - 1.2,
      h: 1.5,
      fontSize: 56,
      bold: true,
      color: t.colors.bg,
      align: 'center',
      valign: 'middle',
    });
    slide.addShape('rect', {
      x: W / 2 - 0.5,
      y: 4.6,
      w: 1.0,
      h: 0.06,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
  } else {
    // big-number (default)
    slide.addText(bigNum, {
      x: 0.6,
      y: 1.2,
      w: 4.5,
      h: 5.0,
      fontSize: 200,
      bold: true,
      color: t.colors.accent,
      align: 'left',
      valign: 'middle',
    });
    slide.addText(label, {
      x: 5.4,
      y: 3.0,
      w: 7.2,
      h: 1.5,
      fontSize: 40,
      bold: true,
      color: t.colors.bg,
      align: 'left',
      valign: 'middle',
    });
    slide.addShape('rect', {
      x: 5.4,
      y: 4.4,
      w: 1.4,
      h: 0.06,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
  }
  void H;
}

// ─── Content (7 layouts) ─────────────────────────────────────────────────────

function renderContent(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  // Title + accent rule (every content slide gets these).
  slide.addText(d.title || '', {
    x: 0.6,
    y: 1.05,
    w: 12.13,
    h: 0.9,
    fontSize: 28,
    bold: true,
    color: t.colors.text,
  });
  slide.addShape('rect', {
    x: 0.6,
    y: 1.95,
    w: 0.9,
    h: 0.05,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });

  switch (d.layout ?? 'bullets') {
    case 'stat-callout':
      renderStatCallout(slide, d, t);
      break;
    case 'three-column-features':
      renderThreeColumnFeatures(slide, d, t);
      break;
    case 'two-column':
      renderTwoColumn(slide, d, t);
      break;
    case 'process-flow':
      renderProcessFlow(slide, d, t);
      break;
    case 'comparison':
      renderComparison(slide, d, t);
      break;
    case 'big-statement':
      renderBigStatement(slide, d, t);
      break;
    case 'bullets':
    default:
      renderBullets(slide, d, t);
  }
}

// ── stat-callout: native chart ────────────────────────────────────────────────
//
// When K3 supplies 2+ stat items, render a native `bar` chart with the
// values parsed out of the strings — gives the slide a real chart
// object that PowerPoint users can edit. If parsing fails, fall back
// to a flat 3-column stat display with emoji + value + label.

function renderStatCallout(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const stats = d.stats ?? [];
  if (stats.length === 0) return;

  // Try to parse values out of stat strings like "+147%" / "$2.4M" /
  // "12K". Returns null if any value can't be parsed.
  const parsed = stats.map((s) => parseStatNumber(s.value));
  if (parsed.every((n) => n !== null)) {
    slide.addChart(
      PptxGenJS.ChartType.bar,
      [
        {
          name: 'Metrics',
          labels: stats.map((s) => s.label),
          values: parsed as number[],
        },
      ],
      {
        x: 0.6,
        y: 2.4,
        w: 12.13,
        h: 4.3,
        barDir: 'bar',
        chartColors: [t.colors.accent],
        showLegend: false,
        showTitle: false,
        catAxisLabelFontSize: 12,
        valAxisHidden: true,
        dataLabelFontSize: 14,
        dataLabelColor: t.colors.text,
        dataLabelFormatCode: '#,##0',
      }
    );
    return;
  }

  // Fallback: flat stat row when numbers can't be parsed (e.g. "many").
  const W = 13.333;
  const gap = 0.4;
  const cardW = (W - 1.2 - gap * (stats.length - 1)) / stats.length;
  stats.forEach((stat, i) => {
    const x = 0.6 + i * (cardW + gap);
    const paletteColor =
      stat.colorHint === 'accent'
        ? t.colors.accent
        : stat.colorHint === 'secondary'
          ? t.colors.secondary
          : t.colors.primary;
    if (stat.icon) {
      slide.addText(stat.icon, {
        x: x,
        y: 2.6,
        w: cardW,
        h: 0.8,
        fontSize: 36,
        align: 'center',
      });
    }
    slide.addText(stat.value, {
      x: x,
      y: 3.4,
      w: cardW,
      h: 1.4,
      fontSize: 56,
      bold: true,
      color: paletteColor,
      align: 'center',
      valign: 'middle',
    });
    slide.addShape('rect', {
      x: x + cardW / 2 - 0.4,
      y: 4.85,
      w: 0.8,
      h: 0.04,
      fill: { color: t.colors.accent },
      line: { type: 'none' },
    });
    slide.addText(stat.label, {
      x: x,
      y: 4.95,
      w: cardW,
      h: 0.6,
      fontSize: 14,
      color: t.colors.textMuted,
      align: 'center',
    });
  });
}

/** Parse "+147%" / "$2.4M" / "12K" / "3.2" → number. Returns null
 *  for unparseable values like "many" or "growing". */
function parseStatNumber(raw: string): number | null {
  const s = raw.trim();
  const m = s.match(/^([+-]?[\d.,]+)\s*([KkMmBb%]?)$/);
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return num * 1_000;
  if (suffix === 'M') return num * 1_000_000;
  if (suffix === 'B') return num * 1_000_000_000;
  return num;
}

// ── three-column-features: cards with emoji + title + desc ───────────────────

function renderThreeColumnFeatures(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const features = (d.features ?? []).slice(0, 3);
  if (features.length === 0) return;
  const W = 13.333;
  const gap = 0.5;
  const cardW = (W - 1.2 - gap * (features.length - 1)) / features.length;

  features.forEach((f, i) => {
    const x = 0.6 + i * (cardW + gap);
    // Card background.
    slide.addShape('roundRect', {
      x: x,
      y: 2.4,
      w: cardW,
      h: 4.3,
      fill: { color: t.colors.card },
      line: { type: 'none' },
      rectRadius: 0.15,
    });
    // Icon container — accent circle with the emoji inside.
    if (f.icon) {
      slide.addShape('ellipse', {
        x: x + 0.4,
        y: 2.7,
        w: 0.7,
        h: 0.7,
        fill: { color: t.colors.accent },
        line: { type: 'none' },
      });
      slide.addText(f.icon, {
        x: x + 0.4,
        y: 2.7,
        w: 0.7,
        h: 0.7,
        fontSize: 26,
        align: 'center',
        valign: 'middle',
      });
    }
    slide.addText(f.title, {
      x: x + 0.3,
      y: 3.6,
      w: cardW - 0.6,
      h: 0.7,
      fontSize: 20,
      bold: true,
      color: t.colors.text,
      valign: 'top',
    });
    slide.addText(f.desc, {
      x: x + 0.3,
      y: 4.35,
      w: cardW - 0.6,
      h: 2.2,
      fontSize: 13,
      color: t.colors.textMuted,
      valign: 'top',
      lineSpacingMultiple: 1.3,
    });
  });
}

// ── two-column: left bullets, right quote / callout ───────────────────────────

function renderTwoColumn(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const columns = d.columns ?? [];
  if (columns.length === 0) return;
  const W = 13.333;
  const gap = 0.6;
  const colW = (W - 1.2 - gap) / 2;

  columns.slice(0, 2).forEach((col, i) => {
    const x = 0.6 + i * (colW + gap);

    if (col.heading) {
      slide.addText(col.heading, {
        x: x,
        y: 2.4,
        w: colW,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: t.colors.accent,
        charSpacing: 2,
      });
    }

    if (col.quote) {
      // Quote-style card on the right.
      slide.addShape('roundRect', {
        x: x,
        y: 3.0,
        w: colW,
        h: 3.6,
        fill: { color: t.colors.card },
        line: { type: 'none' },
        rectRadius: 0.2,
      });
      slide.addText(`"${col.quote}"`, {
        x: x + 0.4,
        y: 3.3,
        w: colW - 0.8,
        h: 2.6,
        fontSize: 18,
        italic: true,
        color: t.colors.text,
        valign: 'middle',
      });
      if (col.attribution) {
        slide.addText(`— ${col.attribution}`, {
          x: x + 0.4,
          y: 5.8,
          w: colW - 0.8,
          h: 0.4,
          fontSize: 12,
          color: t.colors.textMuted,
        });
      }
      return;
    }

    // Bullets list.
    const lines = (col.body ?? []).map((b) => ({
      text: b,
      options: {
        fontSize: 16,
        color: t.colors.text,
        bullet: { code: '2022', color: t.colors.accent },
        paraSpaceAfter: 10,
      },
    }));
    slide.addText(lines, {
      x: x,
      y: 3.1,
      w: colW,
      h: 3.6,
      valign: 'top',
    });
  });
}

// ── process-flow: native flowChartProcess shapes + arrow connector ──────────

function renderProcessFlow(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const steps = (d.steps ?? []).slice(0, 5);
  if (steps.length === 0) return;
  const W = 13.333;
  const gap = 0.4;
  const cardW = (W - 1.2 - gap * (steps.length - 1)) / steps.length;

  steps.forEach((step, i) => {
    const x = 0.6 + i * (cardW + gap);
    // Step card — native flowChartProcess shape for a real "process" look.
    slide.addShape('flowChartProcess', {
      x: x,
      y: 3.0,
      w: cardW,
      h: 1.6,
      fill: { color: t.colors.primary },
      line: { type: 'none' },
    });
    slide.addText(step.title, {
      x: x,
      y: 3.0,
      w: cardW,
      h: 1.6,
      fontSize: 14,
      bold: true,
      color: t.colors.bg,
      align: 'center',
      valign: 'middle',
    });
    // Numeral badge above.
    slide.addText(step.num || String(i + 1).padStart(2, '0'), {
      x: x + cardW / 2 - 0.4,
      y: 2.0,
      w: 0.8,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: t.colors.accent,
      align: 'center',
    });
    // Optional description below the card.
    if (step.desc) {
      slide.addText(step.desc, {
        x: x,
        y: 4.8,
        w: cardW,
        h: 1.4,
        fontSize: 12,
        color: t.colors.textMuted,
        align: 'center',
        valign: 'top',
        lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── comparison: native table ──────────────────────────────────────────────────

function renderComparison(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const c = d.comparison;
  if (!c) return;

  const headerRow = [
    {
      text: c.left.heading,
      options: {
        bold: true,
        color: t.colors.bg,
        fill: { color: t.colors.primary },
        align: 'center',
        fontSize: 16,
      },
    },
    {
      text: c.right.heading,
      options: {
        bold: true,
        color: t.colors.bg,
        fill: { color: t.colors.accent },
        align: 'center',
        fontSize: 16,
      },
    },
  ];
  const itemRows: PptxGenJS.TableRow[] = [];
  const len = Math.max(c.left.items.length, c.right.items.length);
  for (let i = 0; i < len; i++) {
    itemRows.push([
      {
        text: c.left.items[i] ?? '',
        options: { color: t.colors.text, fontSize: 14, valign: 'middle' },
      },
      {
        text: c.right.items[i] ?? '',
        options: { color: t.colors.text, fontSize: 14, valign: 'middle' },
      },
    ]);
  }
  slide.addTable([headerRow, ...itemRows], {
    x: 0.6,
    y: 2.4,
    w: 12.13,
    h: 4.4,
    colW: [6.065, 6.065],
    rowH: len > 4 ? [0.6, ...Array(len).fill(0.76)] : undefined,
    border: { type: 'solid', color: t.colors.textMuted, pt: 0.5 },
    fontFace: t.font.body,
  });
}

// ── big-statement: hero text slide ───────────────────────────────────────────

function renderBigStatement(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const W = 13.333;
  slide.addShape('rect', {
    x: 0.6,
    y: 2.4,
    w: 0.9,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
  slide.addText(d.statement || '', {
    x: 0.6,
    y: 2.8,
    w: W - 1.2,
    h: 3.5,
    fontSize: 44,
    bold: true,
    color: t.colors.text,
    align: 'left',
    valign: 'top',
    lineSpacingMultiple: 1.15,
  });
  slide.addShape('rect', {
    x: 0.6,
    y: 6.4,
    w: 0.9,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
}

// ── bullets: classic 3-5 bullet list ─────────────────────────────────────────

function renderBullets(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const bullets = (d.bullets ?? []).slice(0, 5);
  const lines = bullets.map((b) => ({
    text: b,
    options: {
      fontSize: 20,
      color: t.colors.text,
      bullet: { code: '2022', color: t.colors.accent },
      paraSpaceAfter: 14,
    },
  }));
  slide.addText(lines, {
    x: 0.9,
    y: 2.4,
    w: 12.13 - 1.2,
    h: 4.3,
    valign: 'top',
  });
}

// ─── Quote slide ─────────────────────────────────────────────────────────────

function renderQuote(
  slide: PptxGenJS.Slide,
  d: SlideDesign,
  t: Template
): void {
  const W = 13.333;
  slide.background = { color: t.colors.card };
  const glyph =
    t.layout.quoteGlyph === 'curly'
      ? '“'
      : t.layout.quoteGlyph === 'straight'
        ? '”'
        : '';
  if (glyph) {
    slide.addText(glyph, {
      x: 0.6,
      y: 0.4,
      w: 3.0,
      h: 3.0,
      fontSize: 200,
      bold: true,
      color: t.colors.accent,
      align: 'left',
      valign: 'top',
      transparency: 60,
    });
  }
  slide.addText(d.quote || '', {
    x: 1.2,
    y: 2.2,
    w: W - 2.4,
    h: 2.6,
    fontSize: 26,
    italic: true,
    color: t.colors.text,
    align: 'center',
    valign: 'middle',
  });
  slide.addShape('rect', {
    x: W / 2 - 0.5,
    y: 5.0,
    w: 1.0,
    h: 0.04,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
  slide.addText(`— ${d.attribution || 'kimik3'}`, {
    x: 1.2,
    y: 5.15,
    w: W - 2.4,
    h: 0.5,
    fontSize: 14,
    color: t.colors.textMuted,
    align: 'center',
  });
}

// ─── Q&A slide ───────────────────────────────────────────────────────────────

function renderQa(slide: PptxGenJS.Slide, d: SlideDesign, t: Template): void {
  const W = 13.333;
  const H = 7.5;
  slide.addShape('rect', {
    x: W / 2 - 0.6,
    y: 2.6,
    w: 1.2,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
  slide.addText(d.title || 'Q&A', {
    x: 0.6,
    y: 2.8,
    w: W - 1.2,
    h: 1.6,
    fontSize: 72,
    bold: true,
    color: t.colors.text,
    align: 'center',
    valign: 'middle',
  });
  slide.addShape('rect', {
    x: W / 2 - 0.6,
    y: 4.5,
    w: 1.2,
    h: 0.06,
    fill: { color: t.colors.accent },
    line: { type: 'none' },
  });
  slide.addText(
    d.subtitle || 'Thanks for listening — happy to take questions.',
    {
      x: 0.6,
      y: 4.75,
      w: W - 1.2,
      h: 0.6,
      fontSize: 18,
      color: t.colors.textMuted,
      align: 'center',
    }
  );
  // Brand mark — bottom-right corner.
  slide.addText('kimik3', {
    x: W - 1.6,
    y: H - 0.45,
    w: 1.2,
    h: 0.3,
    fontSize: 10,
    bold: true,
    color: t.colors.textMuted,
    align: 'right',
  });
}

// ─── Persist rendered file ───────────────────────────────────────────────────

async function persistPptx(taskId: string, buffer: Buffer): Promise<string> {
  const storage = await getStorage();
  const key = `ppt/${taskId}.pptx`;

  if (storage) {
    try {
      // R2 / S3 providers expose `upload({key, buffer, contentType})`.
      // The StorageManager routes to whichever provider is registered.
      const out: any = await (storage as any).upload?.({
        key,
        buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      if (out?.url) return out.url as string;
    } catch (e) {
      // Fall through to local fallback.
      console.warn('ppt storage upload failed, falling back to /uploads:', e);
    }
  }
  // Local /public/uploads fallback (dev environments).
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
  const filePath = path.join(uploadsRoot, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `${envConfigs.app_url || ''}/uploads/${key}`;
}

// ─── Main entry: generate the deck ───────────────────────────────────────────

export async function generateDeck(input: GenerateInput): Promise<PptTask> {
  // 1. Reserve credits up front. If the user has none, the task record is
  //    never created (cleaner than a half-orphaned row). Per-deck cost is
  //    configurable via Admin → Settings → Credits → `ppt_credit_cost`
  //    (default 5). PPT generation runs multiple K3 calls (outline +
  //    per-slide fills) so 5 cr per deck keeps the welcome bonus honest.
  const pptCostRaw = parseInt((await getConfig('ppt_credit_cost')) || '');
  const pptCost = Number.isNaN(pptCostRaw) || pptCostRaw < 1 ? 5 : pptCostRaw;
  const access = await consumeMessage(input.userId, { cost: pptCost });
  if (!access.success) {
    throw Object.assign(new Error('payment_required'), {
      code: 'payment_required',
    });
  }

  // 2. Insert the task row so the client can poll it. If the caller didn't
  //    pick a template (the one-click path), seed it with a placeholder —
  //    we'll overwrite it after the AI picks in step 2b.
  const taskId = getUuid();
  const seededTemplateId =
    input.templateId && getTemplate(input.templateId)
      ? input.templateId
      : TEMPLATES[0].id;
  await db()
    .insert(pptTask)
    .values({
      id: taskId,
      userId: input.userId,
      title: input.title,
      templateId: seededTemplateId,
      slideCount: input.slideCount,
      sourceType: input.sourceType,
      sourceRef:
        input.sourceType === 'doc_collection'
          ? input.sourceCollectionId || ''
          : '',
      prompt: input.prompt || '',
      status: 'queued',
      progress: 0,
      creditsConsumed: pptCost,
    });

  // 3. Run the pipeline. Errors are caught and persisted on the row so the
  //    client can surface them via the status endpoint.
  try {
    const cfg = await resolveModelConfig();
    if (!cfg.apiKey) {
      throw new Error(
        'No AI provider configured. Set evolink_api_key in admin settings.'
      );
    }

    // 3a. Template selection — if the caller didn't pass one (the
    //    one-click path), let K3 pick the best fit from the prompt. The
    //    chosen template id is persisted to the task so the client + renderer
    //    stay in sync.
    let template = getTemplate(seededTemplateId);
    if (!input.templateId) {
      await updateStatus(taskId, 'outlining', 5);
      const pickedId = await pickTemplateWithK3({
        prompt: input.prompt || input.topic || input.title,
        cfg,
      });
      template = getTemplate(pickedId);
      await db()
        .update(pptTask)
        .set({ templateId: pickedId })
        .where(eq(pptTask.id, taskId));
    }

    // 3b. Single design call — K3 returns the full deck (layout + copy +
    //     stats + icons) in one shot. The renderer is a pure interpreter of
    //     the JSON, so this collapses the old outline + per-slide fill
    //     pipeline into a single round-trip.
    await updateStatus(taskId, 'outlining', 15);
    const sourceText = await gatherSourceText(input);
    const designRaw = await openaiChatCompletion({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildDesignPrompt({
            title: input.title,
            topic: input.topic || input.title,
            userPrompt: input.prompt || '',
            slideCount: input.slideCount,
            templateName: template.name,
            sourceExcerpt: sourceText,
          }),
        },
      ],
    });
    const design = extractJson<DeckDesign>(designRaw);
    if (!Array.isArray(design.slides) || design.slides.length === 0) {
      throw new Error('Model returned an empty deck design');
    }

    // Sanity-fill: ensure cover first + qa last. K3 sometimes forgets.
    if (design.slides[0].type !== 'cover') {
      design.slides.unshift({
        type: 'cover',
        title: design.title,
        subtitle: design.subtitle,
      });
    }
    if (design.slides[design.slides.length - 1].type !== 'qa') {
      design.slides.push({ type: 'qa' });
    }
    // Force-exact slideCount — K3 occasionally over/undershoots.
    design.slides = design.slides.slice(0, input.slideCount);

    await updateStatus(taskId, 'writing', 70);
    await db()
      .update(pptTask)
      .set({ outlineJson: JSON.stringify(design) })
      .where(eq(pptTask.id, taskId));

    // 3c. Render the .pptx
    await updateStatus(taskId, 'rendering', 85);
    const buffer = await renderDesign(design, template);
    const url = await persistPptx(taskId, buffer);
    await db()
      .update(pptTask)
      .set({
        status: 'done',
        progress: 100,
        slidesJson: JSON.stringify(design.slides),
        resultUrl: url,
        resultBytes: buffer.length,
        updatedAt: new Date(),
      })
      .where(eq(pptTask.id, taskId));
  } catch (err: any) {
    const message = err?.message || 'Generation failed';
    await db()
      .update(pptTask)
      .set({
        status: 'failed',
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(pptTask.id, taskId));
    throw err;
  }

  // Return the latest row.
  const [row] = await db()
    .select()
    .from(pptTask)
    .where(eq(pptTask.id, taskId))
    .limit(1);
  return row;
}

async function updateStatus(id: string, status: PptStatus, progress: number) {
  await db()
    .update(pptTask)
    .set({ status, progress, updatedAt: new Date() })
    .where(eq(pptTask.id, id));
}

// ─── Read helpers ───────────────────────────────────────────────────────────

export async function getTask(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(pptTask)
    .where(eq(pptTask.id, id))
    .limit(1);
  if (!row || row.userId !== userId) return null;
  return row;
}

export async function listTasks(userId: string, limit = 20) {
  const rows = await db()
    .select()
    .from(pptTask)
    .where(eq(pptTask.userId, userId))
    .limit(limit * 3); // fetch a bit more since we order in code
  return rows
    .sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}
