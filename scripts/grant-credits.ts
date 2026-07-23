/**
 * One-off credit grant for a single user.
 *
 * Usage:
 *   ENV_FILE=.env.production tsx scripts/with-env.ts tsx scripts/grant-credits.ts --email=user@example.com --credits=1000 --description="..."
 *
 * Idempotency: refuses to run if --confirm is not passed. Prints before/after
 * balance and the transactionNo of the new grant row.
 */

import { eq } from 'drizzle-orm';

import { envConfigs } from '../src/config';
import * as schema from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';
import { getSnowId, getUuid } from '../src/lib/hash';
import {
  calculateCreditExpirationTime,
  CreditStatus,
  CreditTransactionScene,
  CreditTransactionType,
} from '../src/modules/credits/service';

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
}

async function main() {
  const email = arg('email');
  const creditsArg = arg('credits');
  const description = arg('description') || 'Admin manual grant';
  const expiresDaysArg = arg('expires-days');
  const confirm = process.argv.includes('--confirm');

  if (!email || !creditsArg) {
    console.error(
      'Usage: --email=user@example.com --credits=1000 [--description="..."] [--expires-days=365] --confirm'
    );
    process.exit(1);
  }

  const credits = parseInt(creditsArg, 10);
  if (!Number.isFinite(credits) || credits <= 0) {
    console.error('--credits must be a positive integer');
    process.exit(1);
  }

  if (!confirm) {
    console.error(
      'Refusing to run without --confirm. Re-run with --confirm to write.'
    );
    process.exit(1);
  }

  console.log(
    `DB provider: ${envConfigs.database_provider}, url host: ${
      envConfigs.database_url?.split('@')[1]?.split('/')[0] ?? 'NONE'
    }`
  );

  const db = dbFn();

  // Look up user
  const [target] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!target) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }
  console.log(`User: ${target.name} <${target.email}>  id=${target.id}`);

  // Balance before
  const beforeRows = await db
    .select()
    .from(schema.credit)
    .where(eq(schema.credit.userId, target.id));
  const balanceBefore = beforeRows
    .filter(
      (r) =>
        r.transactionType === CreditTransactionType.GRANT &&
        r.status === CreditStatus.ACTIVE &&
        (r.expiresAt === null || r.expiresAt > new Date())
    )
    .reduce((sum, r) => sum + (r.remainingCredits ?? 0), 0);
  console.log(`Balance before: ${balanceBefore}`);

  const expiresAt = expiresDaysArg
    ? calculateCreditExpirationTime({
        creditsValidDays: parseInt(expiresDaysArg, 10),
      })
    : null;

  // Insert grant row directly (mirrors modules/credits/service.ts grant())
  const newCredit: typeof schema.credit.$inferInsert = {
    id: getUuid(),
    userId: target.id,
    userEmail: target.email,
    transactionNo: getSnowId(),
    transactionType: CreditTransactionType.GRANT,
    transactionScene: CreditTransactionScene.GIFT,
    credits,
    remainingCredits: credits,
    status: CreditStatus.ACTIVE,
    description,
    orderNo: '',
    subscriptionNo: '',
    expiresAt,
  };
  const [inserted] = await db
    .insert(schema.credit)
    .values(newCredit)
    .returning();
  console.log(
    `Granted ${credits} credits. transactionNo=${inserted.transactionNo}`
  );

  // Balance after
  const afterRows = await db
    .select()
    .from(schema.credit)
    .where(eq(schema.credit.userId, target.id));
  const balanceAfter = afterRows
    .filter(
      (r) =>
        r.transactionType === CreditTransactionType.GRANT &&
        r.status === CreditStatus.ACTIVE &&
        (r.expiresAt === null || r.expiresAt > new Date())
    )
    .reduce((sum, r) => sum + (r.remainingCredits ?? 0), 0);
  console.log(`Balance after:  ${balanceAfter}`);
  console.log(`Delta:          +${balanceAfter - balanceBefore}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
