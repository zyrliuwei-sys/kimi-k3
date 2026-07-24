import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { m } from '@/paraglide/messages.js';
import { AuthIllustration } from '@/components/login/auth-illustration';

/**
 * 2-column sign-in shell:
 *
 *   mobile (< md)  : single column, form only, illustration hidden.
 *   desktop (md+)  : form on the left, MeshGradient illustration on the right.
 *
 * The form child (typically <SignInForm />) is the only required prop — the
 * illustration content comes from i18n here so the page owner only has to
 * drop in <SignInShell>…</SignInShell>.
 */

type SignInShellProps = {
  children: React.ReactNode;
  appName: string;
};

export function SignInShell({ children, appName }: SignInShellProps) {
  const badges = [
    m['auth.signin.badges.0'](),
    m['auth.signin.badges.1'](),
    m['auth.signin.badges.2'](),
  ];

  return (
    <div className="bg-muted text-foreground flex min-h-svh w-full items-stretch justify-center p-0 md:items-center md:p-6">
      <div className="bg-background grid w-full max-w-6xl grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:rounded-3xl md:border md:shadow-[0_32px_80px_-40px_rgba(13,11,8,0.25)]">
        {/* Left column — form. */}
        <div className="flex flex-col gap-8 p-6 sm:p-10 md:p-12">
          <Link
            href="/"
            className="text-foreground/80 hover:text-foreground self-start text-sm font-semibold tracking-tight transition-colors"
          >
            {appName || envConfigs.app_name}
          </Link>

          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-7">
              <header className="flex flex-col gap-2 text-left">
                <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
                  {m['auth.signin.heading']()}
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {m['auth.signin.subheading']()}
                </p>
              </header>
              {children}
            </div>
          </div>
        </div>

        {/* Right column — decorative illustration. */}
        <AuthIllustration
          heading={m['auth.signin.side.heading']()}
          subheading={m['auth.signin.side.subheading']()}
          badges={badges}
          testimonial={{
            quote: m['auth.signin.testimonial.quote'](),
            author: m['auth.signin.testimonial.author'](),
            company: m['auth.signin.testimonial.company'](),
          }}
        />
      </div>
    </div>
  );
}
