import { m } from '@/paraglide/messages.js';
import { SiteHeader } from '@/components/site-header';

export function Header() {
  const navLinks = [
    { href: '/#showcase', label: m['landing.nav.features']() },
    { href: '/files', label: m['files.gallery.title']() },
    { href: '/pricing', label: m['landing.nav.pricing']() },
    { href: '/kimi-k3-1', label: m['landing.nav.kimi_k3_1']() },
    { href: '/#faq', label: m['landing.nav.faq']() },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
