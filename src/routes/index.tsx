import { createFileRoute } from '@tanstack/react-router';

import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { getLocale, locales, localizeUrl } from '@/paraglide/runtime.js';
import { AboutKimik3 } from '@/blocks/about-kimik3';
import { Assets } from '@/blocks/assets';
import { BuiltFor } from '@/blocks/built-for';
import { CTA } from '@/blocks/cta';
import { FAQ } from '@/blocks/faq';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { Hero } from '@/blocks/hero';
import { Logos } from '@/blocks/logos';
import { Pricing } from '@/blocks/pricing';
import { Start } from '@/blocks/start';
import { Stats } from '@/blocks/stats';
import { SupportWidget } from '@/blocks/support-widget';
import { TryKimik3 } from '@/blocks/try-kimik3';
import { VFeatures } from '@/blocks/vfeatures';

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
        <TryKimik3 />
        <Logos />
        <Assets />
        <Start />
        <BuiltFor />
        <Stats />
        <VFeatures />
        <AboutKimik3 />
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
  const faqs = [
    {
      q: m['landing.faq.stack.question'](),
      a: m['landing.faq.stack.answer'](),
    },
    {
      q: m['landing.faq.payment.question'](),
      a: m['landing.faq.payment.answer'](),
    },
    {
      q: m['landing.faq.database.question'](),
      a: m['landing.faq.database.answer'](),
    },
    {
      q: m['landing.faq.customize.question'](),
      a: m['landing.faq.customize.answer'](),
    },
    {
      q: m['landing.faq.license.question'](),
      a: m['landing.faq.license.answer'](),
    },
  ];
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
