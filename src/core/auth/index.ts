import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink, oneTap } from 'better-auth/plugins';

import { db } from '@/core/db';
import type { EmailProvider } from '@/core/email';
import { CloudflareEmailProvider } from '@/core/email/cloudflare';
import { ResendProvider } from '@/core/email/resend';
import { VerifyEmail } from '@/core/email/templates/verify-email';
import { AUTH_SECRET_PLACEHOLDER, envConfigs } from '@/config';
import * as schema from '@/config/db/schema';
import { getAllConfigs } from '@/modules/config/service';
import { grantForNewUser } from '@/modules/credits/service';
import { getUuid } from '@/lib/hash';

function assertProductionAuthSecret() {
  // Only enforce at runtime in production.
  if (process.env.NODE_ENV !== 'production') return;
  const secret = envConfigs.auth_secret;
  if (!secret || secret === AUTH_SECRET_PLACEHOLDER) {
    throw new Error(
      'AUTH_SECRET is missing or still set to the development placeholder. ' +
        'Generate one with `openssl rand -base64 32` and set it before serving traffic.'
    );
  }
}

const recentVerificationEmailSentAt = new Map<string, number>();
const VERIFICATION_EMAIL_MIN_INTERVAL_MS = 60_000;

function getDatabaseProvider(provider: string): 'sqlite' | 'pg' | 'mysql' {
  switch (provider) {
    case 'sqlite':
    case 'turso':
    case 'd1':
      return 'sqlite';
    case 'postgresql':
    case 'postgres':
      return 'pg';
    case 'mysql':
      return 'mysql';
    default:
      throw new Error(`Unsupported database provider for auth: ${provider}`);
  }
}

// workerd forbids reusing TCP sockets across requests ("Cannot perform I/O on
// behalf of a different request"). drizzleAdapter(db()) bakes the postgres/
// mysql client in at construction, so a cached auth instance makes an OAuth
// callback query `verification` with the initiating request's client —
// better-auth swallows the error as please_restart_the_process. Rebuild per
// request on Workers; db() already hands out a fresh client there.
const isCloudflareWorker =
  (typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers') ||
  (typeof globalThis !== 'undefined' && 'Cloudflare' in globalThis);

const TCP_PROVIDERS = ['postgresql', 'postgres', 'mysql'];

const canCacheAuthInstance = !(
  isCloudflareWorker && TCP_PROVIDERS.includes(envConfigs.database_provider)
);

let authInstance: any;
let socialConfigsSignature = '';
let emailEnabledLoaded = true;
let emailVerificationEnabledLoaded = false;
let magicLinkEnabledLoaded = false;

function getSocialProviders(configs: Record<string, string>) {
  const providers: Record<string, any> = {};

  if (configs.google_client_id && configs.google_client_secret) {
    providers.google = {
      clientId: configs.google_client_id,
      clientSecret: configs.google_client_secret,
    };
  }

  if (configs.github_client_id && configs.github_client_secret) {
    providers.github = {
      clientId: configs.github_client_id,
      clientSecret: configs.github_client_secret,
    };
  }

  return providers;
}

function getSocialSignature(configs: Record<string, string>) {
  return [
    configs.google_client_id || '',
    configs.google_client_secret || '',
    configs.github_client_id || '',
    configs.github_client_secret || '',
    // Including the one-tap flag here so toggling it without changing
    // credentials still rebuilds authInstance (which owns the plugin list).
    configs.google_one_tap_enabled || '',
  ].join('|');
}

/**
 * Build the configured email provider from admin settings.
 * Returns null if the chosen provider is not fully configured.
 */
function getEmailProvider(
  configs: Record<string, string>
): { provider: EmailProvider; from: string } | null {
  const selected = configs.email_provider || 'resend';

  if (selected === 'cloudflare') {
    const apiToken = configs.cloudflare_email_api_token;
    const accountId = configs.cloudflare_email_account_id;
    const from = configs.cloudflare_email_sender_email;
    if (!apiToken || !accountId || !from) return null;
    return {
      provider: new CloudflareEmailProvider({
        apiToken,
        accountId,
        defaultFrom: from,
      }),
      from,
    };
  }

  // Default: resend
  const apiKey = configs.resend_api_key;
  const from = configs.resend_sender_email;
  if (!apiKey || !from) return null;
  return { provider: new ResendProvider({ apiKey, defaultFrom: from }), from };
}

/** Check whether email sending is available for the selected provider */
function isEmailConfigured(configs: Record<string, string>): boolean {
  return getEmailProvider(configs) !== null;
}

function getAuthPlugins(configs: Record<string, string> | undefined) {
  if (!configs) return [];
  const plugins: any[] = [];
  if (configs.google_client_id && configs.google_one_tap_enabled === 'true') {
    plugins.push(oneTap());
  }
  // Magic-link (passwordless email sign-in). Only enabled when email is fully
  // configured — Resend / Cloudflare Email. The plugin's sendMagicLink
  // callback reuses the same Resend provider we use for verification emails,
  // so there's no second credential to manage.
  if (
    configs.magic_link_enabled === 'true' &&
    configs.email_auth_enabled !== 'false' &&
    isEmailConfigured(configs)
  ) {
    plugins.push(
      magicLink({
        // 10 minutes — long enough for someone to switch tabs, short enough
        // that a leaked link is unlikely to outlive its usefulness.
        expiresIn: 600,
        // Allow 3 verification attempts (covers typos + stale links from
        // a different device). Infinity would let brute-force tokens ride.
        allowedAttempts: 3,
        // New email auto-creates an account — better-auth issues the user
        // row on first verify. Disable to force admin invite.
        disableSignUp: configs.magic_link_disable_signup === 'true',
        sendMagicLink: async ({ email, url }) => {
          const all = await getAllConfigs();
          const emailCtx = getEmailProvider(all);
          if (!emailCtx) {
            console.error('[auth] sendMagicLink: No email provider configured');
            return;
          }
          const appName = all.app_name || envConfigs.app_name;
          await emailCtx.provider.sendEmail({
            to: email,
            subject: `Sign in to ${appName}`,
            text: `Click this link to sign in to ${appName}. It expires in 10 minutes.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
            html: `<p>Click the link below to sign in to <strong>${appName}</strong>. It expires in 10 minutes.</p><p><a href="${url}">Sign in to ${appName}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
          });
        },
      })
    );
  }
  return plugins;
}

export function getAuth(configs?: Record<string, string>) {
  assertProductionAuthSecret();
  // Rebuild if any social provider credential changed
  if (configs) {
    const nextSignature = getSocialSignature(configs);
    if (nextSignature !== socialConfigsSignature) {
      authInstance = null;
      socialConfigsSignature = nextSignature;
    }
  }

  // Rebuild if the email-auth flag changed
  if (configs) {
    const nextEmailEnabled = configs.email_auth_enabled !== 'false';
    if (nextEmailEnabled !== emailEnabledLoaded) {
      authInstance = null;
      emailEnabledLoaded = nextEmailEnabled;
    }
  }

  // Rebuild if the email-verification flag changed
  if (configs) {
    const nextVerificationEnabled =
      configs.email_verification_enabled === 'true' &&
      isEmailConfigured(configs);
    if (nextVerificationEnabled !== emailVerificationEnabledLoaded) {
      authInstance = null;
      emailVerificationEnabledLoaded = nextVerificationEnabled;
    }
  }

  // Rebuild if the magic-link flag changed
  if (configs) {
    const nextMagicLinkEnabled =
      configs.magic_link_enabled === 'true' && isEmailConfigured(configs);
    if (nextMagicLinkEnabled !== magicLinkEnabledLoaded) {
      authInstance = null;
      magicLinkEnabledLoaded = nextMagicLinkEnabled;
    }
  }

  if (authInstance) return authInstance;

  const socialProviders = configs ? getSocialProviders(configs) : {};
  const emailAndPasswordEnabled = configs
    ? configs.email_auth_enabled !== 'false'
    : true;
  const emailVerificationEnabled = configs
    ? configs.email_verification_enabled === 'true' &&
      isEmailConfigured(configs)
    : false;
  const appName = configs?.app_name || envConfigs.app_name;
  const appUrl = configs?.app_url || envConfigs.app_url;
  const authUrl = configs?.auth_url || envConfigs.auth_url || appUrl;

  const instance = betterAuth({
    appName,
    baseURL: authUrl,
    secret: envConfigs.auth_secret,
    trustedOrigins: (request) => {
      const origins: string[] = [];
      if (appUrl) origins.push(appUrl);
      try {
        const origin = request?.headers?.get?.('origin');
        if (origin && new URL(origin).hostname === 'localhost')
          origins.push(origin);
      } catch {}
      return origins;
    },
    database: drizzleAdapter(db(), {
      provider: getDatabaseProvider(envConfigs.database_provider),
      schema,
    }),
    socialProviders,
    plugins: getAuthPlugins(configs),
    user: {
      additionalFields: {
        utmSource: {
          type: 'string',
          input: false,
          required: false,
          defaultValue: '',
        },
        ip: { type: 'string', input: false, required: false, defaultValue: '' },
        locale: {
          type: 'string',
          input: false,
          required: false,
          defaultValue: '',
        },
      },
    },
    advanced: {
      database: { generateId: () => getUuid() },
      // better-auth's databaseHooks fire on every user insert regardless of
      // sign-up path (email, Google OAuth, GitHub OAuth, magic-link, etc.).
      // We use the `after` hook to grant signup credits. The catch +
      // console.error prevents a config-table outage from breaking auth —
      // sign-ups still succeed even if the credit grant silently no-ops.
      databaseHooks: {
        user: {
          create: {
            after: async (user) => {
              try {
                const all = await getAllConfigs();
                await grantForNewUser({
                  userId: user.id,
                  userEmail: user.email,
                  configs: all,
                });
              } catch (e) {
                console.error('[auth] databaseHook grant credits failed:', e);
              }
            },
          },
        },
      },
    },
    emailAndPassword: {
      enabled: emailAndPasswordEnabled,
      requireEmailVerification: emailVerificationEnabled,
      autoSignIn: !emailVerificationEnabled,
      sendResetPassword: async ({ user, url }) => {
        const all = await getAllConfigs();
        const emailCtx = getEmailProvider(all);
        if (!emailCtx) {
          console.error(
            '[auth] sendResetPassword: No email provider configured'
          );
          return;
        }
        const appName = all.app_name || envConfigs.app_name;
        const greeting = user.name ? `Hi ${user.name},` : 'Hi,';
        const result = await emailCtx.provider.sendEmail({
          to: user.email,
          subject: `Reset your ${appName} password`,
          text: `${greeting}\n\nYou recently requested to reset your password for ${appName}. Use the link below to choose a new one:\n\n${url}\n\nThis link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.`,
          html: `<p>${greeting}</p>
<p>You recently requested to reset your password for <strong>${appName}</strong>. Click the link below to choose a new one:</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>`,
        });
        if (!result.success) {
          console.error('[auth] sendResetPassword failed:', result.error);
        }
      },
    },
    ...(emailVerificationEnabled
      ? {
          emailVerification: {
            sendOnSignUp: false,
            sendOnSignIn: false,
            autoSignInAfterVerification: true,
            expiresIn: 60 * 60 * 24,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: any;
              url: string;
              token: string;
            }) => {
              try {
                const key = String(user?.email || '').toLowerCase();
                const now = Date.now();
                const last = recentVerificationEmailSentAt.get(key) || 0;
                if (key && now - last < VERIFICATION_EMAIL_MIN_INTERVAL_MS) {
                  return;
                }
                if (key) {
                  recentVerificationEmailSentAt.set(key, now);
                }

                const all = await getAllConfigs();
                const emailCtx = getEmailProvider(all);
                if (!emailCtx) {
                  console.error(
                    '[auth] sendVerificationEmail: No email provider configured'
                  );
                  return;
                }
                const appName = all.app_name || envConfigs.app_name;
                // Email clients don't render SVG <img>; only embed a raster logo,
                // otherwise fall back to the text brand in the template.
                const rawLogo = all.app_logo || '';
                const logo = /\.svg(\?|#|$)/i.test(rawLogo) ? '' : rawLogo;
                const logoUrl = logo.startsWith('http')
                  ? logo
                  : logo
                    ? `${all.app_url || appUrl || ''}${logo.startsWith('/') ? '' : '/'}${logo}`
                    : undefined;
                const result = await emailCtx.provider.sendEmail({
                  to: user.email,
                  subject: `Verify your email - ${appName}`,
                  react: VerifyEmail({ appName, logoUrl, url }),
                });
                if (!result.success) {
                  console.error(
                    '[auth] sendVerificationEmail failed:',
                    result.error
                  );
                }
              } catch (e) {
                console.error('[auth] sendVerificationEmail error:', e);
              }
            },
          },
        }
      : {}),
    // New users get no free credits. They must sign up/login, then purchase a
    // credit pack to use the playground or any AI feature.
    logger: { disabled: true },
  } satisfies BetterAuthOptions);

  if (canCacheAuthInstance) authInstance = instance;
  return instance;
}
