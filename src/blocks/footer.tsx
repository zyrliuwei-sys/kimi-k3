import { ArrowRight } from 'lucide-react';

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
    { label: m['landing.footer.product_features'](), href: '/#features' },
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
    { label: m['landing.footer.resources_docs'](), href: '/#features' },
    { label: m['landing.footer.resources_changelog'](), href: '/blog' },
    { label: m['landing.footer.resources_status'](), href: '/' },
    { label: m['landing.footer.resources_signin'](), href: '/sign-in' },
  ];

  return (
    <footer className="bg-neutral-950 text-neutral-300">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr]">
          {/* brand + newsletter */}
          <div className="lg:pr-6">
            <Link href="/" className="flex items-center gap-2">
              <img
                src={envConfigs.app_logo}
                alt={envConfigs.app_name}
                className="size-7 rounded-lg"
              />
              <span className="text-base font-semibold text-neutral-50">
                {envConfigs.app_name}
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-neutral-400">
              {m['landing.footer.tagline']()}
            </p>
          </div>

          <FooterCol
            title={m['landing.footer.col_product']()}
            links={product}
          />
          <FooterCol
            title={m['landing.footer.col_company']()}
            links={company}
          />
          <FooterCol
            title={m['landing.footer.col_resources']()}
            links={resources}
          />

          {/* newsletter */}
          <div>
            <p className="text-sm font-semibold text-neutral-100">
              {m['landing.footer.newsletter_title']()}
            </p>
            <p className="mt-3 text-sm text-neutral-400">
              {m['landing.footer.newsletter_desc']()}
            </p>
            <form
              className="mt-4 flex items-center gap-2"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="email"
                placeholder={m['landing.footer.newsletter_placeholder']()}
                className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
              />
              <button
                type="submit"
                aria-label={m['landing.footer.newsletter_button']()}
                className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-lg text-white"
              >
                <ArrowRight className="size-4" />
              </button>
            </form>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-neutral-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-neutral-500">
            © {new Date().getFullYear()} {envConfigs.app_name}.{' '}
            {m['landing.footer.rights']()}
          </span>
          <LocaleSelector
            variant="pill"
            className="border-neutral-700 text-neutral-300 hover:bg-white/5 hover:text-neutral-100"
          />
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-neutral-100">{title}</p>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
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
  );
}
