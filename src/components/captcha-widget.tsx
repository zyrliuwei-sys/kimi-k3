import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

export interface CaptchaWidgetHandle {
  /**
   * Reset the widget so a fresh single-use token is issued for the next
   * attempt. Turnstile tokens are one-shot: after a failed submit the
   * parent must reset, otherwise a retry submits the already-redeemed
   * token and Cloudflare rejects it as timeout-or-duplicate.
   */
  reset: () => void;
}

interface CaptchaWidgetProps {
  /** Public Turnstile site key. The widget is not rendered when empty. */
  siteKey?: string;
  /** Server-validated action that identifies the protected operation. */
  action: string;
  /** Called with the verification token (empty string on expire/error). */
  onToken: (token: string) => void;
  className?: string;
}

/**
 * Cloudflare Turnstile widget for React forms.
 *
 * Renders nothing when no site key is configured, so a form that includes
 * it degrades gracefully if Turnstile is turned off (env unset). The caller
 * supplies an operation-specific action through render options; the server
 * verifies that same action in the Siteverify response.
 *
 * The widget is explicitly rendered (not auto-rendered via a `cf-turnstile`
 * div) because this app is an SPA: auth pages mount through client-side
 * navigation, where Cloudflare's auto-render scan does not reliably fire.
 * The component handles script injection and (re)render on mount/unmount.
 */
export const CaptchaWidget = forwardRef<
  CaptchaWidgetHandle,
  CaptchaWidgetProps
>(function CaptchaWidget({ siteKey, action, onToken, className }, ref) {
  const widgetRef = useRef<TurnstileInstance | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    reset: () => widgetRef.current?.reset(),
  }));

  if (!siteKey) return null;

  return (
    <Turnstile
      siteKey={siteKey}
      className={className}
      options={{ action, theme: 'auto' }}
      onSuccess={(token) => onToken(token)}
      onExpire={() => onToken('')}
      onError={() => onToken('')}
      ref={widgetRef}
    />
  );
});
