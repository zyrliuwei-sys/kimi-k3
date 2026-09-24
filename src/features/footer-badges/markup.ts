import type { FooterBadge } from './types';
import { validateFooterBadges } from './validation';

const ANCHOR_ATTRIBUTES = new Set(['href', 'target', 'rel']);
const IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'width', 'height', 'loading']);

function hasOnlyAllowedAttributes(element: Element, allowed: Set<string>) {
  return Array.from(element.attributes).every((attribute) =>
    allowed.has(attribute.name.toLowerCase())
  );
}

function hasOnlyWhitespaceText(element: Element) {
  return Array.from(element.childNodes).every(
    (node) => node.nodeType === Node.ELEMENT_NODE || !node.textContent?.trim()
  );
}

/**
 * Extract safe link/image data from pasted badge snippets without rendering
 * submitted HTML. Only <a><img></a> markup and a small attribute allowlist are
 * accepted; the server validates the extracted values again before saving.
 */
export function parseFooterBadgeMarkup(markup: string): FooterBadge[] {
  if (!markup.trim() || markup.length > 20_000) {
    throw new Error('invalid_markup');
  }

  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const elements = Array.from(doc.body.children);
  if (
    elements.length === 0 ||
    !hasOnlyWhitespaceText(doc.body) ||
    elements.some((element) => element.tagName !== 'A')
  ) {
    throw new Error('invalid_markup');
  }

  const badges = elements.map((anchor) => {
    if (
      !hasOnlyAllowedAttributes(anchor, ANCHOR_ATTRIBUTES) ||
      (anchor.getAttribute('target') &&
        anchor.getAttribute('target') !== '_blank') ||
      !hasOnlyWhitespaceText(anchor)
    ) {
      throw new Error('invalid_markup');
    }

    const children = Array.from(anchor.children);
    if (children.length !== 1 || children[0]?.tagName !== 'IMG') {
      throw new Error('invalid_markup');
    }

    const image = children[0];
    if (!hasOnlyAllowedAttributes(image, IMAGE_ATTRIBUTES)) {
      throw new Error('invalid_markup');
    }

    return {
      href: anchor.getAttribute('href') ?? '',
      src: image.getAttribute('src') ?? '',
      alt: image.getAttribute('alt') ?? '',
      width: image.hasAttribute('width')
        ? Number(image.getAttribute('width'))
        : 250,
      height: image.hasAttribute('height')
        ? Number(image.getAttribute('height'))
        : undefined,
    };
  });

  return validateFooterBadges(badges);
}
