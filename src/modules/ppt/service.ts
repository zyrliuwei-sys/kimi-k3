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
  buildOutlinePrompt,
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

// Loose shape for what K3 returns — we keep it permissive on purpose and
// validate at render time. The renderer is defensive about missing fields.
interface OutlineSlide {
  index: number;
  type: 'cover' | 'agenda' | 'section' | 'content' | 'quote' | 'qa';
  title?: string;
  subtitle?: string;
  label?: string;
  items?: string[];
  bullets?: string[];
  quote?: string;
  attribution?: string;
}

interface OutlineResponse {
  title: string;
  subtitle?: string;
  slides: OutlineSlide[];
}

interface SlideContent {
  title?: string;
  subtitle?: string;
  label?: string;
  items?: string[];
  bullets?: string[];
  quote?: string;
  attribution?: string;
  speaker_note?: string;
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

async function renderPptx(
  outline: OutlineResponse,
  filled: Array<{ slide: OutlineSlide; content: SlideContent }>,
  template: Template
): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = outline.title || 'Presentation';
  pres.company = 'kimik3';
  pres.theme = {
    headFontFace: template.font.heading,
    bodyFontFace: template.font.body,
  };

  for (let i = 0; i < outline.slides.length; i++) {
    const slide = outline.slides[i];
    const content = filled[i]?.content ?? {};
    switch (slide.type) {
      case 'cover': {
        const s = pres.addSlide();
        s.background = { color: template.colors.bg };
        if (template.showHeaderBar) {
          s.addShape('rect', {
            x: 0,
            y: 0,
            w: 13.33,
            h: 0.6,
            fill: { color: template.colors.primary },
            line: { type: 'none' },
          });
        }
        s.addText(content.title || outline.title || 'Untitled', {
          x: 0.6,
          y: 2.4,
          w: 12.13,
          h: 1.6,
          fontSize: 44,
          fontFace: template.font.heading,
          color: template.colors.text,
          bold: true,
          align: 'left',
        });
        s.addText(
          content.subtitle || outline.subtitle || 'Generated by kimik3',
          {
            x: 0.6,
            y: 4.2,
            w: 12.13,
            h: 1.0,
            fontSize: 20,
            fontFace: template.font.body,
            color: template.colors.textMuted,
            align: 'left',
          }
        );
        if (template.colors.accent) {
          s.addShape('rect', {
            x: 0.6,
            y: 4.0,
            w: 1.2,
            h: 0.06,
            fill: { color: template.colors.accent },
            line: { type: 'none' },
          });
        }
        break;
      }
      case 'agenda': {
        const s = pres.addSlide();
        s.background = { color: template.colors.bg };
        if (template.showHeaderBar) {
          s.addShape('rect', {
            x: 0,
            y: 0,
            w: 13.33,
            h: 0.6,
            fill: { color: template.colors.primary },
            line: { type: 'none' },
          });
        }
        s.addText(content.title || 'Agenda', {
          x: 0.6,
          y: 0.9,
          w: 12.13,
          h: 0.9,
          fontSize: 32,
          fontFace: template.font.heading,
          color: template.colors.text,
          bold: true,
        });
        const items = (
          content.items && content.items.length
            ? content.items
            : (slide.items ?? ['Topic 1', 'Topic 2', 'Topic 3'])
        ).slice(0, 8);
        const lines = items.map((label, idx) => ({
          text: `${idx + 1}.  ${label}\n`,
          options: {
            fontSize: 18,
            color: template.colors.text,
            fontFace: template.font.body,
            paraSpaceAfter: 8,
          },
        }));
        s.addText(lines, {
          x: 0.8,
          y: 2.0,
          w: 11.5,
          h: 4.5,
          valign: 'top',
        });
        break;
      }
      case 'section': {
        const s = pres.addSlide();
        s.background = { color: template.colors.primary };
        s.addText(content.label || slide.label || 'Section', {
          x: 0.6,
          y: 2.8,
          w: 12.13,
          h: 2.0,
          fontSize: 48,
          fontFace: template.font.heading,
          color: '#FFFFFF',
          bold: true,
          align: 'center',
        });
        s.addShape('rect', {
          x: 6.16,
          y: 5.4,
          w: 1.0,
          h: 0.06,
          fill: { color: template.colors.accent },
          line: { type: 'none' },
        });
        break;
      }
      case 'content': {
        const s = pres.addSlide();
        s.background = { color: template.colors.bg };
        if (template.showHeaderBar) {
          s.addShape('rect', {
            x: 0,
            y: 0,
            w: 13.33,
            h: 0.6,
            fill: { color: template.colors.primary },
            line: { type: 'none' },
          });
        }
        s.addText(content.title || slide.title || '', {
          x: 0.6,
          y: 0.9,
          w: 12.13,
          h: 0.9,
          fontSize: 30,
          fontFace: template.font.heading,
          color: template.colors.text,
          bold: true,
        });
        s.addShape('rect', {
          x: 0.6,
          y: 1.85,
          w: 0.8,
          h: 0.05,
          fill: { color: template.colors.accent },
          line: { type: 'none' },
        });
        const bullets = (
          content.bullets && content.bullets.length
            ? content.bullets
            : (slide.bullets ?? ['Key point'])
        ).slice(0, 5);
        const bulletChar =
          template.bulletStyle === 'number'
            ? { type: 'number' as const }
            : template.bulletStyle === 'dash'
              ? { code: '2013' }
              : { code: '2022' };
        const lines = bullets.map((b) => ({
          text: b,
          options: {
            fontSize: 18,
            color: template.colors.text,
            fontFace: template.font.body,
            bullet: bulletChar,
            paraSpaceAfter: 10,
          },
        }));
        s.addText(lines, {
          x: 0.8,
          y: 2.2,
          w: 11.5,
          h: 4.5,
          valign: 'top',
        });
        if (content.speaker_note) {
          s.addNotes(content.speaker_note);
        }
        break;
      }
      case 'quote': {
        const s = pres.addSlide();
        s.background = { color: template.colors.card };
        s.addText(`"${content.quote || slide.quote || ''}"`, {
          x: 1.2,
          y: 2.0,
          w: 10.93,
          h: 3.0,
          fontSize: 28,
          fontFace: template.font.heading,
          color: template.colors.text,
          italic: true,
          align: 'center',
        });
        s.addText(`— ${content.attribution || slide.attribution || 'kimik3'}`, {
          x: 1.2,
          y: 5.2,
          w: 10.93,
          h: 0.5,
          fontSize: 14,
          fontFace: template.font.body,
          color: template.colors.textMuted,
          align: 'center',
        });
        break;
      }
      case 'qa':
      default: {
        const s = pres.addSlide();
        s.background = { color: template.colors.bg };
        s.addText(content.title || slide.title || 'Q&A', {
          x: 0.6,
          y: 2.4,
          w: 12.13,
          h: 1.6,
          fontSize: 56,
          fontFace: template.font.heading,
          color: template.colors.text,
          bold: true,
          align: 'center',
        });
        s.addText(
          content.subtitle ||
            slide.subtitle ||
            'Thanks for listening — happy to take questions.',
          {
            x: 0.6,
            y: 4.2,
            w: 12.13,
            h: 1.0,
            fontSize: 18,
            fontFace: template.font.body,
            color: template.colors.textMuted,
            align: 'center',
          }
        );
        break;
      }
    }
  }

  const out = await pres.write({ outputType: 'arraybuffer' });
  return Buffer.from(out as ArrayBuffer);
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
  // 1. Reserve a credit up front. If the user has none, the task record is
  //    never created (cleaner than a half-orphaned row).
  const access = await consumeMessage(input.userId);
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
      creditsConsumed: 1,
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

    // 3b. Outline
    await updateStatus(taskId, 'outlining', 10);
    const sourceText = await gatherSourceText(input);
    const outlineRaw = await openaiChatCompletion({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildOutlinePrompt({
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
    const outline = extractJson<OutlineResponse>(outlineRaw);
    // Sanity-fill: ensure cover first + qa last.
    if (!Array.isArray(outline.slides) || outline.slides.length === 0) {
      throw new Error('Model returned an empty outline');
    }
    if (outline.slides[0].type !== 'cover') {
      outline.slides.unshift({
        index: 1,
        type: 'cover',
        title: outline.title,
        subtitle: outline.subtitle,
      });
    }
    if (outline.slides[outline.slides.length - 1].type !== 'qa') {
      outline.slides.push({ index: outline.slides.length + 1, type: 'qa' });
    }
    outline.slides = outline.slides
      .slice(0, input.slideCount)
      .map((s, i) => ({ ...s, index: i + 1 }));
    await db()
      .update(pptTask)
      .set({ outlineJson: JSON.stringify(outline) })
      .where(eq(pptTask.id, taskId));

    // 3b. Fill each slide body in parallel (3 at a time to keep load sane).
    await updateStatus(taskId, 'writing', 30);
    const filled: Array<{ slide: OutlineSlide; content: SlideContent }> = [];
    const concurrency = 3;
    for (let i = 0; i < outline.slides.length; i += concurrency) {
      const chunk = outline.slides.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map(async (slide) => {
          // Cover / agenda / section / qa / quote all have a fixed layout
          // — we still ask K3 to fill the subtitle/label for nice flow.
          const raw = await openaiChatCompletion({
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: buildSlideFillPrompt({
                  deckTitle: outline.title || input.title,
                  slideTitle:
                    slide.title || slide.label || `Slide ${slide.index}`,
                  slideType: slide.type,
                  outlineBullets: slide.bullets,
                  sourceExcerpt: sourceText,
                  templateName: template.name,
                }),
              },
            ],
          });
          let content: SlideContent = {};
          try {
            content = extractJson<SlideContent>(raw);
          } catch {
            // Fall back to the outline's own fields if the model returned junk.
            content = {
              title: slide.title,
              subtitle: slide.subtitle,
              label: slide.label,
              items: slide.items,
              bullets: slide.bullets,
              quote: slide.quote,
              attribution: slide.attribution,
            };
          }
          return { slide, content };
        })
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          filled.push(r.value);
        } else {
          // Use outline fallback on failure.
          const slide = chunk[idx];
          filled.push({
            slide,
            content: {
              title: slide.title,
              subtitle: slide.subtitle,
              label: slide.label,
              items: slide.items,
              bullets: slide.bullets,
              quote: slide.quote,
              attribution: slide.attribution,
            },
          });
        }
      });
      const done = Math.min(i + concurrency, outline.slides.length);
      const pct = 30 + Math.round((done / outline.slides.length) * 50);
      await updateStatus(taskId, 'writing', pct);
    }

    // 3c. Render the .pptx
    await updateStatus(taskId, 'rendering', 85);
    const buffer = await renderPptx(outline, filled, template);
    const url = await persistPptx(taskId, buffer);
    await db()
      .update(pptTask)
      .set({
        status: 'done',
        progress: 100,
        slidesJson: JSON.stringify(filled),
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
