import { createFileRoute } from '@tanstack/react-router';

import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { getLocale, locales, localizeUrl } from '@/paraglide/runtime.js';
import { FilesGallery } from '@/blocks/files-gallery';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';

export const Route = createFileRoute('/files')({
  loader: () => {
    const locale = getLocale();
    return {
      locale,
      title: `${m['files.gallery.title']({}, { locale })} · ${envConfigs.app_name}`,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { locale, title } = loaderData;
    const urlFor = (loc: string) =>
      localizeUrl(`${envConfigs.app_url}/files`, { locale: loc as any }).href;

    return {
      meta: [{ title }],
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
  component: FilesPage,
});

function FilesPage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <FilesGallery />
      </main>
      <Footer />
    </div>
  );
}
