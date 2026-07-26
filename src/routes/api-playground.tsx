import { createFileRoute } from '@tanstack/react-router';

import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { ApiPlayground } from '@/blocks/api-playground';
import { Header } from '@/blocks/header';

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
    <div className="bg-background text-foreground flex min-h-[100dvh] flex-col">
      <Header />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <ApiPlayground />
      </main>
    </div>
  );
}
