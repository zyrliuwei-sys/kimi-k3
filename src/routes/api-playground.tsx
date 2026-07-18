import { createFileRoute } from '@tanstack/react-router';
import { Terminal } from 'lucide-react';

import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { ComingSoon } from '@/components/coming-soon';

export const Route = createFileRoute('/api-playground')({
  loader: () => {
    const locale = getLocale();
    return {
      title: m['landing.api_playground.title']({}, { locale }),
      description: m['landing.api_playground.description']({}, { locale }),
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
  component: ApiPlaygroundPage,
});

function ApiPlaygroundPage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <ComingSoon
          eyebrow={m['landing.api_playground.eyebrow']()}
          title={m['landing.api_playground.title']()}
          description={m['landing.api_playground.description']()}
          comingSoonLabel={m['common.coming_soon']()}
          backHomeLabel={m['common.back_home']()}
          icon={Terminal}
        />
      </main>
      <Footer />
    </div>
  );
}
