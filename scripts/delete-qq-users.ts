/**
 * One-off cleanup: delete every user whose email is hosted by QQ Mail
 * (Tencent's free-mail family: @qq.com and the @foxmail.com alias).
 *
 * Scope:
 *   - The `user` row itself, plus everything that cascades from it:
 *     account, session, order, subscription, credit, apikey, aiTask,
 *     chat (+ chatMessage), userRole, taxonomy, post.
 *   - Non-cascading user-owned rows are deleted first to keep PG happy:
 *     ticket, ticketMessage, pptTask, docCollection (cascades to its
 *     documents + messages), userInvite.
 *   - `inviteCode.createdBy` is nullable → we NULL it out instead of
 *     deleting the invite, so already-issued codes keep working.
 *
 * Usage:
 *   tsx scripts/with-env.ts tsx scripts/delete-qq-users.ts                  # dry run
 *   tsx scripts/with-env.ts tsx scripts/delete-qq-users.ts --apply         # actually delete
 *   ENV_FILE=.env.production tsx scripts/with-env.ts tsx scripts/delete-qq-users.ts --apply
 *
 * Safety:
 *   - Refuses to mutate without --apply.
 *   - Prints a full inventory (rows + credit balance) BEFORE asking.
 *   - Wraps the destructive phase in a single transaction; on any error
 *     nothing is committed.
 *   - Echoes the DB host on every run so you can sanity-check the
 *     environment file before confirming.
 */

import { count, eq, inArray, sql, sum } from 'drizzle-orm';

import { envConfigs } from '../src/config';
import * as schema from '../src/config/db/schema';
import { db as dbFn } from '../src/core/db';

const QQ_EMAIL_REGEX = /@(?:qq|foxmail)\.com$/i;

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(
    `DB provider: ${envConfigs.database_provider}, url host: ${
      envConfigs.database_url?.split('@')[1]?.split('/')[0] ?? 'NONE'
    }`
  );
  console.log(`Mode: ${apply ? '🔴 APPLY (will DELETE)' : '🟢 DRY RUN'}\n`);

  const db = dbFn();

  // ─── Inventory ────────────────────────────────────────────────────────────
  const targets = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      createdAt: schema.user.createdAt,
      ip: schema.user.ip,
    })
    .from(schema.user)
    .where(sql`LOWER(${schema.user.email}) ~ ${QQ_EMAIL_REGEX.source}`);

  if (targets.length === 0) {
    console.log('No QQ-Mail users found. Nothing to do.');
    process.exit(0);
  }

  const targetIds = targets.map((t) => t.id);

  const creditSum = await db
    .select({ total: sum(schema.credit.credits) })
    .from(schema.credit)
    .where(inArray(schema.credit.userId, targetIds));

  const depCounts = await Promise.all(
    [
      ['session', schema.session],
      ['account', schema.account],
      ['order', schema.order],
      ['subscription', schema.subscription],
      ['credit', schema.credit],
      ['apikey', schema.apikey],
      ['userRole', schema.userRole],
      ['aiTask', schema.aiTask],
      ['chat', schema.chat],
      ['chatMessage', schema.chatMessage],
      ['taxonomy', schema.taxonomy],
      ['post', schema.post],
      ['ticket', schema.ticket],
      ['ticketMessage', schema.ticketMessage],
      ['pptTask', schema.pptTask],
      ['docCollection', schema.docCollection],
      ['docCollectionDocument', schema.docCollectionDocument],
      ['docCollectionMessage', schema.docCollectionMessage],
      ['userInvite', schema.userInvite],
    ].map(async ([label, table]) => {
      const t = table as any;
      const [row] = await db
        .select({ n: count() })
        .from(t)
        .where(inArray(t.userId, targetIds));
      return [label as string, Number(row?.n ?? 0)] as const;
    })
  );

  const inviteCodesCreatedBy = await db
    .select({ n: count() })
    .from(schema.inviteCode)
    .where(inArray(schema.inviteCode.createdBy, targetIds));

  console.log(`Found ${targets.length} QQ-Mail user(s):`);
  for (const t of targets) {
    console.log(`   - ${t.email}  (id=${t.id}, name=${t.name})`);
  }

  console.log('\nDependent rows that will be removed (cascaded + explicit):');
  for (const [label, n] of depCounts) {
    if (n > 0) console.log(`   ${label.padEnd(22)} ${n}`);
  }
  const inviteN = Number(inviteCodesCreatedBy[0]?.n ?? 0);
  if (inviteN > 0) {
    console.log(
      `   ${'inviteCode.createdBy'.padEnd(22)} ${inviteN}  (will be NULLed, codes preserved)`
    );
  }
  console.log(
    `\nTotal credits removed (lifetime grant + purchase, all scenes): ${creditSum[0]?.total ?? 0}`
  );

  if (!apply) {
    console.log('\nRe-run with --apply to commit the deletion.');
    process.exit(0);
  }

  // ─── Apply ────────────────────────────────────────────────────────────────
  console.log('\n🔴 Deleting in transaction…');

  await db.transaction(async (tx: any) => {
    // Non-cascading user-owned rows first. ticketMessage → ticket must
    // happen in that order (ticketMessage has an FK to ticket.id with
    // no cascade). docCollection cascades to its documents + messages,
    // so deleting the collection cleans up the rest.
    await tx
      .delete(schema.ticketMessage)
      .where(inArray(schema.ticketMessage.userId, targetIds));
    await tx
      .delete(schema.ticket)
      .where(inArray(schema.ticket.userId, targetIds));
    await tx
      .delete(schema.pptTask)
      .where(inArray(schema.pptTask.userId, targetIds));
    await tx
      .delete(schema.userInvite)
      .where(inArray(schema.userInvite.userId, targetIds));
    await tx
      .delete(schema.docCollection)
      .where(inArray(schema.docCollection.userId, targetIds));

    // invitedBy is nullable — clear the audit pointer rather than nuking
    // codes that other users may have already redeemed.
    if (inviteN > 0) {
      await tx
        .update(schema.inviteCode)
        .set({ createdBy: null as any })
        .where(inArray(schema.inviteCode.createdBy, targetIds));
    }

    // User row cascades to: account, session, order, subscription,
    // credit, apikey, userRole, aiTask, chat, chatMessage, taxonomy, post.
    await tx.delete(schema.user).where(inArray(schema.user.id, targetIds));
  });

  // ─── Verify ───────────────────────────────────────────────────────────────
  const remaining = await db
    .select({ n: count() })
    .from(schema.user)
    .where(sql`LOWER(${schema.user.email}) ~ ${QQ_EMAIL_REGEX.source}`);

  console.log(
    `\n✅ Done. QQ-Mail users remaining in DB: ${remaining[0]?.n ?? 0}.`
  );
  console.log('   Restart the app to clear any in-process caches.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
