import { Facebook, Github, Instagram, Linkedin, Twitter } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';

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
function Badge({
  b,
  decorative = false,
}: {
  b: BadgeEntry;
  /** Duplicate marquee entries remain visual-only, so keyboard users don't
   *  encounter the same external links twice. */
  decorative?: boolean;
}) {
  const rel = 'nofollow noopener noreferrer';
  if (b.label) {
    return (
      <a
        href={b.href}
        target="_blank"
        rel={rel}
        title={b.title}
        aria-hidden={decorative || undefined}
        tabIndex={decorative ? -1 : undefined}
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
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
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
  const nav = [
    { label: m['landing.footer.product_pricing'](), href: '/pricing' },
    { label: m['landing.footer.company_blog'](), href: '/blog' },
    { label: m['landing.footer.company_privacy'](), href: '/privacy-policy' },
    { label: m['landing.footer.company_terms'](), href: '/terms-of-service' },
  ];
  const socials = [
    { label: 'Twitter', icon: Twitter, href: 'https://twitter.com' },
    { label: 'LinkedIn', icon: Linkedin, href: 'https://linkedin.com' },
    { label: 'GitHub', icon: Github, href: 'https://github.com' },
    { label: 'Facebook', icon: Facebook, href: 'https://facebook.com' },
    { label: 'Instagram', icon: Instagram, href: 'https://instagram.com' },
  ];

  return (
    <footer className="relative w-full overflow-hidden border-t border-neutral-800 bg-neutral-950 px-6 pt-14 text-neutral-400 sm:px-10 sm:pt-16">
      <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
        <Link href="/" className="mb-5 inline-flex items-center gap-2">
          <img
            src={envConfigs.app_logo}
            alt="kimik3"
            width={30}
            height={30}
            className="size-7 rounded-lg"
          />
          <span className="text-base font-semibold tracking-tight text-white">
            kimik3
          </span>
        </Link>
        <p className="max-w-xl text-sm leading-6 text-neutral-400">
          {m['landing.footer.tagline']()}
        </p>

        <nav className="mt-7 flex flex-wrap justify-center gap-x-7 gap-y-3 text-sm text-neutral-300">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-8 h-px w-full bg-white/10" />

        <div className="mt-7 flex w-full flex-col items-center justify-between gap-5 text-base sm:flex-row">
          <p className="text-neutral-400">
            © {new Date().getFullYear()} kimik3 Team.{' '}
            {m['landing.footer.rights']()}
          </p>
          <div className="flex items-center gap-4">
            {socials.map(({ label, icon: Icon, href }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              >
                <Icon className="size-5" />
              </a>
            ))}
          </div>
        </div>

        <div className="pointer-events-none mt-12 w-full overflow-hidden text-center text-[clamp(4rem,16vw,13rem)] leading-[0.78] font-semibold tracking-[-0.08em] text-white/[0.08] select-none">
          KIMIK3
        </div>
      </div>
    </footer>
  );
}
