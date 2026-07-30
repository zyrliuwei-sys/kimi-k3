/**
 * Map a UX-friendly aspect ratio (`"16:9"`) to the pixel size the
 * provider actually accepts (`"1792x1024"`).
 *
 * The previous design only allowed an explicit allowlist of pixel sizes
 * (`1024x1024`, `1792x1024`, …). Client code sent ratios through
 * `aspectRatio.replace(':', 'x')` → `"16x9"`, which silently failed the
 * allowlist and dropped `size` to empty. The user picked a ratio and
 * got back the provider default, which felt like "unstable generation".
 *
 * This module is the single source of truth on both sides:
 *   - client: `ratioToSize("16:9")` → `"1792x1024"`
 *   - server: same lookup, rejects unmapped ratios outright
 */

export const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1', preview: 100 },
  { value: '16:9', label: '16:9', preview: 56 },
  { value: '9:16', label: '9:16', preview: 178 },
  { value: '4:3', label: '4:3', preview: 75 },
  { value: '3:4', label: '3:4', preview: 133 },
  { value: '3:2', label: '3:2', preview: 67 },
  { value: '2:3', label: '2:3', preview: 150 },
  { value: '2:1', label: '2:1', preview: 50 },
  { value: '1:2', label: '1:2', preview: 200 },
  { value: '20:9', label: '20:9', preview: 45 },
  { value: '9:20', label: '9:20', preview: 222 },
] as const;

export type AspectRatioValue = (typeof ASPECT_RATIOS)[number]['value'];

/**
 * Pixel dimensions per ratio. Pixel counts chosen to land near the
 * shorter side ≈ 1024 (the smallest dimension Evolink reliably serves).
 * Tweak here, not in client code.
 */
const RATIO_TO_PIXELS: Record<AspectRatioValue, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:3': '1280x960',
  '3:4': '960x1280',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '2:1': '2048x1024',
  '1:2': '1024x2048',
  '20:9': '1280x576',
  '9:20': '576x1280',
};

/**
 * Convert an aspect ratio token (`"16:9"`, `"4:3"`, …) to the pixel
 * string the provider expects (`"1792x1024"`). Returns `undefined` when
 * the ratio isn't in the map — callers should treat undefined as
 * "let the provider pick".
 */
export function ratioToSize(
  ratio: string | undefined | null
): string | undefined {
  if (!ratio) return undefined;
  return RATIO_TO_PIXELS[ratio as AspectRatioValue];
}

/**
 * Same lookup but accepts the user's free-form input (e.g. `"16x9"`,
 * `"16 : 9"`, `"16/9"`) and normalizes it before lookup. Returns
 * undefined for any unrecognised shape.
 */
export function normalizeRatioToSize(
  raw: string | undefined | null
): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s/g, '').replace(/[xX/]/, ':');
  return ratioToSize(cleaned);
}
