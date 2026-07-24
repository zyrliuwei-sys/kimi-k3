import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { usePublicConfig } from '@/hooks/use-public-config';
import { SignInForm } from '@/components/login/sign-in-form';
import { SignInShell } from '@/components/login/sign-in-shell';

/**
 * /sign-in route. The page body lives in <SignInShell> + <SignInForm>;
 * this file owns the route-level concerns:
 *   • session guard (already signed in → push home)
 *   • URL search parsing (redirect / callbackUrl)
 *   • same-site + non-auth-path validation of the callback
 *   • public config read (email/social/password-reset toggles)
 *
 * `navigatingRef` is set immediately before any push/assign so the already-
 * signed-in effect doesn't double-fire on the same navigation.
 */
function SignInPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  // Set right before we navigate so the already-signed-in effect doesn't also fire.
  const navigatingRef = useRef(false);

  // redirect: client protocol, goes through auth-callback
  // callbackUrl: web page URL, goes directly after login
  const [redirectParam, setRedirectParam] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectParam(params.get('redirect'));
    setCallbackUrl(params.get('callbackUrl'));
  }, []);

  // Already signed in (visited /sign-in directly, or a stale callbackUrl looped
  // back here) → go home. The auth pages never gate themselves, so this can't loop.
  useEffect(() => {
    if (sessionPending || navigatingRef.current) return;
    if (session?.user) {
      navigatingRef.current = true;
      router.push('/');
    }
  }, [sessionPending, session?.user, router]);

  // Allow only same-site relative paths, and never an auth page (would loop).
  const safeCallbackUrl =
    callbackUrl &&
    callbackUrl.startsWith('/') &&
    !callbackUrl.startsWith('//') &&
    !/^\/(sign-in|sign-up|verify-email)(\/|\?|$)/.test(callbackUrl)
      ? callbackUrl
      : null;

  const afterLoginUrl = redirectParam
    ? `/auth-callback?redirect=${encodeURIComponent(redirectParam)}`
    : safeCallbackUrl || '/settings';

  // Carry callbackUrl/redirect across to sign-up so the destination survives the switch.
  const switchQuery = (() => {
    const p = new URLSearchParams();
    if (safeCallbackUrl) p.set('callbackUrl', safeCallbackUrl);
    if (redirectParam) p.set('redirect', redirectParam);
    const s = p.toString();
    return s ? `?${s}` : '';
  })();

  const configQuery = usePublicConfig();
  const configs = configQuery.data ?? {};
  const appName = configs.app_name || envConfigs.app_name;

  const emailEnabled = configs.email_auth_enabled !== 'false';
  const googleEnabled = configs.google_auth_enabled === 'true';
  const githubEnabled = configs.github_auth_enabled === 'true';
  const passwordResetEnabled = configs.password_reset_enabled === 'true';

  return (
    <SignInShell appName={appName}>
      <SignInForm
        afterLoginUrl={afterLoginUrl}
        switchQuery={switchQuery}
        emailEnabled={emailEnabled}
        googleEnabled={googleEnabled}
        githubEnabled={githubEnabled}
        passwordResetEnabled={passwordResetEnabled}
      />
    </SignInShell>
  );
}

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignInPage,
});
