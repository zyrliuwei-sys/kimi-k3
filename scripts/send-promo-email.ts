/**
 * One-off promo email blast to all currently registered users.
 *
 * Usage:
 *   ENV_FILE=.env.production tsx scripts/with-env.ts tsx scripts/send-promo-email.ts \
 *     --headline="50% off all credit packs this week" \
 *     --body="Pick up a pack and keep the conversation going. Same Kimi K3, half the price." \
 *     --cta="Claim 50% off" \
 *     --code=KIMIK3HALF \
 *     --expires="Jan 31" \
 *     --discount="LIMITED · 50% OFF" \
 *     [--limit=10]                 # cap recipients for a dry test
 *     [--batch-size=20]            # recipients per chunked pause
 *     [--batch-delay-ms=1200]      # pause between batches (Resend rate limit)
 *     [--only=user@example.com]    # single-recipient test
 *     [--confirm]
 *
 * Safety:
 *   - Refuses to run without --confirm.
 *   - With --limit / --only, no need for --confirm (intended as a test).
 *   - Logs every send + a final summary (success / failure counts).
 *   - Rate-limited to avoid tripping Resend's 2 req/s default ceiling.
 */

import { sql } from 'drizzle-orm';

import { envConfigs } from '../src/config';
import * as schema from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';
import { ResendProvider, type EmailProvider } from '../src/core/email';
import { PromoEmail } from '../src/core/email/templates/promo-email';
import { getAllConfigs } from '../src/modules/config/service';

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
  const headline = arg('headline');
  const body = arg('body');
  const ctaText = arg('cta');
  const ctaUrlArg = arg('cta-url');
  const code = arg('code');
  const expiresAt = arg('expires');
  const discountLabel = arg('discount');
  const limitArg = arg('limit');
  const only = arg('only');
  const batchSize = Math.max(1, parseInt(arg('batch-size') || '20', 10));
  const batchDelayMs = Math.max(
    0,
    parseInt(arg('batch-delay-ms') || '1200', 10)
  );
  const confirm = process.argv.includes('--confirm');

  if (!headline || !body) {
    console.error(
      'Usage: --headline="..." --body="..." [--cta="..."] [--code=...] [--expires=...] [--discount=...] [--limit=N | --only=email] [--confirm]'
    );
    process.exit(1);
  }

  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error('--limit must be a positive integer');
    process.exit(1);
  }

  // --limit / --only are the safe paths — no need for --confirm.
  if (!confirm && limit === undefined && !only) {
    console.error(
      'Refusing to blast to all users without --confirm.\n' +
        'For a small test, use --limit=10 or --only=user@example.com (no --confirm needed).'
    );
    process.exit(1);
  }

  const db = dbFn();

  // 1. Resolve the email provider from the admin-set config. Falls back to
  //    env-var Resend key (the same one the auth flow uses) so the script
  //    works even if the admin hasn't filled the DB config yet.
  const all = await getAllConfigs();
  let emailCtx: { provider: EmailProvider; from: string } | null = null;
  const resendKey = all.resend_api_key || envConfigs.resend_api_key;
  const resendFrom = all.resend_sender_email || envConfigs.resend_sender_email;
  if (resendKey && resendFrom) {
    emailCtx = {
      provider: new ResendProvider({
        apiKey: resendKey,
        defaultFrom: resendFrom,
      }),
      from: resendFrom,
    };
  }
  if (!emailCtx) {
    console.error(
      'No Resend provider configured. Set resend_api_key + resend_sender_email in admin → settings → email (or in .env).'
    );
    process.exit(1);
  }
  const appName = all.app_name || envConfigs.app_name;
  // SVG → text fallback in email clients.
  const rawLogo = all.app_logo || '';
  const logo = /\.svg(\?|#|$)/i.test(rawLogo) ? '' : rawLogo;
  const logoUrl = logo
    ? logo.startsWith('http')
      ? logo
      : `${all.app_url || envConfigs.app_url || ''}${logo.startsWith('/') ? '' : '/'}${logo}`
    : undefined;
  // ctaUrl — DB config wins over env (which previously held a stale
  // kimik3.com URL). Use this consistently for the email's button.
  const ctaUrl =
    ctaUrlArg ||
    `${(all.app_url || envConfigs.app_url || '').replace(/\/$/, '')}/pricing`;

  // 2. Pull recipients. `emailVerified` filter is intentional — only contact
  //    people we know can receive mail (and who confirmed ownership).
  const baseQuery = db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.user)
    .where(
      only
        ? sql`${schema.user.email} = ${only}`
        : sql`${schema.user.emailVerified} = true`
    );

  const recipients = await (limit !== undefined
    ? baseQuery.limit(limit)
    : baseQuery);

  if (recipients.length === 0) {
    console.error('No recipients matched.');
    process.exit(1);
  }

  console.log(
    `[promo] target=${recipients.length} provider=${emailCtx.provider.name} ` +
      `from=${emailCtx.from} app=${appName}`
  );
  console.log(
    `[promo] subject="Special offer from ${appName}"  headline="${headline}"`
  );
  if (only) console.log(`[promo] --only filter: ${only}`);
  if (limit !== undefined) console.log(`[promo] --limit cap: ${limit}`);
  if (!confirm && (limit !== undefined || only)) {
    console.log('[promo] (no --confirm; running in test mode)');
  }
  console.log('---');

  // 3. Send in batches with a delay between each, to respect Resend's
  //    rate limit. Failures on one recipient don't stop the rest.
  let ok = 0;
  let fail = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    try {
      const res = await emailCtx.provider.sendEmail({
        to: r.email,
        from: emailCtx.from,
        subject: `Special offer from ${appName}`,
        react: PromoEmail({
          appName,
          logoUrl,
          name: r.name ?? undefined,
          headline,
          body,
          ctaText: ctaText || undefined,
          ctaUrl,
          expiresAt: expiresAt || undefined,
          promoCode: code || undefined,
          discountLabel: discountLabel || undefined,
        }),
      });
      if (res.success) {
        ok++;
        console.log(
          `  [${String(i + 1).padStart(4)}/${recipients.length}] OK   ${r.email}`
        );
      } else {
        fail++;
        failures.push({ email: r.email, error: res.error || 'unknown' });
        console.log(
          `  [${String(i + 1).padStart(4)}/${recipients.length}] FAIL ${r.email}  ${res.error}`
        );
      }
    } catch (e: any) {
      fail++;
      const msg = e?.message || String(e);
      failures.push({ email: r.email, error: msg });
      console.log(
        `  [${String(i + 1).padStart(4)}/${recipients.length}] THROW ${r.email}  ${msg}`
      );
    }
    // Pause between batches (not every send), to keep total runtime sane
    // while staying under Resend's rate limit.
    if (
      batchDelayMs > 0 &&
      (i + 1) % batchSize === 0 &&
      i + 1 < recipients.length
    ) {
      console.log(`  --- batch boundary, sleeping ${batchDelayMs}ms ---`);
      await sleep(batchDelayMs);
    }
  }

  console.log('---');
  console.log(`[promo] done. ok=${ok} fail=${fail} total=${recipients.length}`);
  if (failures.length) {
    console.log('[promo] failures:');
    for (const f of failures.slice(0, 20)) {
      console.log(`  - ${f.email}  →  ${f.error}`);
    }
    if (failures.length > 20) {
      console.log(`  …and ${failures.length - 20} more`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
