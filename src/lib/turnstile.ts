/**
 * Canonical Cloudflare Turnstile server-side verification.
 *
 * POSTs the widget token to Cloudflare's siteverify endpoint and resolves
 * success: true only when Cloudflare reports `success === true`. Fails
 * closed: any network error, non-2xx response, or missing success flag is
 * treated as a failure, so a broken siteverify call never lets a request
 * through.
 *
 * Pure by design — callers resolve the secret (TURNSTILE_SECRET via the
 * config layer) and the client IP, then pass them in. Keeping it free of
 * config/db imports lets it run from any server route without coupling to
 * the module layer and keeps it straightforward to reason about.
 */
export interface VerifyTurnstileInput {
  /** The widget secret (TURNSTILE_SECRET). Verification is skipped if empty. */
  secret: string;
  /** The cf-turnstile-response token from the client. */
  response: string;
  /** Visitor IP (CF-Connecting-IP preferred). Optional but recommended. */
  remoteip?: string;
}

export interface VerifyTurnstileResult {
  success: boolean;
  /** Cloudflare error-codes when present — useful for logging on failure. */
  errorCodes?: string[];
}

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  input: VerifyTurnstileInput
): Promise<VerifyTurnstileResult> {
  const { secret, response, remoteip } = input;
  if (!secret || !response) return { success: false };

  try {
    const params = new URLSearchParams({ secret, response });
    if (remoteip) params.set('remoteip', remoteip);

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!res.ok) return { success: false };

    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return { success: false };
    const result = data as Record<string, unknown>;
    const errorCodes = result['error-codes'];
    return {
      success: result.success === true,
      errorCodes: Array.isArray(errorCodes)
        ? errorCodes.map(String)
        : undefined,
    };
  } catch {
    // Network failure or non-JSON body — fail closed.
    return { success: false };
  }
}
