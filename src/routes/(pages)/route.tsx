import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router';
import { MDXProvider } from '@mdx-js/react';
import { ArrowLeft } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { mdxComponents } from '@/components/mdx-components';

export const Route = createFileRoute('/(pages)')({
  component: PagesLayout,
});

function PagesLayout() {
  const guideLayout = useMatches().some(
    ({ loaderData }) =>
      loaderData &&
      typeof loaderData === 'object' &&
      'presentation' in loaderData &&
      loaderData.presentation === 'guide'
  );
  return (
    <div
      className={cn(
        'bg-background text-foreground flex min-h-screen flex-col',
        guideLayout && 'model-guide-page'
      )}
    >
      <Header />
      <main className="flex-1">
        <div
          className={cn(
            'mx-auto px-6 pt-10 md:px-8',
            guideLayout ? 'max-w-6xl' : 'max-w-3xl'
          )}
        >
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="size-4" />
            {m['common.pages.back_to_home']()}
          </Link>
        </div>
        <div
          className={cn(
            'mx-auto px-6 pt-6 pb-16 md:px-8 md:pt-8 md:pb-24',
            guideLayout ? 'max-w-6xl' : 'max-w-3xl'
          )}
        >
          <MDXProvider components={mdxComponents}>
            <Outlet />
          </MDXProvider>
        </div>
      </main>
      <Footer />
    </div>
  );
}
