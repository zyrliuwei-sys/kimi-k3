/**
 * PPT template definitions.
 *
 * Each template carries its color palette + the 3 mini-slide previews
 * (cover / content / closing) drawn in SVG. The renderer in ./service.ts
 * uses the colors; the UI uses the SVGs to populate the masonry picker.
 *
 * Categories map to the category-tab filter at the top of the workspace:
 *   - "business"  : biz-dark, bold-color, data-screen
 *   - "creative"  : bold-color, retro-cream
 *   - "minimal"   : minimal-mono, retro-cream
 *   - "education" : edu-playful, data-screen
 */

export type TemplateCategory =
  | 'business'
  | 'creative'
  | 'minimal'
  | 'education';

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory[];
  blurb: string;
  swatch: string;
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
  // Mini-slide previews — each one is a render function that takes the
  // template's colors and returns the SVG path/shape string. They're
  // computed once at module load and stored on the template.
  previews: {
    cover: string;
    content: string;
    closing: string;
  };
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function previewCover(c: Template['colors']): string {
  return `<svg viewBox="0 0 240 135" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <rect width="240" height="135" fill="${escapeAttr(c.bg)}"/>
    ${c.bg !== '#FFFFFF' ? '' : '<rect width="240" height="6" fill="' + escapeAttr(c.primary) + '"/>'}
    <rect x="20" y="56" width="120" height="6" rx="3" fill="${escapeAttr(c.primary)}"/>
    <rect x="20" y="72" width="80" height="3" rx="1.5" fill="${escapeAttr(c.textMuted)}"/>
    <rect x="20" y="84" width="60" height="3" rx="1.5" fill="${escapeAttr(c.textMuted)}"/>
    <rect x="20" y="110" width="30" height="3" rx="1.5" fill="${escapeAttr(c.accent)}"/>
  </svg>`;
}

function previewContent(c: Template['colors']): string {
  return `<svg viewBox="0 0 240 135" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <rect width="240" height="135" fill="${escapeAttr(c.bg)}"/>
    <rect x="0" y="0" width="240" height="3" fill="${escapeAttr(c.primary)}"/>
    <rect x="20" y="18" width="80" height="4" rx="2" fill="${escapeAttr(c.text)}"/>
    <rect x="20" y="32" width="60" height="2" rx="1" fill="${escapeAttr(c.accent)}"/>
    <g transform="translate(20, 50)">
      <circle cx="3" cy="3" r="2" fill="${escapeAttr(c.accent)}"/>
      <rect x="12" y="1" width="120" height="3" fill="${escapeAttr(c.textMuted)}"/>
      <circle cx="3" cy="13" r="2" fill="${escapeAttr(c.accent)}"/>
      <rect x="12" y="11" width="100" height="3" fill="${escapeAttr(c.textMuted)}"/>
      <circle cx="3" cy="23" r="2" fill="${escapeAttr(c.accent)}"/>
      <rect x="12" y="21" width="110" height="3" fill="${escapeAttr(c.textMuted)}"/>
      <circle cx="3" cy="33" r="2" fill="${escapeAttr(c.accent)}"/>
      <rect x="12" y="31" width="80" height="3" fill="${escapeAttr(c.textMuted)}"/>
    </g>
    <rect x="20" y="110" width="40" height="6" rx="3" fill="${escapeAttr(c.primary)}"/>
  </svg>`;
}

function previewClosing(c: Template['colors']): string {
  return `<svg viewBox="0 0 240 135" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <rect width="240" height="135" fill="${escapeAttr(c.primary)}"/>
    <text x="120" y="55" font-family="sans-serif" font-size="14" font-weight="600" fill="${c.bg}" text-anchor="middle">Q&amp;A</text>
    <text x="120" y="76" font-family="sans-serif" font-size="6" fill="${escapeAttr(c.bg)}" text-anchor="middle" opacity="0.7">Thanks for watching</text>
    <rect x="80" y="100" width="80" height="2" rx="1" fill="${escapeAttr(c.accent)}"/>
  </svg>`;
}

export const TEMPLATES: Template[] = [
  {
    id: 'biz-dark',
    name: 'Business Dark',
    category: ['business'],
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
    previews: {} as any,
  },
  {
    id: 'bold-color',
    name: 'Bold Color',
    category: ['creative', 'business'],
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
    previews: {} as any,
  },
  {
    id: 'minimal-mono',
    name: 'Minimal Mono',
    category: ['minimal'],
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
    previews: {} as any,
  },
  {
    id: 'edu-playful',
    name: 'Edu Playful',
    category: ['education', 'creative'],
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
    previews: {} as any,
  },
  {
    id: 'retro-cream',
    name: 'Retro Cream',
    category: ['creative', 'minimal'],
    blurb: 'Warm beige + serif. Editorial, magazine, vintage editorial.',
    swatch: '#D6BC8A',
    colors: {
      primary: '#92400E',
      secondary: '#B45309',
      accent: '#C2410C',
      text: '#3F2D1A',
      textMuted: '#78716C',
      bg: '#FAF6EE',
      card: '#F0E6D2',
    },
    font: { heading: 'Georgia', body: 'Georgia' },
    previews: {} as any,
  },
  {
    id: 'data-screen',
    name: 'Data Screen',
    category: ['business', 'education'],
    blurb: 'Dark dashboard + neon. Data reports, dashboards, analytics.',
    swatch: '#22D3EE',
    colors: {
      primary: '#0F172A',
      secondary: '#1E293B',
      accent: '#22D3EE',
      text: '#F1F5F9',
      textMuted: '#94A3B8',
      bg: '#020617',
      card: '#0F172A',
    },
    font: { heading: 'Calibri', body: 'Calibri' },
    previews: {} as any,
  },
];

// Compute the SVG previews now that we have full template data. Done in a
// second pass so we can reference c.colors inside the preview generators.
for (const t of TEMPLATES) {
  t.previews = {
    cover: previewCover(t.colors),
    content: previewContent(t.colors),
    closing: previewClosing(t.colors),
  };
}

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export const CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'creative', label: 'Creative' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'education', label: 'Education' },
];
