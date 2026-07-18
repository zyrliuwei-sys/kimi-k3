import { createFileRoute } from '@tanstack/react-router';

import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { ComparePricing } from '@/blocks/compare-pricing';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';

export const Route = createFileRoute('/compare')({
  loader: () => {
    const locale = getLocale();
    return {
      title: m['landing.compare.title']({}, { locale }),
      description: m['landing.compare.description']({}, { locale }),
    };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: loaderData.title },
          { name: 'description', content: loaderData.description },
        ]
      : [],
  }),
  component: ComparePage,
});

function ComparePage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <ComparePricing />
      </main>
      <Footer />
    </div>
  );
}
