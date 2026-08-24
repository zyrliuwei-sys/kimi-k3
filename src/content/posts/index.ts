import type { ComponentType } from 'react';

import { baseLocale } from '@/paraglide/runtime.js';

/**
 * Local blog posts written as MDX files in this directory.
 * File naming: `<slug>.<locale>.mdx` (falls back to the base locale).
 * Register every local post slug here — it drives loading and the sitemap.
 *
 * This module is isomorphic (safe in client bundles). Database posts are
 * fetched through the server functions in ./server.ts and merged with the
 * local posts via the pure helpers below.
 */
export const BLOG_POST_SLUGS = [
  'ai-image-generator-guide',
  'ai-image-prompt-examples',
  'choosing-an-ai-image-generator',
  'kimi-k3-architecture-benchmarks',
  'kimi-k3-production-deployment',
  'kimi-k3-tutorial',
] as const;

export type BlogPostMeta = {
  title: string;
  description: string;
  created_at: string;
  author_name?: string;
  author_image?: string;
  image?: string;
};

type PostModule = {
  default: ComponentType;
  meta: BlogPostMeta;
  /** Optional structured data for rich results on a local article. */
  jsonLd?: unknown;
};

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  image?: string;
  /** ISO date string — serializable across loader/server-fn boundaries */
  createdAt: string;
  authorName?: string;
  authorImage?: string;
  source: 'local' | 'db';
};

export type BlogPostDetail = BlogPost & {
  /** Raw markdown — set for database posts */
  content?: string;
};

/**
 * Keep the editorial cards visually consistent if a translated MDX file has
 * not yet supplied its optional image metadata. The individual posts still
 * own their preferred cover through `meta.image`; these are presentation
 * fallbacks for the blog index only.
 */
const LOCAL_POST_VISUAL_FALLBACKS: Record<
  string,
  { image: string; authorImage: string }
> = {
  'ai-image-generator-guide': {
    image: '/imgs/generated/ai-image-generator-guide-cover-1787567297741.png',
    authorImage: '/logo.svg',
  },
  'ai-image-prompt-examples': {
    image: '/imgs/generated/ai-image-prompt-examples-cover-1787567384376.png',
    authorImage: '/logo.svg',
  },
  'choosing-an-ai-image-generator': {
    image:
      '/imgs/generated/choosing-ai-image-generator-cover-1787567465678.png',
    authorImage: '/logo.svg',
  },
  'kimi-k3-tutorial': {
    image: '/imgs/generated/kimi-k3-tutorial-cover-1787568652503.png',
    authorImage: '/logo.svg',
  },
};

// Eagerly bundle the local MDX posts (small markdown files), mirroring the
// static-pages pattern. Keys are absolute from the project root.
const postModules = import.meta.glob<PostModule>('/src/content/posts/*.mdx', {
  eager: true,
});

export function loadLocalPost(slug: string, locale: string): PostModule | null {
  if (!BLOG_POST_SLUGS.includes(slug as (typeof BLOG_POST_SLUGS)[number])) {
    return null;
  }
  return (
    postModules[`/src/content/posts/${slug}.${locale}.mdx`] ??
    postModules[`/src/content/posts/${slug}.${baseLocale}.mdx`] ??
    null
  );
}

function localPostToItem(slug: string, meta: BlogPostMeta): BlogPost {
  const visualFallback = LOCAL_POST_VISUAL_FALLBACKS[slug];

  return {
    slug,
    title: meta.title,
    description: meta.description,
    image: meta.image ?? visualFallback?.image,
    createdAt: new Date(meta.created_at).toISOString(),
    authorName: meta.author_name,
    authorImage: meta.author_image ?? visualFallback?.authorImage,
    source: 'local',
  };
}

export function getLocalPosts(locale: string): BlogPost[] {
  return BLOG_POST_SLUGS.map((slug) => ({
    slug: slug as string,
    mod: loadLocalPost(slug, locale),
  }))
    .filter((m): m is { slug: string; mod: PostModule } => m.mod !== null)
    .map(({ slug, mod }) => localPostToItem(slug, mod.meta));
}

/**
 * Merge database posts with local MDX posts, deduped by slug
 * (database wins), newest first.
 */
export function mergePosts(
  dbPosts: BlogPost[],
  localPosts: BlogPost[],
  options: { limit?: number } = {}
): BlogPost[] {
  const dbSlugs = new Set(dbPosts.map((p) => p.slug));
  const merged = [
    ...dbPosts,
    ...localPosts.filter((p) => !dbSlugs.has(p.slug)),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return options.limit ? merged.slice(0, options.limit) : merged;
}

export function formatPostDate(dateIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: locale === 'zh' ? 'long' : 'short',
    day: 'numeric',
  }).format(new Date(dateIso));
}
