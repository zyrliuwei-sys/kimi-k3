import { createFileRoute } from '@tanstack/react-router';

import { tDynamic } from '@/core/i18n/dynamic';
import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { getLocale, locales, localizeUrl } from '@/paraglide/runtime.js';
import { Assets } from '@/blocks/assets';
import { BuiltFor } from '@/blocks/built-for';
import { CTA } from '@/blocks/cta';
import { FAQ, FAQ_ITEMS } from '@/blocks/faq';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { Hero } from '@/blocks/hero';
import { Logos } from '@/blocks/logos';
import { Pricing } from '@/blocks/pricing';
import { Showcase } from '@/blocks/showcase';
import { Start } from '@/blocks/start';
import { Stats } from '@/blocks/stats';
import { SupportWidget } from '@/blocks/support-widget';

function HomePage() {
  const jsonLd = buildHomeJsonLd();
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main>
        <Hero />
        <Logos />
        <Assets />
        <Showcase />
        <Start />
        <BuiltFor />
        <Stats />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
      <SupportWidget />
    </div>
  );
}

function buildHomeJsonLd() {
  const url = envConfigs.app_url.replace(/\/$/, '');
  // FAQ items are shared with the FAQ UI (src/blocks/faq.tsx) so the
  // structured data and the rendered questions always match.
  const faqs = FAQ_ITEMS.map((key) => ({
    q: tDynamic(`landing.faq.${key}.question`),
    a: tDynamic(`landing.faq.${key}.answer`),
  }));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}/#organization`,
        name: 'kimik3',
        url,
        logo: `${url}/logo.svg`,
      },
      {
        '@type': 'WebSite',
        '@id': `${url}/#website`,
        url,
        name: 'kimik3',
        description: m['landing.meta.home_description'](),
        publisher: { '@id': `${url}/#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}/#webpage`,
        url,
        name: m['landing.meta.home_title'](),
        description: m['landing.meta.home_description'](),
        isPartOf: { '@id': `${url}/#website` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}/#faqpage`,
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

export const Route = createFileRoute('/')({
  loader: async () => {
    const locale = getLocale();
    return { locale };
  },
  head: ({ loaderData }) => {
    const locale = loaderData?.locale ?? 'en';
    // canonical / og:url use VITE_APP_URL. Route loaders in this TanStack
    // Start build don't receive the request, so we can't derive the host
    // here (sitemap.xml / robots.txt do, as server handlers). Set
    // VITE_APP_URL=https://www.kimik3.net in production for the homepage.
    const urlFor = (loc: string) =>
      localizeUrl(`${envConfigs.app_url}/`, { locale: loc as any }).href;
    const title = m['landing.meta.home_title']({}, { locale: locale as any });
    const description = m['landing.meta.home_description'](
      {},
      { locale: locale as any }
    );
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: urlFor(locale) },
        { name: 'twitter:title', content: title },
      ],
      links: [
        { rel: 'canonical', href: urlFor(locale) },
        ...locales.map((loc) => ({
          rel: 'alternate',
          hrefLang: loc,
          href: urlFor(loc),
        })),
        { rel: 'alternate', hrefLang: 'x-default', href: urlFor('en') },
      ],
    };
  },
  component: HomePage,
});
