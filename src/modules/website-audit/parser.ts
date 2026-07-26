/**
 * Website Auditor — HTML → SiteData.
 *
 * Uses parse5 for a DOM-accurate walk (handles malformed HTML, comments,
 * CDATA, mixed-case attributes). Extracts only the fields the rubric cares
 * about — large blobs (full text, inline scripts) are truncated to keep the
 * downstream LLM prompt within its token budget.
 *
 * Side probes (robots / llms / sitemap) come from `fetcher.ts` and are passed
 * in via `buildSiteData`. The parser only touches the main HTML.
 *
 * Internals use loose `any` for parse5 nodes — the boundary is `SiteData`
 * (zod-typed) which is the only thing callers see.
 */

import { parse } from 'parse5';

import type { SafeFetchResult } from './safe-fetch';
import {
  SiteDataSchema,
  type RobotsProbe,
  type SideProbe,
  type SiteData,
} from './schema';

// ─── Public entry ──────────────────────────────────────────────────────────

export interface BuildSiteDataInput {
  html: string;
  fetch: SafeFetchResult;
  robotsTxt?: RobotsProbe;
  llmsTxt?: SideProbe;
  sitemapXml?: SideProbe & { urlCount?: number };
}

export function buildSiteData(input: BuildSiteDataInput): SiteData {
  const { html, fetch: f, robotsTxt, llmsTxt, sitemapXml } = input;
  const doc = parse(html) as unknown as Parse5Document;

  const htmlEl = findChild(doc, 'html') as Parse5Element | undefined;
  const head = htmlEl
    ? (findChild(htmlEl, 'head') as Parse5Element | undefined)
    : undefined;
  const body = htmlEl
    ? (findChild(htmlEl, 'body') as Parse5Element | undefined)
    : undefined;

  const htmlLang: string | null = htmlEl
    ? (getAttr(htmlEl, 'lang') ?? null)
    : null;

  const allElements: Parse5Element[] = [];
  if (head) walk(head, allElements.push);
  if (body) walk(body, allElements.push);

  // ── head meta + link + title
  const metaTags = head ? collectMeta(head) : [];
  const linkTags = head ? collectLinks(head) : [];
  const titleText = head ? readTitleText(head) : '';

  const hasViewport = metaTags.some(
    (m) => (m.name ?? '').toLowerCase() === 'viewport'
  );
  const hasCharset = metaTags.some(
    (m) => (m.httpEquiv ?? '').toLowerCase() === 'content-type' || !!m.charset
  );

  // ── headings
  const headings: { level: number; text: string }[] = [];
  for (const el of allElements) {
    const m = /^h([1-6])$/.exec(el.tagName);
    if (m) {
      const text = collapseText(el).trim();
      if (text) headings.push({ level: Number(m[1]), text });
    }
  }

  // ── images
  const images: SiteData['images'] = [];
  let imagesWithoutAlt = 0;
  let imagesWithoutDims = 0;
  for (const el of allElements) {
    if (el.tagName !== 'img') continue;
    const src = getAttr(el, 'src');
    if (!src) continue;
    const altAttr = getAttr(el, 'alt');
    // alt attribute is special: present-but-empty is meaningful (decorative
    // image), and missing entirely is a different a11y signal. We normalize
    // missing → null and present → the trimmed string.
    const alt: string | null = altAttr === undefined ? null : altAttr;
    if (alt === null || alt.trim() === '') imagesWithoutAlt++;
    const w = getAttr(el, 'width');
    const h = getAttr(el, 'height');
    if (!w || !h) imagesWithoutDims++;
    images.push({
      src,
      alt,
      width: w,
      height: h,
      loading: getAttr(el, 'loading'),
      hasWidthHeight: !!w && !!h,
    });
    if (images.length >= 80) break;
  }

  // ── scripts
  let scriptCount = 0;
  const externalScriptHosts: string[] = [];
  for (const el of allElements) {
    if (el.tagName !== 'script') continue;
    scriptCount++;
    const src = getAttr(el, 'src');
    if (src) {
      try {
        const host = new URL(src, 'https://placeholder.test').host;
        if (host && !externalScriptHosts.includes(host)) {
          externalScriptHosts.push(host);
          if (externalScriptHosts.length >= 20) break;
        }
      } catch {
        /* ignore bad URLs */
      }
    }
  }

  // ── stylesheets
  let stylesheetCount = 0;
  for (const el of allElements) {
    if (
      el.tagName === 'link' &&
      (getAttr(el, 'rel') ?? '').toLowerCase() === 'stylesheet'
    ) {
      stylesheetCount++;
    }
  }

  // ── fonts (font-family declarations on body / inline styles)
  const fontFamilies = collectFontFamilies(allElements);

  // ── iframes
  let iframeCount = 0;
  for (const el of allElements) {
    if (el.tagName === 'iframe') iframeCount++;
  }

  // ── forms
  let formCount = 0;
  let inputCountWithoutLabel = 0;
  for (const el of allElements) {
    if (el.tagName === 'form') formCount++;
    if (el.tagName === 'input') {
      const id = getAttr(el, 'id');
      const name = getAttr(el, 'name');
      const ariaLabel = getAttr(el, 'aria-label');
      const inputType = (getAttr(el, 'type') ?? 'text').toLowerCase();
      const labelable =
        inputType !== 'hidden' &&
        inputType !== 'submit' &&
        inputType !== 'button' &&
        inputType !== 'image';
      if (!labelable) continue;
      let hasLabel = false;
      if (id) {
        // Find matching <label for="id"> anywhere in the document (best-effort,
        // cheap heuristic — exact DOM tracking is overkill for this audit).
        for (const candidate of allElements) {
          if (
            candidate.tagName === 'label' &&
            getAttr(candidate, 'for') === id
          ) {
            hasLabel = true;
            break;
          }
        }
      }
      if (!hasLabel && !ariaLabel && !name) inputCountWithoutLabel++;
    }
  }

  // ── inline style count
  let inlineStyleCount = 0;
  for (const el of allElements) {
    if (getAttr(el, 'style')) inlineStyleCount++;
  }

  // ── link analysis (internal / external)
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  let finalOrigin = '';
  try {
    finalOrigin = new URL(f.finalUrl).origin;
  } catch {
    /* ignore */
  }
  for (const el of allElements) {
    if (el.tagName !== 'a') continue;
    const href = getAttr(el, 'href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:'))
      continue;
    try {
      const u = new URL(href, f.finalUrl);
      if (u.host === finalOrigin) internalLinkCount++;
      else externalLinkCount++;
    } catch {
      /* malformed — skip */
    }
  }

  // ── JSON-LD
  const jsonLd: unknown[] = [];
  for (const el of allElements) {
    if (el.tagName !== 'script') continue;
    const type = (getAttr(el, 'type') ?? '').toLowerCase();
    if (type !== 'application/ld+json') continue;
    const text = readDirectText(el).trim();
    if (!text) continue;
    try {
      jsonLd.push(JSON.parse(text));
    } catch {
      // Could be a JSON-LD graph that isn't strict JSON; try to wrap in array.
      try {
        jsonLd.push(JSON.parse(`[${text}]`));
      } catch {
        /* drop unparseable block */
      }
    }
    if (jsonLd.length >= 20) break;
  }

  // ── semantic landmarks
  let hasMain = false,
    hasNav = false,
    hasHeader = false,
    hasFooter = false,
    hasArticle = false,
    hasAside = false;
  for (const el of allElements) {
    if (el.tagName === 'main') hasMain = true;
    else if (el.tagName === 'nav') hasNav = true;
    else if (el.tagName === 'header') hasHeader = true;
    else if (el.tagName === 'footer') hasFooter = true;
    else if (el.tagName === 'article') hasArticle = true;
    else if (el.tagName === 'aside') hasAside = true;
  }

  // ── visible text preview
  const visibleTextPreview = (body ? collapseText(body) : titleText)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

  // ── security headers
  const securityHeaders = readSecurityHeaders(f.headers);

  const data: SiteData = {
    url: f.finalUrl,
    finalUrl: f.finalUrl,
    fetchedAt: new Date().toISOString(),
    statusCode: f.statusCode,
    contentType: f.contentType,
    charset: extractCharset(f.contentType),
    htmlSizeBytes: f.bodyBytes.byteLength,
    htmlLang,
    metaTags: metaTags.slice(0, 60),
    linkTags: linkTags.slice(0, 60),
    hasViewport,
    hasCharset,
    headings: headings.slice(0, 200),
    images,
    internalLinkCount,
    externalLinkCount,
    scriptCount,
    externalScriptHosts,
    stylesheetCount,
    fontFamilies,
    iframeCount,
    formCount,
    inputCountWithoutLabel,
    inlineStyleCount,
    imagesWithoutAlt,
    imagesWithoutDims,
    jsonLd,
    hasMain,
    hasNav,
    hasHeader,
    hasFooter,
    hasArticle,
    hasAside,
    visibleTextPreview,
    securityHeaders,
    robotsTxt,
    llmsTxt,
    sitemapXml,
  };

  return SiteDataSchema.parse(data);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function collectMeta(head: Parse5Element) {
  const out: {
    name?: string;
    property?: string;
    content?: string;
    httpEquiv?: string;
    charset?: string;
  }[] = [];
  for (const child of head.childNodes as Parse5Node[]) {
    if (!isElement(child) || child.tagName !== 'meta') continue;
    const item: {
      name?: string;
      property?: string;
      content?: string;
      httpEquiv?: string;
      charset?: string;
    } = {};
    const name = getAttr(child, 'name');
    const property = getAttr(child, 'property');
    const content = getAttr(child, 'content');
    const httpEquiv = getAttr(child, 'http-equiv');
    const charset = getAttr(child, 'charset');
    if (name) item.name = name;
    if (property) item.property = property;
    if (content) item.content = content;
    if (httpEquiv) item.httpEquiv = httpEquiv;
    if (charset) item.charset = charset;
    out.push(item);
  }
  return out;
}

function collectLinks(head: Parse5Element) {
  const out: {
    rel?: string;
    href?: string;
    hreflang?: string;
    type?: string;
    sizes?: string;
    as?: string;
  }[] = [];
  for (const child of head.childNodes as Parse5Node[]) {
    if (!isElement(child) || child.tagName !== 'link') continue;
    const item: {
      rel?: string;
      href?: string;
      hreflang?: string;
      type?: string;
      sizes?: string;
      as?: string;
    } = {};
    const rel = getAttr(child, 'rel');
    const href = getAttr(child, 'href');
    const hreflang = getAttr(child, 'hreflang');
    const type = getAttr(child, 'type');
    const sizes = getAttr(child, 'sizes');
    const as = getAttr(child, 'as');
    if (rel) item.rel = rel;
    if (href) item.href = href;
    if (hreflang) item.hreflang = hreflang;
    if (type) item.type = type;
    if (sizes) item.sizes = sizes;
    if (as) item.as = as;
    out.push(item);
  }
  return out;
}

function readTitleText(head: Parse5Element): string {
  for (const child of head.childNodes as Parse5Node[]) {
    if (isElement(child) && child.tagName === 'title') {
      return collapseText(child).trim();
    }
  }
  return '';
}

function collectFontFamilies(els: Parse5Element[]): string[] {
  const families = new Set<string>();
  for (const el of els) {
    const style = getAttr(el, 'style');
    if (!style) continue;
    const m = style.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
    if (m) {
      const list = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''));
      for (const f of list) {
        if (f && f !== 'inherit') families.add(f);
        if (families.size >= 20) break;
      }
    }
    if (families.size >= 20) break;
  }
  return [...families];
}

function readSecurityHeaders(headers: Record<string, string>) {
  return {
    csp: !!headers['content-security-policy'],
    xFrameOptions: !!headers['x-frame-options'],
    hsts: !!headers['strict-transport-security'],
    referrerPolicy: !!headers['referrer-policy'],
    xContentTypeOptions: !!headers['x-content-type-options'],
    permissionsPolicy: !!headers['permissions-policy'],
  };
}

function extractCharset(contentType: string): string | null {
  const m = /charset=([^;]+)/i.exec(contentType);
  return m ? m[1].trim() : null;
}

// ─── parse5 minimal types (kept loose on purpose) ──────────────────────────

interface Parse5Node {
  nodeName: string;
  childNodes?: Parse5Node[];
  value?: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
}
interface Parse5Element extends Parse5Node {
  tagName: string;
  attrs: { name: string; value: string }[];
  childNodes: Parse5Node[];
}
interface Parse5Document extends Parse5Node {
  childNodes: Parse5Node[];
}

function isElement(n: Parse5Node): n is Parse5Element {
  return !!n.tagName;
}

function findChild(
  parent: Parse5Node,
  tagName: string
): Parse5Node | undefined {
  for (const c of parent.childNodes ?? []) {
    if (c.tagName === tagName) return c;
  }
  return undefined;
}

function walk(el: Parse5Node, visit: (n: Parse5Element) => void) {
  for (const c of el.childNodes ?? []) {
    if (isElement(c)) {
      visit(c);
      walk(c, visit);
    }
  }
}

function getAttr(el: Parse5Element, name: string): string | undefined {
  const a = (el.attrs ?? []).find((x) => x.name === name);
  return a?.value;
}

function readDirectText(el: Parse5Node): string {
  let s = '';
  for (const c of el.childNodes ?? []) {
    if (c.nodeName === '#text') s += c.value ?? '';
  }
  return s;
}

/** Concat all text content under an element, stripping tags. */
function collapseText(el: Parse5Node): string {
  let s = '';
  const stack: Parse5Node[] = [el];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.nodeName === '#text') s += cur.value ?? '';
    else if (cur.nodeName === 'script' || cur.nodeName === 'style') continue;
    else if (cur.childNodes) stack.push(...cur.childNodes);
  }
  return s;
}
