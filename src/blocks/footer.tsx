import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { LocaleSelector } from '@/components/locale-selector';

interface FooterLink {
  label: string;
  href: string;
}

export function Footer() {
  const product: FooterLink[] = [
    { label: m['landing.footer.product_features'](), href: '/#showcase' },
    { label: m['landing.footer.product_pricing'](), href: '/pricing' },
    { label: m['landing.footer.product_teams'](), href: '/settings' },
    { label: m['landing.footer.product_apikeys'](), href: '/settings/apikeys' },
  ];
  const company: FooterLink[] = [
    { label: m['landing.footer.company_blog'](), href: '/blog' },
    { label: m['landing.footer.company_contact'](), href: '/tickets' },
    { label: m['landing.footer.company_privacy'](), href: '/privacy-policy' },
    { label: m['landing.footer.company_terms'](), href: '/terms-of-service' },
  ];
  const resources: FooterLink[] = [
    { label: m['landing.footer.resources_docs'](), href: '/#showcase' },
    { label: m['landing.footer.resources_changelog'](), href: '/blog' },
    { label: m['landing.footer.resources_status'](), href: '/' },
    { label: m['landing.footer.resources_signin'](), href: '/sign-in' },
  ];
  // SEO landing pages for common kimik3 misspellings — kept as raw keyword
  // labels (identical across locales) so each variant links to its page.
  const searches: FooterLink[] = [
    { label: 'kimink3', href: '/kimink3' },
    { label: 'kimik 3', href: '/kimik-3' },
    { label: 'kimika 3', href: '/kimika-3' },
    { label: 'kimmik3', href: '/kimmik3' },
  ];

  return (
    <footer className="relative overflow-hidden bg-neutral-950 px-4 py-10 text-neutral-300 md:px-8">
      <div className="mx-auto max-w-7xl">
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

          {/* Popular searches */}
          <div className="col-span-1">
            <h3 className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.col_searches']()}
            </h3>
            <ul className="mt-4 space-y-2">
              {searches.map((link) => (
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

          {/* Brand + locale */}
          <div className="col-span-2 mt-8 lg:col-span-3 lg:mt-0">
            <div className="flex items-center gap-2">
              <Link href="/" className="flex items-center gap-2">
                <img
                  src={envConfigs.app_logo}
                  alt={envConfigs.app_name}
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
              © {new Date().getFullYear()} anyany.{' '}
              {m['landing.footer.rights']()}
            </p>
            {/* SEO backlinks — restored (accidentally removed in dfcbbed).
                Badges are self-hosted under /badges so they don't depend on
                flaky external image hosts (media.theresanaiforthat.com was
                unreachable). The <a href> external links are what matter for
                SEO; the images are just decoration. */}
            <a
              href="https://tooldirs.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/tooldirs-badge.svg"
                alt="Featured on ToolDirs"
                width={170}
                height={54}
              />
            </a>
            <a
              href="https://theresanaiforthat.com/ai/kimik3-unofficial-guide/?ref=featured&v=7720459"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/taaft-badge.svg"
                alt="Featured on There's An AI For That"
                width={220}
                height={44}
              />
            </a>
            <a
              href="https://aijustbetter.com/item/kimik3.net"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/aijustbetter-badge.svg"
                alt="Featured on AIJustBetter.com"
                width={212}
                height={55}
              />
            </a>
            <a
              href="https://tinylaunch.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/tinylaunch-badge.svg"
                alt="Live on TinyLaunch"
                width={202}
                height={61}
              />
            </a>
            <a
              href="https://curlship.com/l/2225"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/curlship-badge.svg"
                alt="Listed on CurlShip"
                width={200}
                height={44}
              />
            </a>
            <a
              href="https://startupfa.st"
              target="_blank"
              rel="noopener noreferrer"
              title="Powered by Startup Fast"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/startupfast-badge.svg"
                alt="Powered by Startup Fast"
                width={150}
                height={44}
              />
            </a>
            <a
              href="https://www.peterindia.net"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/peterindia-badge.gif"
                alt="PeterIndia — IT Knowledge Portal"
                width={200}
                height={26}
              />
            </a>
            <a
              href="https://showmebest.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/showmebestai-badge.webp"
                alt="Featured on ShowMeBestAI"
                width={220}
                height={60}
              />
            </a>
            <a
              href="https://saasgrow.app?ref=kimik3.net"
              target="_blank"
              rel="noopener"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/saasgrow-badge.svg"
                alt="kimik3 on SaaSGrow"
                width={240}
                height={54}
              />
            </a>
            <a
              href="https://twelve.tools"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/twelvetools-badge.svg"
                alt="Featured on Twelve Tools"
                width={200}
                height={54}
              />
            </a>
            <a
              href="https://mossai.org"
              target="_blank"
              rel="noopener noreferrer"
              title="MossAI Tools"
              className="inline-flex h-[44px] items-center justify-center rounded-md border border-neutral-700 px-4 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-500 hover:text-neutral-100"
            >
              MossAI Tools
            </a>
            <a
              href="https://topaitoolsreview.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block transition-opacity hover:opacity-80"
            >
              <img
                src="/badges/topaitoolsreview-badge.svg"
                alt="Featured on TopAIToolsReview"
                width={200}
                height={50}
              />
            </a>
          </div>
          <LocaleSelector
            variant="pill"
            className="border-neutral-700 text-neutral-300 hover:bg-white/5 hover:text-neutral-100"
          />
        </div>
      </div>

      {/* Big brand text — decorative, fades at the bottom */}
      <div className="pointer-events-none relative mx-auto -mb-[11%] flex max-w-[1080px] items-center justify-center gap-2 px-4 pb-2 text-center text-[6rem] leading-none font-bold text-neutral-900 duration-200 ease-in-out sm:-mb-[7%] sm:text-[14rem] md:text-[11rem] lg:text-[14rem] xl:text-[20rem]">
        <div className="animate-[pulse_4s_infinite] text-neutral-900 drop-shadow-xl drop-shadow-black/10">
          anyany
        </div>
        <div className="absolute bottom-0 left-0 z-20 h-[20%] w-full bg-linear-to-b from-transparent via-neutral-950 to-neutral-950"></div>
      </div>
    </footer>
  );
}
