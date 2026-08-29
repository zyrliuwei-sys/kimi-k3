/**
 * Extract an explicit PPT page request from a natural-language brief. This is
 * deliberately shared by the composer and the server so the page-count cue a
 * person sees before sending can never disagree with the exported deck.
 */
export function requestedPptSlideCount(prompt: string): number | undefined {
  const units = '(?:页(?:PPT|幻灯片)?|p(?:pt)?|slides?|pages?)';
  const numeric = prompt.match(
    new RegExp(`(?:^|[^\\d])(\\d{1,3})\\s*${units}`, 'i')
  );
  if (numeric?.[1]) return clampPptSlides(Number.parseInt(numeric[1], 10));

  const chinese = prompt.match(
    new RegExp(
      `([一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])\\s*${units}`,
      'i'
    )
  );
  if (!chinese?.[1]) return undefined;

  const count = chineseSlideNumber(chinese[1]);
  return count === undefined ? undefined : clampPptSlides(count);
}

function clampPptSlides(value: number): number {
  return Math.max(3, Math.min(20, value));
}

function chineseSlideNumber(value: string): number | undefined {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const tens = value.match(
    /^([一二三四五六七八九])?十([一二三四五六七八九])?$/
  );
  if (tens) {
    const leading = tens[1] ? digits[tens[1]] : 1;
    const trailing = tens[2] ? digits[tens[2]] : 0;
    return leading * 10 + trailing;
  }
  return digits[value];
}
