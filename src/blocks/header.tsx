import { m } from '@/paraglide/messages.js';
import { SiteHeader } from '@/components/site-header';

export function Header() {
  const navLinks = [
    { href: '/#showcase', label: m['landing.nav.features']() },
    { href: '/pricing', label: m['landing.nav.pricing']() },
    { href: '/#faq', label: m['landing.nav.faq']() },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
