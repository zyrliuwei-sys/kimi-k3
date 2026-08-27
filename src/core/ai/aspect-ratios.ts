/**
 * Map a UX-friendly aspect ratio (`"16:9"`) to the closest landscape or
 * portrait canvas the active provider actually accepts (`"1536x1024"`).
 *
 * The previous design only allowed an explicit allowlist of pixel sizes
 * (`1024x1024`, `1792x1024`, …). Client code sent ratios through
 * `aspectRatio.replace(':', 'x')` → `"16x9"`, which silently failed the
 * allowlist and dropped `size` to empty. The user picked a ratio and
 * got back the provider default, which felt like "unstable generation".
 *
 * This module is the single source of truth on both sides:
 *   - client: `ratioToSize("16:9")` → `"1536x1024"`
 *   - server: the same lookup selects a compatible source canvas
 */

/**
 * The product still offers all requested output frames. gpt-image-2 accepts
 * only three source canvases, so every landscape choice starts with the
 * supported landscape canvas and every portrait choice with its portrait
 * counterpart. The client records and crops to the chosen frame when it
 * renders the result; keeping a compatible source canvas prevents the
 * gateway from silently falling back to 1:1.
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
  { value: '5:4', label: '5:4', preview: 80 },
  { value: '4:5', label: '4:5', preview: 125 },
] as const;

export type AspectRatioValue = (typeof ASPECT_RATIOS)[number]['value'];

/**
 * Source dimensions per output frame. gpt-image-2 only supports the three
 * values used below. A wider/taller supported source means the final UI crop
 * never needs to upscale the model output.
 */
const RATIO_TO_PIXELS: Record<AspectRatioValue, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '2:1': '1536x1024',
  '1:2': '1024x1536',
  '5:4': '1536x1024',
  '4:5': '1024x1536',
};

/**
 * Convert an aspect ratio token (`"16:9"`, `"4:3"`, …) to the pixel
 * string the provider expects (`"1536x1024"`). Returns `undefined` when
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
