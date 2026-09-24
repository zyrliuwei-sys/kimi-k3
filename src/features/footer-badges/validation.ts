import { MAX_FOOTER_BADGES, type FooterBadge } from './types';

const MAX_ALT_LENGTH = 120;

function safeHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  return url.toString();
}

function optionalDimension(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(
      `${field} must be a positive integer no greater than ${max}`
    );
  }
  return number;
}

export function validateFooterBadges(value: unknown): FooterBadge[] {
  if (!Array.isArray(value) || value.length > MAX_FOOTER_BADGES) {
    throw new Error(
      `A maximum of ${MAX_FOOTER_BADGES} footer badges is allowed`
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Footer badge ${index + 1} is invalid`);
    }

    const badge = item as Record<string, unknown>;
    const href = safeHttpsUrl(badge.href, `Badge ${index + 1} link`);
    const src = safeHttpsUrl(badge.src, `Badge ${index + 1} image`);
    const alt = typeof badge.alt === 'string' ? badge.alt.trim() : '';

    if (!alt || alt.length > MAX_ALT_LENGTH) {
      throw new Error(
        `Badge ${index + 1} alt text must be 1-${MAX_ALT_LENGTH} characters`
      );
    }

    return {
      href,
      src,
      alt,
      width: optionalDimension(badge.width, `Badge ${index + 1} width`, 1000),
      height: optionalDimension(badge.height, `Badge ${index + 1} height`, 600),
    };
  });
}

export function parseStoredFooterBadges(value?: string): FooterBadge[] {
  if (!value) return [];
  try {
    return validateFooterBadges(JSON.parse(value));
  } catch {
    return [];
  }
}
