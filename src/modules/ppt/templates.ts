/**
 * PPT template definitions.
 *
 * Each template is a thin set of colors + font choices that get applied
 * across the standard slide layouts (cover, agenda, content, qa). We
 * intentionally keep the surface area small so the K3-generated outline
 * doesn't have to know about per-template quirks — the renderer just reads
 * the template's colors and applies them everywhere.
 *
 * Layouts are produced by `renderOutline()` in ./service.ts based on the
 * `slide.type` field returned by K3 in the outline step.
 */

export interface Template {
  id: string;
  name: string;
  blurb: string;
  swatch: string; // hex used in the template picker
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    textMuted: string;
    bg: string;
    card: string;
  };
  font: {
    heading: string;
    body: string;
  };
  bulletStyle: 'dot' | 'dash' | 'number';
  showHeaderBar: boolean;
}

export const TEMPLATES: Template[] = [
  {
    id: 'biz-dark',
    name: 'Business Dark',
    blurb: 'Crisp navy + warm accent. Best for exec reviews & pitch decks.',
    swatch: '#1E40AF',
    colors: {
      primary: '#1E3A8A',
      secondary: '#3B82F6',
      accent: '#F59E0B',
      text: '#0F172A',
      textMuted: '#475569',
      bg: '#FFFFFF',
      card: '#F8FAFC',
    },
    font: { heading: 'Calibri', body: 'Calibri' },
    bulletStyle: 'dot',
    showHeaderBar: true,
  },
  {
    id: 'bold-color',
    name: 'Bold Color',
    blurb: 'Vibrant magenta + electric blue. High energy product launches.',
    swatch: '#DB2777',
    colors: {
      primary: '#DB2777',
      secondary: '#7C3AED',
      accent: '#FACC15',
      text: '#1F2937',
      textMuted: '#6B7280',
      bg: '#FFFFFF',
      card: '#FDF2F8',
    },
    font: { heading: 'Calibri', body: 'Calibri' },
    bulletStyle: 'dash',
    showHeaderBar: false,
  },
  {
    id: 'minimal-mono',
    name: 'Minimal Mono',
    blurb: 'Typewriter grayscale. Editorial, clean, lots of whitespace.',
    swatch: '#111827',
    colors: {
      primary: '#111827',
      secondary: '#374151',
      accent: '#9CA3AF',
      text: '#111827',
      textMuted: '#6B7280',
      bg: '#FFFFFF',
      card: '#F9FAFB',
    },
    font: { heading: 'Courier New', body: 'Calibri' },
    bulletStyle: 'number',
    showHeaderBar: false,
  },
  {
    id: 'edu-playful',
    name: 'Edu Playful',
    blurb: 'Friendly greens + soft oranges. Workshops, classes, training.',
    swatch: '#10B981',
    colors: {
      primary: '#047857',
      secondary: '#F97316',
      accent: '#FACC15',
      text: '#1F2937',
      textMuted: '#4B5563',
      bg: '#FFFFFF',
      card: '#ECFDF5',
    },
    font: { heading: 'Calibri', body: 'Calibri' },
    bulletStyle: 'dot',
    showHeaderBar: true,
  },
];

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
