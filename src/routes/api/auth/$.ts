import { createFileRoute } from '@tanstack/react-router';
import { and, count, eq, gt, sql } from 'drizzle-orm';

import { getAuth, sendWelcomeEmail } from '@/core/auth';
import { db } from '@/core/db';
import { account, credit, user } from '@/config/db/schema';
import { getConfig, getDbConfigs } from '@/modules/config/service';
import { grantRoleForNewUser } from '@/modules/rbac/service';
import {
  enforceMinIntervalRateLimit,
  enforceQqAttemptCooldown,
  getClientIpFromRequest,
  recordQqAttempt,
} from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';
import { m } from '@/paraglide/messages.js';

/**
 * Wraps better-auth handler to:
 *   1. Auto-grant the default RBAC role after a successful email sign-up.
 *   2. Send the welcome email on every successful sign-up.
 *
 * The signup bonus (5 credits) is NOT granted here. It lives in
 * `maybeClaimSignupBonus` in modules/credits/service.ts, which fires
 * lazily on the user's first chat message — and only if their email
 * is verified. Spammed accounts that never verify or never chat earn
 * no bonus.
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

// Signup policy gates: banned email domains + per-IP registration cap.
// QQ Mail is rejected up front (whole-domain block — Tencent aliases all
// live under @qq.com). The IP cap counts rows in `user.ip`; the wrapper
// persists the client IP for every new account below so subsequent
// signups from the same IP see the running total.
const BLOCKED_EMAIL_REGEX = /@(?:qq|foxmail)\.com$/i;
const MAX_REGISTRATIONS_PER_IP = 3;

// Auth endpoints that can create a brand-new user. better-auth mounts
// social-provider callbacks at `/callback/:id` (302 redirect) and the
// magic-link plugin verifies new emails at `/magic-link/verify` (200
// JSON when no callbackURL, 302 redirect when there is one). Both flows
// insert into the `user` table mid-request, so we can't read the new
// user from the response body — we have to detect them via the DB.
const isNewUserCreatingPath = (pathname: string) =>
  /\/callback\/[^/]+$/.test(pathname) || /\/magic-link\/verify/.test(pathname);

// Persist the client IP on a freshly created user row. Fire-and-forget —
// never blocks the auth response, and a failed update just means the
// user can sign up again from this IP without being counted (a
// permission slip, not a security hole).
function recordSignupIp(userId: string, ip: string) {
  if (!ip) return;
  db()
    .update(user)
    .set({ ip })
    .where(eq(user.id, userId))
    .catch((e) =>
      console.error(`[auth] persist signup ip failed (user=${userId}):`, e)
    );
}

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
  // Single source of truth for the client IP — used by the signup preflight
  // (IP cap check), Turnstile, and the post-signup IP persistence below.
  const clientIp = getClientIpFromRequest(request);

  // Force-refresh the config cache — signup bonus decisions must reflect
  // the latest admin-set values, not whatever was cached up to 1h ago.
  const configs = await getDbConfigs(true);

  // Cloudflare Turnstile bot verification on credential endpoints. Two
  // gates must be open: the admin explicitly enabled the feature AND a
  // secret key is configured (env → DB). Both come from the merged
  // config; getConfig() reuses the cache just populated above, so there's
  // no extra DB hit. Either gate closed → feature is off → request
  // passes through.
  if (needsCaptcha) {
    const [enabled, secret] = await Promise.all([
      getConfig('turnstile_enabled'),
      getConfig('turnstile_secret'),
    ]);
    if (enabled === 'true' && secret) {
      const token = request.headers.get('x-captcha-response') || '';
      const { success } = await verifyTurnstile({
        secret,
        response: token,
        remoteip: clientIp,
      });
      if (!success) {
        return Response.json(
          { message: m['auth.signup.error_captcha_failed']() },
          { status: 403 }
        );
      }
    }
  }

  const auth = getAuth(configs);

  // Signup policy preflight — only on POST /sign-up/email. The QQ / IP-cap
  // checks live in front of better-auth so we reject *before* a user row
  // is inserted (and its signup credits granted). The body is cloned so
  // the original request stream is still readable by `auth.handler` below.
  //
  // Scope note: the IP cap only applies to credential sign-ups — OAuth /
  // magic-link hand-offs are validated by the upstream provider, and the
  // user has already been created by the time /callback runs, so a clean
  // pre-rejection isn't possible there. OAuth paths still persist the IP
  // (see recordSignupIp) so the count stays accurate for credential flows.
  if (isSignUp && request.method === 'POST') {
    // Cooldown gate first — if this IP has been hammering with QQ
    // aliases, short-circuit before even parsing the body. The 24h
    // lockout message is i18n'd through the same channel.
    const cooldown = enforceQqAttemptCooldown(
      request,
      m['auth.signup.error_qq_cooldown']()
    );
    if (cooldown) return cooldown;

    try {
      const preflightBody = await request
        .clone()
        .json()
        .catch(() => null);
      const email = String(preflightBody?.email || '').trim();
      if (email && BLOCKED_EMAIL_REGEX.test(email)) {
        // Count this as a failed QQ attempt. Once the IP crosses the
        // threshold the next /sign-up/email from this IP — with any
        // email, not just QQ — gets 429'd for 24h.
        recordQqAttempt(request);
        return Response.json(
          { message: m['auth.signup.error_qq_blocked']() },
          { status: 403 }
        );
      }
      if (clientIp) {
        const [{ count: existing }] = await db()
          .select({ count: count() })
          .from(user)
          .where(eq(user.ip, clientIp));
        if ((existing ?? 0) >= MAX_REGISTRATIONS_PER_IP) {
          return Response.json(
            {
              message: m['auth.signup.error_ip_limit']({
                max: MAX_REGISTRATIONS_PER_IP,
              }),
            },
            { status: 403 }
          );
        }
      }
    } catch (e) {
      // Body wasn't JSON or DB hiccup — let auth.handler sort it out
      // rather than locking the user out on a transient read failure.
      console.error('[auth] signup preflight failed:', e);
    }
  }

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
        // Persist the client IP so future /sign-up/email attempts from
        // this IP see the new account in their quota count. Fire-and-
        // forget — never blocks the auth response.
        recordSignupIp(newUser.userId, clientIp);
        // RBAC for OAuth + magic-link was previously missing too —
        // the old inline path only ran on /sign-up/email. Same fix.
        grantRoleForNewUser({
          userId: newUser.userId,
          configs,
        }).catch((e) => console.error('[auth] auto-grant role failed:', e));
        // Signup bonus is no longer granted here — new users earn 5
        // credits the FIRST time they have a verified email AND have
        // sent a chat message (see maybeClaimSignupBonus in
        // modules/credits/service.ts, fired from the chat insert path).
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
      // Persist the client IP so future /sign-up/email attempts from
      // this IP see this account in their quota count.
      recordSignupIp(body.user.id, clientIp);
      // Fire-and-forget: don't delay the auth response. The signup
      // bonus is no longer granted here — it now lives in
      // maybeClaimSignupBonus, fired lazily on the user's first chat
      // message (only when their email is verified).
      grantRoleForNewUser({ userId: body.user.id, configs }).catch((e) =>
        console.error('[auth] auto-grant role failed:', e)
      );
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
