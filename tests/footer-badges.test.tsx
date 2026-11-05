import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';

import { FooterBadgeLink } from '../src/components/footer-badge-link';
import { FooterBadgeList } from '../src/components/footer-badge-list';
import {
  parseStoredFooterBadges,
  validateFooterBadges,
} from '../src/features/footer-badges/validation';

const image = {
  href: 'https://launchai.tools',
  src: 'https://launchai.tools/badge.svg',
  alt: 'Featured',
};
test('provider verification metadata survives persistence and server rendering', () => {
  const saved = validateFooterBadges([
    {
      ...image,
      attributes: {
        'data-launchai-badge': 'featured',
        'aria-label': 'Featured on LaunchAI',
        title: 'LaunchAI',
      },
      imageAttributes: { 'data-badge': 'official' },
    },
  ]);
  const [badge] = parseStoredFooterBadges(JSON.stringify(saved));
  const html = renderToStaticMarkup(<FooterBadgeLink badge={badge} />);
  assert.match(html, /data-launchai-badge="featured"/);
  assert.match(html, /aria-label="Featured on LaunchAI"/);
  assert.match(html, /data-badge="official"/);
  assert.match(html, /href="https:\/\/launchai.tools\/"/);
});
test('text-only reciprocal links remain visible and preserve qualified rel', () => {
  const [badge] = validateFooterBadges([
    {
      href: 'https://example.com',
      text: 'AI tools',
      alt: 'AI tools',
      rel: 'nofollow sponsored',
    },
  ]);
  const html = renderToStaticMarkup(<FooterBadgeLink badge={badge} />);
  assert.match(html, />AI tools<\/a>/);
  assert.match(html, /rel="noopener noreferrer nofollow sponsored"/);
  assert.doesNotMatch(html, /<img/);
});
test('untrusted metadata cannot become executable props or override links', () => {
  for (const key of [
    'onClick',
    'onclick',
    'style',
    'href',
    'src',
    'dangerouslySetInnerHTML',
    '__proto__',
  ]) {
    assert.throws(() =>
      validateFooterBadges([{ ...image, attributes: { [key]: 'bad' } }])
    );
    assert.throws(() =>
      validateFooterBadges([{ ...image, imageAttributes: { [key]: 'bad' } }])
    );
  }
  for (const href of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:pass@example.com',
  ])
    assert.throws(() => validateFooterBadges([{ ...image, href }]));
});
test('bad legacy records do not erase valid badges; new saves are strict', () => {
  const invalid = { ...image, src: 'javascript:bad' };
  assert.equal(
    parseStoredFooterBadges(JSON.stringify([image, invalid, image])).length,
    2
  );
  assert.throws(() => validateFooterBadges([image, invalid]));
  assert.equal(parseStoredFooterBadges('{broken').length, 0);
});
test('labels are escaped and hidden marquee duplicates are not tabbable', () => {
  const [badge] = validateFooterBadges([
    {
      href: 'https://example.com',
      text: '<script>bad()</script>',
      alt: 'A',
      attributes: { title: '" onclick="bad' },
    },
  ]);
  const html = renderToStaticMarkup(<FooterBadgeLink badge={badge} hidden />);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-hidden="true"/);
});

test('the site badge list renders saved verification links before client config loads', async () => {
  const badges = validateFooterBadges([
    {
      href: 'https://directory.example.test/',
      text: 'Official directory',
      alt: 'Official directory',
      attributes: { 'data-proof': 'verified' },
    },
  ]);
  const root = createRootRoute({
    loader: () => ({ footerBadges: JSON.stringify(badges) }),
    component: FooterBadgeList,
  });
  const index = createRoute({ getParentRoute: () => root, path: '/' });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: true,
  });
  const query = new QueryClient();
  try {
    await router.load();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={query}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    assert.match(html, /href="https:\/\/directory.example.test\/"/);
    assert.match(html, /data-proof="verified"/);
    assert.match(html, />Official directory<\/a>/);
  } finally {
    query.clear();
  }
});
