import { eq, and, desc, isNull } from 'drizzle-orm';
import { PaymentManager, StripeProvider } from '@/core/payment';
import type { PaymentOrder, CheckoutSession, PaymentEvent } from '@/core/payment/types';
import { PaymentStatus, PaymentType } from '@/core/payment/types';
import { getUuid, getUniSeq, getSnowId } from '@/lib/hash';
import { db } from '@/core/db';
import { order, subscription, credit } from '@/config/db/schema';
import { envConfigs } from '@/config';
import {
  SubscriptionStatus,
  type NewSubscription,
  type UpdateSubscription,
  findByProviderSubscriptionId,
  updateBySubscriptionNo,
} from '@/modules/subscriptions/service';
import { calculateCreditExpirationTime } from '@/modules/credits/service';

// --- Order types ---

enum OrderStatus {
  PENDING = 'pending',
  CREATED = 'created',
  PAID = 'paid',
  FAILED = 'failed',
}

// --- Payment Manager singleton ---

let manager: PaymentManager | null = null;

function getPaymentManager(): PaymentManager {
  if (manager) return manager;
  manager = new PaymentManager();

  if (envConfigs.stripe_secret_key) {
    manager.addProvider(
      new StripeProvider({
        secretKey: envConfigs.stripe_secret_key,
        publishableKey: envConfigs.stripe_publishable_key,
        signingSecret: envConfigs.stripe_signing_secret || undefined,
        allowPromotionCodes: true,
      }),
      true
    );
  }

  return manager;
}

// --- Checkout ---

export async function createCheckout(params: {
  userId: string;
  userEmail?: string;
  paymentOrder: PaymentOrder;
  provider?: string;
}): Promise<CheckoutSession> {
  const { userId, userEmail, paymentOrder, provider } = params;
  const pm = getPaymentManager();
  const orderNo = getUniSeq('ORD');

  const session = await pm.createPayment({
    order: {
      ...paymentOrder,
      orderNo,
      successUrl: paymentOrder.successUrl || `${envConfigs.app_url}/dashboard/billing?success=1`,
      cancelUrl: paymentOrder.cancelUrl || `${envConfigs.app_url}/dashboard/billing?canceled=1`,
    },
    provider,
  });

  await db().insert(order).values({
    id: getUuid(),
    orderNo,
    userId,
    userEmail: userEmail || '',
    status: OrderStatus.CREATED,
    amount: paymentOrder.price?.amount || 0,
    currency: paymentOrder.price?.currency || 'usd',
    productId: paymentOrder.productId || '',
    paymentType: paymentOrder.type || 'one-time',
    paymentProvider: session.provider,
    paymentSessionId: session.checkoutInfo.sessionId,
    checkoutInfo: JSON.stringify(session.checkoutInfo),
    checkoutResult: JSON.stringify(session.checkoutResult),
    checkoutUrl: session.checkoutInfo.checkoutUrl,
    description: paymentOrder.description || '',
  });

  return session;
}

// --- Webhook handling ---

export async function handleWebhook(params: {
  req: Request;
  provider: string;
}): Promise<PaymentEvent> {
  const pm = getPaymentManager();
  const event = await pm.getPaymentEvent({ req: params.req, provider: params.provider });
  const session = event.paymentSession;
  if (!session) return event;

  const eventType = event.eventType;

  // Route event to appropriate handler
  if (eventType === 'checkout.success' || eventType === 'payment.success') {
    await handleCheckoutSuccess(session, params.provider);
  } else if (eventType === 'subscribe.updated') {
    await handleSubscriptionUpdated(session, params.provider);
  } else if (eventType === 'subscribe.canceled') {
    await handleSubscriptionCanceled(session, params.provider);
  }

  return event;
}

// --- Checkout Success: update order + create subscription + grant credits ---

async function handleCheckoutSuccess(session: any, provider: string) {
  const sessionId = session.paymentResult?.id || session.paymentResult?.object?.id || '';
  if (!sessionId) return;

  // Find order by session ID
  const [existingOrder] = await db()
    .select()
    .from(order)
    .where(and(eq(order.paymentSessionId, sessionId), isNull(order.deletedAt)))
    .limit(1);

  if (!existingOrder) return;

  // Idempotency: skip if already paid
  if (existingOrder.status === OrderStatus.PAID) return;
  if (existingOrder.status !== OrderStatus.CREATED && existingOrder.status !== OrderStatus.PENDING) return;

  const paymentInfo = session.paymentInfo;
  const subscriptionInfo = session.subscriptionInfo;

  if (session.paymentStatus === PaymentStatus.SUCCESS) {
    // Prepare order update
    const orderUpdate: Record<string, any> = {
      status: OrderStatus.PAID,
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: paymentInfo?.paymentAmount || null,
      paymentCurrency: paymentInfo?.paymentCurrency || null,
      paymentEmail: paymentInfo?.paymentEmail || null,
      paidAt: paymentInfo?.paidAt || new Date(),
      transactionId: paymentInfo?.transactionId || null,
      invoiceId: paymentInfo?.invoiceId || null,
      invoiceUrl: paymentInfo?.invoiceUrl || null,
      paymentUserName: paymentInfo?.paymentUserName || null,
      paymentUserId: paymentInfo?.paymentUserId || null,
      discountCode: paymentInfo?.discountCode || null,
      discountAmount: paymentInfo?.discountAmount || null,
    };

    // Atomically update order + create subscription + grant credits
    await db().transaction(async (tx: any) => {
      // 1. Create subscription if applicable
      if (subscriptionInfo && session.subscriptionId) {
        const subNo = getSnowId();
        const newSub: any = {
          id: getUuid(),
          subscriptionNo: subNo,
          userId: existingOrder.userId,
          userEmail: existingOrder.userEmail || existingOrder.paymentEmail || '',
          status: subscriptionInfo.status || SubscriptionStatus.ACTIVE,
          paymentProvider: provider,
          subscriptionId: session.subscriptionId,
          subscriptionResult: JSON.stringify(session.subscriptionResult),
          productId: existingOrder.productId,
          description: subscriptionInfo.description || 'Subscription Created',
          amount: subscriptionInfo.amount,
          currency: subscriptionInfo.currency,
          interval: subscriptionInfo.interval,
          intervalCount: subscriptionInfo.intervalCount,
          trialPeriodDays: subscriptionInfo.trialPeriodDays,
          currentPeriodStart: subscriptionInfo.currentPeriodStart,
          currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
          billingUrl: subscriptionInfo.billingUrl,
          planName: existingOrder.planName || existingOrder.productName,
          productName: existingOrder.productName,
          creditsAmount: existingOrder.creditsAmount,
          creditsValidDays: existingOrder.creditsValidDays,
          paymentProductId: existingOrder.paymentProductId,
          paymentUserId: paymentInfo?.paymentUserId,
        };
        await tx.insert(subscription).values(newSub);
        orderUpdate.subscriptionNo = subNo;
        orderUpdate.subscriptionId = session.subscriptionId;
        orderUpdate.subscriptionResult = JSON.stringify(session.subscriptionResult);
      }

      // 2. Grant credits if applicable
      if (existingOrder.creditsAmount && existingOrder.creditsAmount > 0) {
        const credits = existingOrder.creditsAmount;
        const expiresAt = calculateCreditExpirationTime({
          creditsValidDays: existingOrder.creditsValidDays || 0,
          currentPeriodEnd: subscriptionInfo?.currentPeriodEnd,
        });

        await tx.insert(credit).values({
          id: getUuid(),
          userId: existingOrder.userId,
          userEmail: existingOrder.userEmail || '',
          orderNo: existingOrder.orderNo,
          subscriptionNo: orderUpdate.subscriptionNo || '',
          transactionNo: getSnowId(),
          transactionType: 'grant',
          transactionScene: existingOrder.paymentType === 'subscription' ? 'subscription' : 'payment',
          credits,
          remainingCredits: credits,
          description: 'Grant credit',
          expiresAt,
          status: 'active',
        });
      }

      // 3. Update order
      await tx.update(order).set(orderUpdate).where(eq(order.id, existingOrder.id));
    });
  } else if (session.paymentStatus === PaymentStatus.FAILED || session.paymentStatus === PaymentStatus.CANCELED) {
    await db().update(order).set({
      status: OrderStatus.FAILED,
      paymentResult: JSON.stringify(session.paymentResult),
    }).where(eq(order.id, existingOrder.id));
  }
}

// --- Subscription Renewal ---

export async function handleSubscriptionRenewal(session: any, provider: string) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub || !existingSub.amount || !existingSub.currency) return;

  const subscriptionInfo = session.subscriptionInfo;
  if (!subscriptionInfo.currentPeriodStart || !subscriptionInfo.currentPeriodEnd) return;

  if (session.paymentStatus !== PaymentStatus.SUCCESS) return;

  const paymentInfo = session.paymentInfo;
  const renewalOrderNo = getSnowId();

  await db().transaction(async (tx: any) => {
    // 1. Update subscription period
    await tx.update(subscription).set({
      currentPeriodStart: subscriptionInfo.currentPeriodStart,
      currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
    }).where(eq(subscription.subscriptionNo, existingSub.subscriptionNo));

    // 2. Create renewal order
    await tx.insert(order).values({
      id: getUuid(),
      orderNo: renewalOrderNo,
      userId: existingSub.userId,
      userEmail: existingSub.userEmail || '',
      status: OrderStatus.PAID,
      amount: existingSub.amount,
      currency: existingSub.currency,
      productId: existingSub.productId || '',
      paymentType: 'renew',
      paymentInterval: existingSub.interval || '',
      paymentProvider: provider,
      checkoutInfo: '',
      description: 'Subscription Renewal',
      productName: existingSub.productName || '',
      planName: existingSub.planName || '',
      creditsAmount: existingSub.creditsAmount,
      creditsValidDays: existingSub.creditsValidDays,
      paymentProductId: existingSub.paymentProductId || '',
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: paymentInfo?.paymentAmount,
      paymentCurrency: paymentInfo?.paymentCurrency,
      paymentEmail: paymentInfo?.paymentEmail,
      paidAt: paymentInfo?.paidAt || new Date(),
      invoiceId: paymentInfo?.invoiceId,
      invoiceUrl: paymentInfo?.invoiceUrl,
      subscriptionNo: existingSub.subscriptionNo,
      subscriptionId: session.subscriptionId,
      transactionId: paymentInfo?.transactionId,
      paymentUserName: paymentInfo?.paymentUserName,
      paymentUserId: paymentInfo?.paymentUserId,
    });

    // 3. Grant credits for renewal
    if (existingSub.creditsAmount && existingSub.creditsAmount > 0) {
      const credits = existingSub.creditsAmount;
      const expiresAt = calculateCreditExpirationTime({
        creditsValidDays: existingSub.creditsValidDays || 0,
        currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
      });

      await tx.insert(credit).values({
        id: getUuid(),
        userId: existingSub.userId,
        userEmail: existingSub.userEmail || '',
        orderNo: renewalOrderNo,
        subscriptionNo: existingSub.subscriptionNo,
        transactionNo: getSnowId(),
        transactionType: 'grant',
        transactionScene: 'renewal',
        credits,
        remainingCredits: credits,
        description: 'Grant credit',
        expiresAt,
        status: 'active',
      });
    }
  });
}

// --- Subscription Updated ---

async function handleSubscriptionUpdated(session: any, provider: string) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub) return;

  const info = session.subscriptionInfo;
  await updateBySubscriptionNo(existingSub.subscriptionNo, {
    status: info.status,
    currentPeriodStart: info.currentPeriodStart,
    currentPeriodEnd: info.currentPeriodEnd,
    canceledAt: info.canceledAt || null,
    canceledEndAt: info.canceledEndAt || null,
    canceledReason: info.canceledReason || '',
    canceledReasonType: info.canceledReasonType || '',
  });
}

// --- Subscription Canceled ---

async function handleSubscriptionCanceled(session: any, provider: string) {
  if (!session.subscriptionId || !session.subscriptionInfo) return;

  const existingSub = await findByProviderSubscriptionId({
    provider,
    subscriptionId: session.subscriptionId,
  });
  if (!existingSub) return;

  const info = session.subscriptionInfo;
  await updateBySubscriptionNo(existingSub.subscriptionNo, {
    status: SubscriptionStatus.CANCELED,
    canceledAt: info.canceledAt,
    canceledEndAt: info.canceledEndAt,
    canceledReason: info.canceledReason,
    canceledReasonType: info.canceledReasonType,
  });
}

// --- Query helpers ---

export async function getUserOrders(userId: string) {
  return db()
    .select()
    .from(order)
    .where(and(eq(order.userId, userId), isNull(order.deletedAt)))
    .orderBy(desc(order.createdAt));
}
