import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { getLocalPosts, mergePosts } from '@/content/posts';

interface BadgeEntry {
  href: string;
  /** Inline-render as a bordered text button (no image) — used for
   *  directories that don't ship a hosted badge image. */
  label?: string;
  img?: { src: string; alt: string; width: number; height?: number };
  /** Title attribute on the <a> — appears as tooltip on hover. */
  title?: string;
}

/**
 * Directory badges are a single, optional discovery row in the footer.
 * They are deliberately non-promotional external links; the images are
 * decorative and lazy-loaded so they never compete with page content.
 */
const FOOTER_BADGES: BadgeEntry[] = [
  {
    href: 'https://tooldirs.com',
    img: {
      src: '/badges/tooldirs-badge.svg',
      alt: 'Featured on ToolDirs',
      width: 170,
      height: 54,
    },
  },
  {
    href: 'https://theresanaiforthat.com/ai/kimik3-unofficial-guide/?ref=featured&v=7720459',
    img: {
      src: '/badges/taaft-badge.svg',
      alt: "Featured on There's An AI For That",
      width: 220,
      height: 44,
    },
  },
  {
    href: 'https://aijustbetter.com/item/kimik3.net',
    img: {
      src: '/badges/aijustbetter-badge.svg',
      alt: 'Featured on AIJustBetter.com',
      width: 212,
      height: 55,
    },
  },
  {
    href: 'https://tinylaunch.com',
    img: {
      src: '/badges/tinylaunch-badge.svg',
      alt: 'Live on TinyLaunch',
      width: 202,
      height: 61,
    },
  },
  {
    href: 'https://curlship.com/l/2225',
    img: {
      src: '/badges/curlship-badge.svg',
      alt: 'Listed on CurlShip',
      width: 200,
      height: 44,
    },
  },
  {
    href: 'https://saasgrow.app?ref=kimik3.net',
    img: {
      src: '/badges/saasgrow-badge.svg',
      alt: 'kimik3 on SaaSGrow',
      width: 240,
      height: 54,
    },
  },
  {
    href: 'https://startupfa.st',
    title: 'Powered by Startup Fast',
    img: {
      src: '/badges/startupfast-badge.svg',
      alt: 'Powered by Startup Fast',
      width: 150,
      height: 44,
    },
  },
  {
    href: 'https://www.peterindia.net',
    img: {
      src: '/badges/peterindia-badge.gif',
      alt: 'PeterIndia — IT Knowledge Portal',
      width: 200,
      height: 26,
    },
  },
  {
    href: 'https://showmebest.ai',
    img: {
      src: 'https://showmebest.ai/badge/feature-badge-dark.webp',
      alt: 'Featured on ShowMeBestAI',
      width: 220,
      height: 60,
    },
  },
  {
    href: 'https://www.seewhatnewai.com',
    title: 'SeeWhatsNewAI',
    label: 'SeeWhatsNewAI',
  },
  {
    href: 'https://uno.directory',
    img: {
      src: '/badges/uno-directory-badge.svg',
      alt: 'Listed on Uno Directory',
      width: 120,
      height: 30,
    },
  },
  {
    href: 'https://aiextension.ai/kimik3',
    img: {
      src: '/badges/aiextension-badge.svg',
      alt: 'Featured on AIExtension.ai',
      width: 200,
      height: 54,
    },
  },
  {
    href: 'https://wayfindio.com',
    img: {
      src: '/badges/wayfindio-badge.svg',
      alt: 'Featured on Wayfindio',
      width: 200,
      height: 54,
    },
  },
  {
    href: 'https://toolfame.com/item/kimik3',
    img: {
      src: '/badges/toolfame-badge.svg',
      alt: 'Featured on toolfame.com',
      width: 160,
      height: 54,
    },
  },
  {
    href: 'https://toolfame.com/item/kimik3',
    img: {
      src: '/badges/toolfame-badge-dark.svg',
      alt: 'Featured on toolfame.com',
      width: 160,
      height: 54,
    },
  },
  {
    href: 'https://findly.tools/kimik3?utm_source=kimik3',
    img: {
      src: '/badges/findly-tools-badge.svg',
      alt: 'Featured on Findly.tools',
      width: 175,
      height: 55,
    },
  },
  {
    href: 'https://firsto.co/projects/kimik3',
    title: 'Featured on Firsto: kimik3',
    img: {
      src: '/badges/firsto-badge.svg',
      alt: 'Featured on Firsto: kimik3',
      width: 111,
      height: 42,
    },
  },
  {
    href: 'https://twelve.tools',
    img: {
      src: '/badges/twelvetools-badge.svg',
      alt: 'Featured on Twelve Tools',
      width: 200,
      height: 54,
    },
  },
  {
    href: 'https://mossai.org',
    title: 'MossAI Tools',
    label: 'MossAI Tools',
  },
  {
    href: 'https://collectai.tools/item/liuwei',
    img: {
      src: '/badges/collectai-badge.svg',
      alt: 'Listed on CollectAI',
      width: 220,
      height: 40,
    },
  },
  {
    href: 'https://topaitoolsreview.com',
    img: {
      src: '/badges/topaitoolsreview-badge.svg',
      alt: 'Featured on TopAIToolsReview',
      width: 200,
      height: 50,
    },
  },
  {
    href: 'https://www.uneed.best/tool/kimik3',
    img: {
      src: 'https://www.uneed.best/EMBED3.png',
      alt: 'Launching Soon on Uneed',
      width: 250,
      height: 54,
    },
  },
  {
    href: 'https://aiagentsdirectory.com/agent/kimik3',
    title: 'Discover kimik3 on AI Agents Directory',
    img: {
      src: 'https://aiagentsdirectory.com/featured-badge.svg?v=2024',
      alt: 'kimik3 - Featured on AI Agents Directory',
      width: 200,
      height: 50,
    },
  },
  {
    href: 'https://www.stork.ai/',
    title: 'Stork Verified — stork.ai AI tools directory',
    img: {
      src: 'https://www.stork.ai/badge/verified-dark.svg',
      alt: 'Stork Verified — stork.ai AI tools directory',
      width: 216,
      height: 44,
    },
  },
  {
    href: 'https://lovableapp.org',
    img: {
      src: 'https://lovableapp.org/lovable-app-badge.svg',
      alt: 'Lovable App Badge',
      width: 160,
    },
  },
  {
    href: 'https://curateclick.com?utm_source=embed-badge&utm_medium=embed&utm_campaign=embed-badge',
    img: {
      src: 'https://curateclick.com/featured-badge.svg',
      alt: 'Featured on CurateClick',
      width: 175,
      height: 54,
    },
  },
  {
    href: 'https://www.launchvault.dev',
    title: 'Featured on LaunchVault',
    img: {
      src: 'https://www.launchvault.dev/images/badges/launch-valut-badge.svg',
      alt: 'Featured on LaunchVault',
      width: 195,
      height: 62,
    },
  },
  {
    href: 'https://famed.tools/products/kimik3?utm_source=famed.tools',
    img: {
      src: 'https://famed.tools/badges/famed-tools-badge-dark.svg',
      alt: 'Featured on famed.tools',
      width: 150,
    },
  },
  {
    href: 'https://deeplaunch.io',
    img: {
      src: 'https://deeplaunch.io/badge/badge_dark.svg',
      alt: 'Featured on DeepLaunch.io',
      width: 200,
      height: 54,
    },
  },
];

/**
 * Render one badge as an <a>. Image-backed badges get a hover-fade; the
 * text-button fallback (no hosted image) gets a bordered chip so it
 * still reads as a badge in the marquee.
 */
function Badge({ b }: { b: BadgeEntry }) {
  const rel = 'nofollow noopener noreferrer';
  if (b.label) {
    return (
      <a
        href={b.href}
        target="_blank"
        rel={rel}
        title={b.title}
        className="inline-flex h-[44px] shrink-0 items-center justify-center rounded-md border border-neutral-700 px-4 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-500 hover:text-neutral-100"
      >
        {b.label}
      </a>
    );
  }
  return (
    <a
      href={b.href}
      target="_blank"
      rel={rel}
      title={b.title}
      className="inline-block shrink-0 transition-opacity hover:opacity-80"
    >
      <img
        src={b.img!.src}
        alt={b.img!.alt}
        width={b.img!.width}
        height={b.img!.height}
        loading="lazy"
        decoding="async"
      />
    </a>
  );
}

interface FooterLink {
  label: string;
  href: string;
  /**
   * When true, render as a raw `<a>` instead of the locale-aware Link.
   * Used for `mailto:` and any other URL schemes the i18n router
   * shouldn't touch. Anchor attributes on the rendered element are
   * forwarded via `externalProps` so callers can pass `target`,
   * `rel`, `className`, etc.
   */
  external?: boolean;
  externalProps?: React.AnchorHTMLAttributes<HTMLAnchorElement>;
}

export function Footer() {
  const product: FooterLink[] = [
    { label: m['landing.footer.product_features'](), href: '/#showcase' },
    { label: m['landing.footer.product_pricing'](), href: '/pricing' },
    { label: m['landing.footer.product_teams'](), href: '/settings' },
    { label: m['landing.footer.product_apikeys'](), href: '/settings/apikeys' },
  ];
  // Contact is a `mailto:` so the user's mail client opens with a
  // pre-filled subject — gives them a one-click way to reach a human
  // without leaving the page (or setting up a /tickets inbox).
  // Kept external so the locale router doesn't try to localize the
  // mailto: scheme.
  const contactEmail = 'zyrliuwei@gmail.com';
  const contactSubject = encodeURIComponent('kimik3 — Contact');
  const company: FooterLink[] = [
    { label: m['landing.footer.company_blog'](), href: '/blog' },
    {
      label: m['landing.footer.company_contact'](),
      href: `mailto:${contactEmail}?subject=${contactSubject}`,
      external: true,
    },
    { label: m['landing.footer.company_privacy'](), href: '/privacy-policy' },
    { label: m['landing.footer.company_terms'](), href: '/terms-of-service' },
  ];
  const resources: FooterLink[] = [
    { label: m['landing.footer.resources_docs'](), href: '/#showcase' },
    { label: m['landing.footer.resources_changelog'](), href: '/blog' },
    { label: m['landing.footer.resources_status'](), href: '/' },
    { label: m['landing.footer.resources_signin'](), href: '/sign-in' },
  ];
  // Localized blog directory: show the most recent posts as a quick
  // discovery surface. Local MDX posts are bundled (isomorphic helper),
  // so we sort newest-first and cap at 4 to keep the column compact.
  // Database-authored posts are reachable via /blog.
  const recentPosts = mergePosts([], getLocalPosts(getLocale()), {
    limit: 4,
  });

  return (
    <footer className="relative overflow-hidden bg-neutral-950 px-4 py-10 text-neutral-300 md:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Render each directory badge once. The row scrolls manually on
            narrow screens instead of duplicating links for a CSS marquee. */}
        <div className="-mx-4 mb-12 overflow-x-auto pb-2 md:-mx-8">
          <div className="flex w-max items-center gap-6 px-4 md:px-8">
            {FOOTER_BADGES.map((b, i) => (
              <Badge key={`${b.href}-${i}`} b={b} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-7">
          {/* Product */}
          <div className="col-span-1">
            <h3 className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.col_product']()}
            </h3>
            <ul className="mt-4 space-y-2">
              {product.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div className="col-span-1">
            <h3 className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.col_company']()}
            </h3>
            <ul className="mt-4 space-y-2">
              {company.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    // Raw anchor for `mailto:` / external schemes —
                    // the locale-aware Link would mangle them by
                    // trying to prepend a locale prefix.
                    <a
                      href={link.href}
                      className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                      {...link.externalProps}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div className="col-span-1">
            <h3 className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.col_resources']()}
            </h3>
            <ul className="mt-4 space-y-2">
              {resources.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Blog directory */}
          <div className="col-span-1">
            <h3 className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.col_blog']()}
            </h3>
            <ul className="mt-4 space-y-2">
              {recentPosts.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="line-clamp-2 text-sm break-words text-neutral-400 transition-colors hover:text-neutral-100"
                  >
                    {post.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/blog"
                  className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                >
                  {m['landing.footer.view_all']()}
                </Link>
              </li>
            </ul>
          </div>

          {/* Brand + locale */}
          <div className="col-span-2 mt-8 lg:col-span-3 lg:mt-0">
            <div className="flex items-center gap-2">
              <Link href="/" className="flex items-center gap-2">
                <img
                  src={envConfigs.app_logo}
                  alt="kimik3"
                  width={32}
                  height={32}
                  className="size-8 rounded-lg"
                />
                <span className="text-lg font-bold text-neutral-100">
                  kimik3
                </span>
              </Link>
            </div>
            <p className="mt-4 max-w-md text-left text-sm text-neutral-400">
              {m['landing.footer.tagline']()}
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-neutral-800 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <p className="text-sm text-neutral-500">
              © {new Date().getFullYear()} kimik3 Team.{' '}
              {m['landing.footer.rights']()}
            </p>
          </div>
        </div>
      </div>

      {/* Big brand text — decorative, fades at the bottom */}
      <div className="pointer-events-none relative mx-auto -mb-[11%] flex max-w-[1080px] items-center justify-center gap-2 px-4 pb-2 text-center text-[6rem] leading-none font-bold text-neutral-900 duration-200 ease-in-out sm:-mb-[7%] sm:text-[14rem] md:text-[11rem] lg:text-[14rem] xl:text-[20rem]">
        <div className="animate-[pulse_4s_infinite] text-neutral-900 drop-shadow-xl drop-shadow-black/10">
          kimik3 Team
        </div>
        <div className="absolute bottom-0 left-0 z-20 h-[20%] w-full bg-linear-to-b from-transparent via-neutral-950 to-neutral-950"></div>
      </div>
    </footer>
  );
}
