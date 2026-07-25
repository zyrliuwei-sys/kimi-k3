/**
 * Prompt templates for the PPT generator.
 *
 * Two prompt shapes live here:
 *
 *  - `buildDesignPrompt`  — the *primary* prompt. One K3 call produces the
 *                          full deck design as a single JSON blob:
 *                          per-slide layout decisions, copy, icon picks,
 *                          stat values. K3 is doing the design work; the
 *                          renderer just executes it.
 *
 *  - `buildSlideFillPrompt` — kept as a fallback path for when the design
 *                          prompt returns unusable JSON (rare). It asks
 *                          K3 to fill a single slide body given an
 *                          already-decided outline.
 *
 * The renderer's job (`./service.ts`) is intentionally dumb: it reads
 * the JSON and emits PptxGenJS calls. PptxGenJS handles the native PPT
 * structure — slide masters, native shapes, charts, tables, placeholders
 * — so we never hand-roll rectangle positions for chrome.
 */

export const SYSTEM_PROMPT = `You are kimik3's presentation designer. You turn source material into clean, well-designed presentation decks that render correctly in PowerPoint / Keynote / Google Slides.

OUTPUT RULES (apply to every response):
1. Return STRICT JSON. No markdown fences, no leading commentary.
2. Each slide MUST specify a "type". Content slides MUST also specify a "layout".
3. Pick layouts based on content shape — never repeat the same layout twice in a row.
4. Bullets ≤ 18 words each. Titles ≤ 8 words.
5. Use emoji icons (📈 💡 ⚡ 🎯 ✅ 🔑 🚀 ⚙️ 💎 🧠 🔒 ⚠️ 📊 📉 💰 👥 🔍 📦 🎨 ⚙️ 🛠️) as visual anchors — never as decoration-only.
6. Specificity wins. Numbers, dollar amounts, percentages beat vague claims.`;

export interface DesignArgs {
  title: string;
  topic: string;
  userPrompt: string;
  slideCount: number;
  templateName: string;
  sourceExcerpt: string;
}

/**
 * Build the primary design prompt. Single K3 call returns the entire deck
 * as one JSON document, including layout decisions. This is the prompt
 * that actually exercises K3's design capability — the schema doubles
 * as a design checklist and a delivery contract.
 */
export function buildDesignPrompt({
  title,
  topic,
  userPrompt,
  slideCount,
  templateName,
  sourceExcerpt,
}: DesignArgs): string {
  return `Design a ${slideCount}-slide presentation deck.

DECK TITLE: ${title}
${topic && topic !== title ? `TOPIC: ${topic}\n` : ''}USER REQUEST: ${userPrompt || '(none — use your judgement)'}
TEMPLATE STYLE: ${templateName}

${
  sourceExcerpt
    ? `SOURCE MATERIAL (summarize faithfully — do not invent facts):\n"""\n${sourceExcerpt.slice(0, 50_000)}\n"""\n`
    : 'No source material — write a clean, generic deck on the topic above.\n'
}

=== LAYOUT LIBRARY ===
Pick ONE layout per content slide. The renderer will faithfully execute whatever you choose.

LAYOUTS for content slides:
  "bullets"               3-5 bullets, classic. Explanatory paragraphs.
  "stat-callout"          2-3 huge numbers with labels + emoji. Use when you have metrics.
  "three-column-features" 3 cards: emoji + title + 1-sentence desc. Pillars / features / principles.
  "two-column"            left bullets, right quote or callout. Juxtaposition or supporting evidence.
  "process-flow"          3-5 numbered steps horizontally. Sequences / timelines / workflows.
  "comparison"            two sides, each with heading + bullets. Before/after, pros/cons, options.
  "big-statement"         one giant sentence that takes the slide. Thesis / closing thought.

SPECIAL SLIDE TYPES (not "content"):
  "cover"    — title page. {accent: "left"|"right"|"top"|"bottom"}
  "agenda"   — table of contents. {items: [...]}
  "section"  — divider between parts. {label, bigNumber: "01"}
  "quote"    — pull quote. {quote, attribution}
  "qa"       — closing.

=== VISUAL RULES ===
- ONE core idea per slide. If a slide needs more, split it.
- Vary the layout across the deck — NEVER use the same layout twice in a row.
- Pick the layout that matches the CONTENT SHAPE:
    metrics / KPIs / numbers → stat-callout
    features / principles / pillars → three-column-features
    sequences / timelines / workflows → process-flow
    pros / cons / before-after → comparison
    conclusion / thesis / takeaway → big-statement
- Use emoji icons as visual anchors for features and stats.
- Titles are noun phrases or short statements, NOT full sentences.
- Stats must be specific (%, $ amounts, counts), never vague.
- Source-faithful: do not invent facts. If something isn't in the source, say so or omit it.

=== ANTI-PATTERNS (these make decks look like AI-slop) ===
  ✗ Title + 5 long paragraphs of bullets ("bullets" for every content slide)
  ✗ Generic placeholders ("Key point 1", "Overview", "Details")
  ✗ Vague stats ("many", "significant", "growing")
  ✗ Walls of text with no visual anchoring (no icons, no cards, no structure)
  ✗ Same layout repeated 5+ times in a row

=== STRICT JSON SCHEMA ===
Return ONLY this JSON (no markdown fences, no prose):

{
  "title": "deck title",
  "subtitle": "deck subtitle (optional)",
  "templateHint": "any",
  "slides": [
    {"type": "cover", "accent": "left", "title": "...", "subtitle": "..."},
    {"type": "agenda", "items": ["Topic 1", "Topic 2", "Topic 3", "Topic 4"]},
    {"type": "section", "label": "Part 1", "bigNumber": "01"},
    {"type": "content", "layout": "stat-callout", "title": "By the numbers", "stats": [
      {"value": "+147%", "label": "YoY growth", "icon": "📈", "colorHint": "accent"},
      {"value": "$2.4M", "label": "ARR",         "icon": "💰", "colorHint": "primary"}
    ]},
    {"type": "content", "layout": "three-column-features", "title": "Three pillars", "features": [
      {"icon": "⚡", "title": "Speed",  "desc": "p95 latency under 200ms globally"},
      {"icon": "🔒", "title": "Trust",  "desc": "SOC 2 + ISO 27001 in progress"},
      {"icon": "🧠", "title": "Smart",  "desc": "K3 reasoning baked into every plan"}
    ]},
    {"type": "content", "layout": "process-flow", "title": "From research to ship", "steps": [
      {"num": "01", "title": "Research"}, {"num": "02", "title": "Prototype"},
      {"num": "03", "title": "Beta"},     {"num": "04", "title": "GA"}
    ]},
    {"type": "content", "layout": "comparison", "title": "Today vs Q3", "comparison": {
      "left":  {"heading": "Today", "items": ["Manual reports", "8s load time", "Single region"]},
      "right": {"heading": "Q3",    "items": ["Auto insights",  "200ms load",  "Global edge"]}
    }},
    {"type": "content", "layout": "two-column", "title": "Why this matters", "columns": [
      {"heading": "Reality",  "body": ["Most teams guess at priorities"]},
      {"heading": "We ship",  "body": ["Data-driven bets, weekly review"]}
    ]},
    {"type": "content", "layout": "big-statement", "statement": "We're not adding features — we're rebuilding the foundation."},
    {"type": "content", "layout": "bullets", "title": "Three bets", "bullets": [
      "Specific, dated commitment with a metric",
      "Specific, dated commitment with a metric",
      "Specific, dated commitment with a metric"
    ]},
    {"type": "quote", "quote": "Quote text here.", "attribution": "Source"},
    {"type": "qa"}
  ]
}

Deck constraints:
- Exactly ${slideCount} slides.
- First slide = "cover", last slide = "qa".
- Slide 2 should usually be "agenda".
- Use 1-2 "section" dividers to break up long decks.
- No two consecutive slides share the same content layout.`;
}

// ─── Fallback prompt (legacy) ────────────────────────────────────────────────

export interface SlideFillArgs {
  deckTitle: string;
  slideTitle: string;
  slideType: string;
  outlineBullets?: string[];
  sourceExcerpt: string;
  templateName: string;
}

/**
 * Fallback path — only used when the design prompt returns malformed
 * JSON. Kept here so the service has a safety net.
 */
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
