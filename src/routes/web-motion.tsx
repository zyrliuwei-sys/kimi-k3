import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Header } from '@/blocks/header';
import { WebMotion } from '@/blocks/web-motion';

export const Route = createFileRoute('/web-motion')({
  loader: () => {
    const locale = getLocale();
    return { title: m['web_motion.title']({}, { locale }) };
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: loaderData.title }] : [],
  }),
  component: WebMotionPage,
});

function WebMotionPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      router.push(`/sign-in?callbackUrl=${encodeURIComponent('/web-motion')}`);
    }
  }, [isPending, session, router]);

  if (isPending || !session?.user) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <Header />
      <main>
        <WebMotion />
      </main>
    </div>
  );
}
