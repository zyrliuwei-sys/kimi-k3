import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';

import { authClient, signIn } from '@/core/auth/client';
import { Link, useRouter } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { TextField } from '@/components/form-field';
import { SocialButtons } from '@/components/login/social-buttons';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldSeparator } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const signInSchema = z.object({
  email: z.string().email(m['common.sign.email_placeholder']()),
  password: z.string().min(1),
});

type SignInFormProps = {
  /** Destination after a successful sign-in. */
  afterLoginUrl: string;
  /** Query string (with leading `?`) that should be appended to `/sign-up`. */
  switchQuery: string;
  /** Whether email-password auth is enabled in the admin DB. */
  emailEnabled: boolean;
  /** Whether Google OAuth is enabled. */
  googleEnabled: boolean;
  /** Whether GitHub OAuth is enabled. */
  githubEnabled: boolean;
  /** Whether the "Forgot password" link should be shown. */
  passwordResetEnabled: boolean;
};

/**
 * The sign-in form body — credentials + social + error banner. Preserved
 * verbatim from the original sign-in.tsx; only the surrounding chrome
 * (Card, FieldGroup layout, outer page) was lifted out to <SignInShell>.
 */
export function SignInForm({
  afterLoginUrl,
  switchQuery,
  emailEnabled,
  googleEnabled,
  githubEnabled,
  passwordResetEnabled,
}: SignInFormProps) {
  const router = useRouter();
  const [error, setError] = useState('');

  const hasSocial = googleEnabled || githubEnabled;
  const hasAnyMethod = emailEnabled || hasSocial;

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setError('');
      try {
        const result: any = await signIn.email({
          email: value.email,
          password: value.password,
        });
        if (result.error) {
          const status = result.error.status;
          const code = result.error.code;
          const msg = result.error.message || '';
          if (
            code === 'EMAIL_NOT_VERIFIED' ||
            (status === 403 && /not verified/i.test(msg))
          ) {
            const verifyPath = `/verify-email?sent=1&email=${encodeURIComponent(
              value.email
            )}&callbackUrl=${encodeURIComponent(afterLoginUrl)}`;
            void authClient.sendVerificationEmail({
              email: value.email,
              callbackURL: localizeHref(afterLoginUrl),
            });
            router.push(verifyPath);
            return;
          }
          setError(msg || 'Sign in failed');
        } else {
          // Hard navigation so the destination reloads with a fresh session
          // cookie — a client push would let the guard read a stale (logged-out)
          // session store and bounce straight back to /sign-in.
          window.location.assign(localizeHref(afterLoginUrl));
        }
      } catch (err: any) {
        setError(err.message || 'Sign in failed');
      }
    },
  });

  async function handleSocial(provider: 'google' | 'github') {
    await signIn.social({ provider, callbackURL: afterLoginUrl });
  }

  if (!hasAnyMethod) {
    return (
      <div className="border-foreground/15 bg-muted/40 text-foreground/80 rounded-2xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">
          {m['common.sign.no_methods_title']()}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {m['common.sign.no_methods_description']()}
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {hasSocial && (
        <SocialButtons
          onGoogle={() => handleSocial('google')}
          onGitHub={() => handleSocial('github')}
          googleEnabled={googleEnabled}
          githubEnabled={githubEnabled}
          googleLabel={m['common.sign.google_sign_in']()}
          githubLabel={m['common.sign.github_sign_in']()}
        />
      )}

      {hasSocial && emailEnabled && (
        <FieldSeparator className="*:data-[slot=field-separator-content]:bg-background">
          {m['common.sign.or']()}
        </FieldSeparator>
      )}

      {emailEnabled && (
        <>
          <form.Field name="email">
            {(field) => (
              <TextField
                field={field}
                label={m['common.sign.email_title']()}
                type="email"
                required
                placeholder={m['common.sign.email_placeholder']()}
                autoComplete="email"
              />
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => {
              const err = field.state.meta.isTouched
                ? (field.state.meta.errors?.[0] as any)
                : null;
              const errMsg =
                err == null
                  ? null
                  : typeof err === 'string'
                    ? err
                    : err.message
                      ? String(err.message)
                      : String(err);
              return (
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor={field.name}>
                      {m['common.sign.password_title']()}
                    </FieldLabel>
                    {passwordResetEnabled && (
                      <Link
                        href="/forgot-password"
                        className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                      >
                        {m['common.sign.forgot_password']()}
                      </Link>
                    )}
                  </div>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    required
                    placeholder={m['common.sign.password_placeholder']()}
                    aria-invalid={errMsg ? true : undefined}
                    autoComplete="current-password"
                  />
                  {errMsg && (
                    <p className="text-destructive text-sm">{errMsg}</p>
                  )}
                </Field>
              );
            }}
          </form.Field>

          <Button
            type="submit"
            disabled={form.state.isSubmitting}
            className="brand-gradient text-primary-foreground mt-1 w-full hover:opacity-90"
          >
            {form.state.isSubmitting
              ? m['auth.signin.submitting_label']()
              : m['auth.signin.submit_label']()}
          </Button>

          <p className="text-muted-foreground text-center text-sm">
            {m['common.sign.no_account']()}{' '}
            <Link
              href={`/sign-up${switchQuery}`}
              className="text-foreground underline underline-offset-4"
            >
              {m['common.sign.sign_up_title']()}
            </Link>
          </p>
        </>
      )}
    </form>
  );
}
