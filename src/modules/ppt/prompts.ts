/**
 * Prompt templates for the PPT generator.
 *
 * Two prompts:
 *   - outlinePrompt:  asks K3 to plan a {slideCount}-slide outline as JSON
 *   - slidePrompt:    fills in the body of a single slide as JSON
 *
 * The renderer (./service.ts) reads the JSON, lays out the deck, and writes
 * a .pptx via pptxgenjs. Keeping the prompts in one file makes it easy to
 * iterate on tone / structure without touching orchestration code.
 */

export const SYSTEM_PROMPT = `You are kimik3's presentation designer. You turn source material into clean, structured presentation slides that render correctly in PowerPoint / Keynote / Google Slides.

OUTPUT RULES (apply to every response):
1. Return STRICT JSON. No markdown fences, no leading commentary.
2. Each slide must include a "type" — one of: cover | agenda | section | content | quote | qa.
3. Content slides include "bullets" (max 5, each ≤ 18 words).
4. Cover slides include "subtitle".
5. Section dividers include "label" (one short phrase).
6. Quote slides include "quote" + "attribution".
7. The deck must start with type=cover and end with type=qa.
8. Never include image references, emojis, or markdown.`;

export interface OutlineArgs {
  title: string;
  topic: string;
  userPrompt: string;
  slideCount: number;
  templateName: string;
  sourceExcerpt: string;
}

export function buildOutlinePrompt({
  title,
  topic,
  userPrompt,
  slideCount,
  templateName,
  sourceExcerpt,
}: OutlineArgs): string {
  return `Design a ${slideCount}-slide presentation deck.

DECK TITLE: ${title}
${topic && topic !== title ? `TOPIC: ${topic}\n` : ''}USER REQUEST: ${userPrompt || '(none — use your judgement)'}
TEMPLATE STYLE: ${templateName}

${
  sourceExcerpt
    ? `SOURCE MATERIAL (summarize faithfully — do not invent facts):\n"""\n${sourceExcerpt}\n"""\n`
    : 'No source material — write a clean, generic deck on the topic above.\n'
}

Return JSON of this exact shape:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    { "index": 1, "type": "cover",     "title": "...", "subtitle": "..." },
    { "index": 2, "type": "agenda",    "title": "Agenda", "items": ["...", "..."] },
    { "index": 3, "type": "section",   "label": "Part 1" },
    { "index": 4, "type": "content",   "title": "...", "bullets": ["...", "..."] },
    { "index": 5, "type": "content",   "title": "...", "bullets": ["..."] },
    { "index": N, "type": "qa",         "title": "Q&A",    "subtitle": "Thanks for listening" }
  ]
}

Constraints:
- Exactly ${slideCount} slides
- Slide 1 = cover, slide 2 = agenda, last slide = qa
- 60-70% of the middle slides are "content"; the rest can be "section" dividers
- Bullets are concrete, not generic — use numbers, examples, or claims from the source
- No invented citations or fake data; if a fact isn't in the source, say so
- No markdown, no code fences, no prose — return JSON only`;
}

export interface SlideFillArgs {
  deckTitle: string;
  slideTitle: string;
  slideType: string;
  outlineBullets?: string[];
  sourceExcerpt: string;
  templateName: string;
}

export function buildSlideFillPrompt({
  deckTitle,
  slideTitle,
  slideType,
  outlineBullets,
  sourceExcerpt,
  templateName,
}: SlideFillArgs): string {
  return `Fill the body of ONE slide in the "${deckTitle}" deck.

SLIDE INDEX / TITLE: ${slideTitle}
SLIDE TYPE: ${slideType}
TEMPLATE STYLE: ${templateName}
${
  outlineBullets && outlineBullets.length
    ? `OUTLINE BULLETS (use as a starting point — refine, don't repeat verbatim):\n${outlineBullets
        .map((b) => `  - ${b}`)
        .join('\n')}\n`
    : ''
}
SOURCE EXCERPTS (use only what's here, no invented facts):
"""
${sourceExcerpt || '(no source)'}
"""

Return STRICT JSON only. Schema:
- If type = "content":   { "title": "...", "bullets": ["...", "..."], "speaker_note": "..." }
- If type = "agenda":    { "title": "Agenda", "items": ["...", "..."] }
- If type = "section":   { "label": "..." }
- If type = "cover":     { "subtitle": "..." }
- If type = "qa":        { "subtitle": "..." }
- If type = "quote":     { "quote": "...", "attribution": "..." }

Bullets must each be ≤ 18 words. Return ONLY the JSON object.`;
}
