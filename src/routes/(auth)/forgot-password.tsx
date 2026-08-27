import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { requestPasswordReset } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { TURNSTILE_ACTIONS } from '@/lib/turnstile-actions';
import { m } from '@/paraglide/messages.js';
import { localizeHref } from '@/paraglide/runtime.js';
import { usePublicConfig } from '@/hooks/use-public-config';
import {
  CaptchaWidget,
  type CaptchaWidgetHandle,
} from '@/components/captcha-widget';
import { TextField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup } from '@/components/ui/field';

const forgotSchema = z.object({
  email: z.string().email(m['common.sign.email_placeholder']()),
});

function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const captchaRef = useRef<CaptchaWidgetHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');

  const configQuery = usePublicConfig();
  const configs = configQuery.data ?? {};

  const configsLoaded = configQuery.isSuccess;
  const passwordResetEnabled = configs.password_reset_enabled === 'true';
  const turnstileEnabled = configs.turnstile_enabled === 'true';
  const turnstileSiteKey =
    turnstileEnabled && configs.turnstile_sitekey
      ? configs.turnstile_sitekey
      : '';

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: forgotSchema },
    onSubmit: async ({ value }) => {
      setError('');
      if (turnstileEnabled && !turnstileSiteKey) {
        setError(m['common.sign.captcha_unavailable']());
        return;
      }
      if (turnstileEnabled && !turnstileToken) {
        setError(m['common.sign.captcha_required']());
        return;
      }
      try {
        const origin = window.location.origin;
        const redirectTo = `${origin}${localizeHref('/reset-password')}`;
        const result = await requestPasswordReset(
          {
            email: value.email,
            redirectTo,
          },
          turnstileToken
            ? { headers: { 'x-captcha-response': turnstileToken } }
            : undefined
        );
        if (result.error) {
          captchaRef.current?.reset();
          setTurnstileToken('');
          setError(result.error.message || 'Request failed');
        } else {
          setSentEmail(value.email);
          setSent(true);
        }
      } catch (err: any) {
        captchaRef.current?.reset();
        setTurnstileToken('');
        setError(err.message || 'Request failed');
      }
    },
  });

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="self-center font-serif text-lg italic">
          {configs.app_name || envConfigs.app_name}
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {sent
                ? m['common.sign.reset_link_sent_title']()
                : m['common.sign.forgot_password_title']()}
            </CardTitle>
            {!sent && (
              <CardDescription>
                {m['common.sign.forgot_password_description']()}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {configsLoaded && !passwordResetEnabled ? (
              <FieldGroup>
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm font-medium">
                    {m['common.sign.password_reset_unavailable_title']()}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {m['common.sign.password_reset_unavailable_description']()}
                  </p>
                </div>
                <Field>
                  <Link
                    href="/sign-in"
                    className="text-center text-sm underline underline-offset-4"
                  >
                    {m['common.sign.back_to_sign_in']()}
                  </Link>
                </Field>
              </FieldGroup>
            ) : sent ? (
              <FieldGroup>
                <p className="text-muted-foreground text-center text-sm">
                  {m['common.sign.reset_link_sent_description']({
                    email: sentEmail,
                  })}
                </p>
                <Field>
                  <Link
                    href="/sign-in"
                    className="text-center text-sm underline underline-offset-4"
                  >
                    {m['common.sign.back_to_sign_in']()}
                  </Link>
                </Field>
              </FieldGroup>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  form.handleSubmit();
                }}
              >
                <FieldGroup>
                  {error && (
                    <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
                      {error}
                    </div>
                  )}
                  <form.Field name="email">
                    {(field) => (
                      <TextField
                        field={field}
                        label={m['common.sign.email_title']()}
                        type="email"
                        required
                        placeholder={m['common.sign.email_placeholder']()}
                      />
                    )}
                  </form.Field>
                  <Field>
                    <CaptchaWidget
                      ref={captchaRef}
                      siteKey={turnstileSiteKey}
                      action={TURNSTILE_ACTIONS.passwordReset}
                      onToken={setTurnstileToken}
                    />
                    <form.Subscribe selector={(s) => s.isSubmitting}>
                      {(isSubmitting) => (
                        <Button type="submit" disabled={isSubmitting}>
                          {isSubmitting
                            ? '...'
                            : m['common.sign.send_reset_link']()}
                        </Button>
                      )}
                    </form.Subscribe>
                    <FieldDescription className="text-center">
                      <Link
                        href="/sign-in"
                        className="underline underline-offset-4"
                      >
                        {m['common.sign.back_to_sign_in']()}
                      </Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPasswordPage,
});
