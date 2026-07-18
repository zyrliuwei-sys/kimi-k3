import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Download } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { ComingSoon } from '@/components/coming-soon';
import { buttonVariants } from '@/components/ui/button';

export const Route = createFileRoute('/cheat-sheet')({
  loader: () => {
    const locale = getLocale();
    return {
      title: m['landing.cheat_sheet.title']({}, { locale }),
      description: m['landing.cheat_sheet.description']({}, { locale }),
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
  component: CheatSheetPage,
});

function CheatSheetPage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <ComingSoon
          eyebrow={m['landing.cheat_sheet.eyebrow']()}
          title={m['landing.cheat_sheet.title']()}
          description={m['landing.cheat_sheet.description']()}
          comingSoonLabel={m['common.coming_soon']()}
          backHomeLabel={m['common.back_home']()}
          icon={Download}
        >
          <Link
            href="/sign-up"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'brand-gradient mx-auto h-12 gap-2 rounded-full px-7 text-[15px] font-medium text-white hover:opacity-95'
            )}
          >
            {m['landing.cheat_sheet.notify']()}
            <ArrowRight className="size-4" />
          </Link>
        </ComingSoon>
      </main>
      <Footer />
    </div>
  );
}
