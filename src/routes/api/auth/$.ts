import { createFileRoute } from '@tanstack/react-router';
import { and, eq, gt, sql } from 'drizzle-orm';

import { getAuth, sendWelcomeEmail } from '@/core/auth';
import { db } from '@/core/db';
import { account, credit, user } from '@/config/db/schema';
import { getConfig, getDbConfigs } from '@/modules/config/service';
import { grantForNewUser } from '@/modules/credits/service';
import { grantRoleForNewUser } from '@/modules/rbac/service';
import {
  enforceMinIntervalRateLimit,
  getClientIpFromRequest,
} from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';

/**
 * Wraps better-auth handler to:
 *   1. Auto-grant the default RBAC role after a successful email sign-up.
 *   2. Grant the signup bonus credits on BOTH credential and OAuth paths.
 *   3. Send the welcome email on every successful sign-up.
 *
 * The credit grant lives here (not in `databaseHooks.user.create.after`)
 * because better-auth 1.6.x queues the after-hook via
 * `queueAfterTransactionHook`, and the OAuth callback handler throws
 * `c.redirect(...)` before the queue reliably flushes — Google / GitHub /
 * magic-link users would otherwise end up with no credit row.
 *
 * SECURITY: better-auth already includes per-endpoint brute-force protection,
 * but it does not stop a script that hammers `/sign-up/email` to fill the
 * `user` table. We add a coarse 3-second-per-IP+cookie floor here so a
 * single browser/IP can submit at most ~20 sign-ups/min, which is plenty
 * for legitimate retries but stops scripted abuse.
 *
 * BOT CHECK: sign-up / sign-in / request-password-reset additionally require
 * a valid Cloudflare Turnstile token (header `x-captcha-response`), verified
 * via canonical siteverify before better-auth runs. Social OAuth and session
 * reads are unaffected. Fails closed once TURNSTILE_SECRET is configured;
 * passes through (no-op) when it isn't, so the app works without Turnstile.
 */
// Credential endpoints that create or reset identity — worth a bot check.
const TURNSTILE_PROTECTED_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
];

// Auth endpoints that can create a brand-new user. better-auth mounts
// social-provider callbacks at `/callback/:id` (302 redirect) and the
// magic-link plugin verifies new emails at `/magic-link/verify` (200
// JSON when no callbackURL, 302 redirect when there is one). Both flows
// insert into the `user` table mid-request, so we can't read the new
// user from the response body — we have to detect them via the DB.
const isNewUserCreatingPath = (pathname: string) =>
  /\/callback\/[^/]+$/.test(pathname) || /\/magic-link\/verify/.test(pathname);

async function handle(request: Request) {
  // Coarse abuse throttle on POST (sign-up / sign-in / OAuth callbacks).
  // GET (session lookup, OAuth providers) is left unthrottled.
  if (request.method === 'POST') {
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 3000,
      keyPrefix: 'auth',
    });
    if (limited) return limited;
  }

  const url = new URL(request.url);
  const isSignUp = url.pathname.endsWith('/sign-up/email');
  const isNewUserCreating = isNewUserCreatingPath(url.pathname);
  const needsCaptcha =
    request.method === 'POST' &&
    TURNSTILE_PROTECTED_PATHS.some((p) => url.pathname.endsWith(p));

  // Force-refresh the config cache — signup bonus decisions must reflect
  // the latest admin-set values, not whatever was cached up to 1h ago.
  const configs = await getDbConfigs(true);

  // Cloudflare Turnstile bot verification on credential endpoints. The
  // secret comes from the merged env+DB config; getConfig() reuses the
  // cache just populated above, so there's no extra DB hit. No secret
  // configured → feature is off → request passes through.
  if (needsCaptcha) {
    const secret = await getConfig('turnstile_secret');
    if (secret) {
      const token = request.headers.get('x-captcha-response') || '';
      const { success } = await verifyTurnstile({
        secret,
        response: token,
        remoteip: getClientIpFromRequest(request),
      });
      if (!success) {
        return Response.json(
          {
            message: 'Bot verification failed. Please refresh and try again.',
          },
          { status: 403 }
        );
      }
    }
  }

  const auth = getAuth(configs);

  // Stamp the request start so we can detect OAuth sign-ups that just
  // landed. A 1-second back-buffer covers clock skew between the app
  // process and the DB writer (which may be the same connection on
  // edge runtimes).
  const requestStartedAt = new Date(Date.now() - 1000);

  const response = await auth.handler(request);

  // --- Sign-up side-effects ---
  //
  // Two paths can create a user here:
  //   (a) `POST /sign-up/email` — 200 JSON with `body.user.id`.
  //   (b) `GET|POST /callback/:provider` — 302 redirect to the client;
  //       better-auth has just inserted a fresh `user` + `account` row.
  //
  // For (a) we read the user straight out of the response. For (b) the
  // redirect body is empty, so we query for any OAuth user row inserted
  // after `requestStartedAt` that hasn't yet received a signup bonus.
  // Both paths fire-and-forget — auth response is not delayed.

  // Path (b): OAuth callback OR magic-link verify. The redirect target
  // either succeeded (302 to newUserURL / callbackURL) or failed
  // (302 to ?error=...). Magic-link verify with no callbackURL returns
  // 200 JSON instead. We only grant when the response is a 2xx/3xx —
  // error responses may still have inserted a user row, but treating
  // those as failed sign-ups is the safer call.
  if (isNewUserCreating && response.status >= 200 && response.status < 400) {
    try {
      // Find users created in this request that don't already have a
      // gift credit row (idempotent: re-running grants nothing).
      //
      // LEFT JOIN account because magic-link sign-ups only insert a
      // `user` row (no account row), while OAuth sign-ups insert both.
      // The `providerId IS NULL OR <> 'credential'` filter excludes
      // email/password sign-ups, which the inline path below handles.
      const newSignups = await db()
        .select({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
        })
        .from(user)
        .leftJoin(account, eq(account.userId, user.id))
        .where(
          and(
            gt(user.createdAt, requestStartedAt),
            sql`(${account.providerId} IS NULL OR ${account.providerId} <> 'credential')`,
            sql`NOT EXISTS (
              SELECT 1 FROM ${credit}
              WHERE ${credit.userId} = ${user.id}
                AND ${credit.transactionScene} = 'gift'
            )`
          )
        );

      for (const newUser of newSignups) {
        // RBAC for OAuth + magic-link was previously missing too —
        // the old inline path only ran on /sign-up/email. Same fix.
        grantRoleForNewUser({
          userId: newUser.userId,
          configs,
        }).catch((e) => console.error('[auth] auto-grant role failed:', e));
        grantForNewUser({
          userId: newUser.userId,
          userEmail: newUser.userEmail,
          configs,
        }).catch((e) =>
          console.error(
            `[auth] auto-grant credits failed (user=${newUser.userId}):`,
            e
          )
        );
        // Best-effort welcome email. sendWelcomeEmail swallows its own
        // errors and runs against the email provider in the background.
        void sendWelcomeEmail({
          id: newUser.userId,
          email: newUser.userEmail,
          name: newUser.userName,
        });
      }
    } catch (e) {
      console.error('[auth] detect new sign-ups failed:', e);
    }
    return response;
  }

  // Path (a): email sign-up — the response carries the new user.
  if (!isSignUp || response.status !== 200) return response;

  try {
    const body = await response.clone().json();
    if (body?.user?.id && body?.token) {
      // Fire-and-forget: don't delay the auth response. Both side-effects
      // (RBAC role + signup credits + welcome email) run in parallel —
      // they're independent.
      grantRoleForNewUser({ userId: body.user.id, configs }).catch((e) =>
        console.error('[auth] auto-grant role failed:', e)
      );
      grantForNewUser({
        userId: body.user.id,
        userEmail: body.user.email,
        configs,
      }).catch((e) => console.error('[auth] auto-grant credits failed:', e));
      void sendWelcomeEmail({
        id: body.user.id,
        email: body.user.email,
        name: body.user.name,
      });
    }
  } catch {
    // Non-JSON response — let it through unchanged.
  }

  return response;
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
