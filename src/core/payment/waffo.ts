import {
  Environment,
  WaffoPancake,
  type WebhookEventData,
} from '@waffo/pancake-ts';

import {
  CheckoutSession,
  PaymentConfigs,
  PaymentEvent,
  PaymentEventType,
  PaymentInterval,
  PaymentOrder,
  PaymentProvider,
  PaymentSession,
  PaymentStatus,
  SubscriptionCycleType,
  SubscriptionInfo,
  SubscriptionStatus,
} from './types';

/**
 * Waffo Pancake hosted-checkout configuration.
 *
 * `merchantId` and `privateKey` come from Pancake Dashboard → API &
 * Development. The optional public key comes from Dashboard → Integration and
 * is used to verify incoming webhook signatures.
 */
export interface WaffoConfigs extends PaymentConfigs {
  merchantId: string;
  privateKey: string;
  environment?: 'test' | 'prod';
  webhookPublicKey?: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

function toMinorAmount(amount: string | undefined, currency: string): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100));
}

function toDate(value: string | undefined, fallback: string): Date {
  const parsed = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

/**
 * Waffo Pancake payment provider implementation.
 *
 * Pancake hosts checkout, so card data never reaches the application. Payment
 * success is confirmed from a signed Webhook; a return URL only means the
 * customer navigated back to the application.
 */
export class WaffoProvider implements PaymentProvider {
  readonly name = 'waffo';
  configs: WaffoConfigs;

  private client: WaffoPancake;

  constructor(configs: WaffoConfigs) {
    this.configs = configs;
    const environment =
      configs.environment === 'prod' ? Environment.Prod : Environment.Test;

    this.client = new WaffoPancake({
      merchantId: configs.merchantId,
      // Support either pasted PEM line breaks or an env-style `\\n` value.
      privateKey: configs.privateKey.replace(/\\\\n/g, '\n'),
      environment,
      webhookPublicKey: configs.webhookPublicKey || undefined,
    });
  }

  async createPayment({
    order,
  }: {
    order: PaymentOrder;
  }): Promise<CheckoutSession> {
    if (!order.productId) {
      throw new Error('Waffo productId is required');
    }
    if (!order.orderNo) {
      throw new Error('Waffo orderNo is required');
    }

    const checkout = await this.client.checkout.authenticated.create({
      productId: order.productId,
      currency: (order.price?.currency || 'USD').toUpperCase(),
      buyerIdentity:
        order.customer?.id || order.customer?.email || order.orderNo,
      buyerEmail: order.customer?.email,
      successUrl: order.successUrl,
      metadata: this.stringifyMetadata(order.metadata),
      // This internal order ID is returned in every payment and subscription
      // webhook, so it is the durable reconciliation key for our database.
      orderMerchantExternalId: order.orderNo,
    });

    return {
      provider: this.name,
      checkoutParams: {
        productId: order.productId,
        currency: (order.price?.currency || 'USD').toUpperCase(),
        orderMerchantExternalId: order.orderNo,
      },
      checkoutInfo: {
        sessionId: checkout.sessionId,
        checkoutUrl: checkout.checkoutUrl,
      },
      checkoutResult: checkout,
      metadata: order.metadata || {},
    };
  }

  /**
   * Pancake considers its signed Webhook authoritative. The SDK deliberately
   * has no checkout-session status API; returning PROCESSING keeps a success
   * redirect from granting credits before that webhook is verified.
   */
  async getPaymentSession({
    sessionId,
  }: {
    sessionId: string;
  }): Promise<PaymentSession> {
    return {
      provider: this.name,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentResult: { id: sessionId },
    };
  }

  async getPaymentEvent({ req }: { req: Request }): Promise<PaymentEvent> {
    const rawBody = await req.text();
    const signature =
      req.headers.get('x-waffo-signature') || req.headers.get('x-signature');

    if (!rawBody || !signature) {
      throw new Error('Invalid Waffo webhook request');
    }

    const event = this.client.webhooks.verify<WebhookEventData>(
      rawBody,
      signature,
      {
        environment:
          this.configs.environment === 'prod'
            ? Environment.Prod
            : Environment.Test,
      }
    );
    const eventType = this.mapEventType(event.eventType);

    if (eventType === PaymentEventType.PAYMENT_REFUNDED) {
      return { eventType, eventResult: event };
    }

    return {
      eventType,
      eventResult: event,
      paymentSession: this.buildPaymentSession(event),
    };
  }

  async cancelSubscription({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<PaymentSession> {
    const result = await this.client.orders.cancelSubscription({
      orderId: subscriptionId,
    });
    const isPendingCancel = result.status === 'canceling';
    const now = new Date();

    return {
      provider: this.name,
      subscriptionId: result.orderId,
      subscriptionResult: result,
      subscriptionInfo: {
        subscriptionId: result.orderId,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        status: isPendingCancel
          ? SubscriptionStatus.PENDING_CANCEL
          : SubscriptionStatus.CANCELED,
        canceledAt: now,
        canceledReason: 'Canceled by user',
        canceledReasonType: 'user_request',
      },
    };
  }

  private mapEventType(eventType: string): PaymentEventType {
    switch (eventType) {
      case 'order.completed':
      case 'subscription.activated':
        return PaymentEventType.CHECKOUT_SUCCESS;
      case 'subscription.payment_succeeded':
        return PaymentEventType.PAYMENT_SUCCESS;
      case 'subscription.canceling':
      case 'subscription.uncanceled':
      case 'subscription.updated':
      case 'subscription.past_due':
        return PaymentEventType.SUBSCRIBE_UPDATED;
      case 'subscription.canceled':
        return PaymentEventType.SUBSCRIBE_CANCELED;
      case 'refund.succeeded':
      case 'refund.failed':
        return PaymentEventType.PAYMENT_REFUNDED;
      default:
        throw new Error(`Unsupported Waffo webhook event: ${eventType}`);
    }
  }

  private buildPaymentSession(event: {
    eventType: string;
    timestamp: string;
    data: WebhookEventData;
  }): PaymentSession {
    const data = event.data;
    const isSubscription = event.eventType.startsWith('subscription.');
    const isPaymentSuccess =
      event.eventType === 'order.completed' ||
      event.eventType === 'subscription.activated' ||
      event.eventType === 'subscription.payment_succeeded';
    const currency = (data.currency || 'USD').toUpperCase();
    const paidAt = toDate(data.paymentDate, event.timestamp);
    const paymentAmount = toMinorAmount(data.total || data.amount, currency);

    const session: PaymentSession = {
      provider: this.name,
      paymentResult: {
        ...data,
        // The service also checks `orderMerchantExternalId` directly. `id`
        // keeps this event consistent with existing provider result shapes.
        id: data.orderMerchantExternalId || data.orderId,
      },
      metadata: data.orderMetadata || {},
    };

    if (isPaymentSuccess) {
      session.paymentStatus = PaymentStatus.SUCCESS;
      session.paymentInfo = {
        transactionId: data.paymentId || data.orderId,
        paymentAmount,
        paymentCurrency: currency,
        paymentEmail: data.buyerEmail,
        paymentUserId: data.merchantProvidedBuyerIdentity,
        paidAt,
        invoiceId: data.paymentId || data.orderId,
        subscriptionCycleType:
          event.eventType === 'subscription.payment_succeeded'
            ? SubscriptionCycleType.RENEWAL
            : SubscriptionCycleType.CREATE,
      };
    }

    if (isSubscription) {
      session.subscriptionId = data.orderId;
      session.subscriptionInfo = this.buildSubscriptionInfo(event);
      session.subscriptionResult = data;
    }

    return session;
  }

  private buildSubscriptionInfo(event: {
    eventType: string;
    timestamp: string;
    data: WebhookEventData;
  }): SubscriptionInfo {
    const data = event.data;
    const currency = (data.currency || 'USD').toUpperCase();
    const currentPeriodStart = toDate(data.currentPeriodStart, event.timestamp);
    const currentPeriodEnd = toDate(
      data.currentPeriodEnd,
      data.currentPeriodStart || event.timestamp
    );
    const { interval, intervalCount } = this.mapInterval(data.billingPeriod);

    return {
      subscriptionId: data.orderId,
      description: data.productDescription || data.productName,
      amount: toMinorAmount(data.total || data.amount, currency),
      currency,
      interval,
      intervalCount,
      currentPeriodStart,
      currentPeriodEnd,
      metadata: data.orderMetadata,
      status: this.mapSubscriptionStatus(data.orderStatus, event.eventType),
      canceledAt: data.canceledAt
        ? toDate(data.canceledAt, event.timestamp)
        : undefined,
      canceledEndAt:
        event.eventType === 'subscription.canceling'
          ? currentPeriodEnd
          : undefined,
    };
  }

  private mapInterval(billingPeriod: string | undefined): {
    interval: PaymentInterval;
    intervalCount: number;
  } {
    switch (billingPeriod) {
      case 'weekly':
        return { interval: PaymentInterval.WEEK, intervalCount: 1 };
      case 'quarterly':
        return { interval: PaymentInterval.MONTH, intervalCount: 3 };
      case 'yearly':
        return { interval: PaymentInterval.YEAR, intervalCount: 1 };
      case 'monthly':
      default:
        return { interval: PaymentInterval.MONTH, intervalCount: 1 };
    }
  }

  private mapSubscriptionStatus(
    status: string | undefined,
    eventType: string
  ): SubscriptionStatus {
    if (eventType === 'subscription.canceling' || status === 'canceling') {
      return SubscriptionStatus.PENDING_CANCEL;
    }
    if (
      eventType === 'subscription.canceled' ||
      status === 'canceled' ||
      status === 'closed'
    ) {
      return SubscriptionStatus.CANCELED;
    }
    if (eventType === 'subscription.past_due' || status === 'past_due') {
      return SubscriptionStatus.PAUSED;
    }
    if (status === 'expired') return SubscriptionStatus.EXPIRED;
    return SubscriptionStatus.ACTIVE;
  }

  private stringifyMetadata(
    metadata: Record<string, unknown> | undefined
  ): Record<string, string> | undefined {
    if (!metadata) return undefined;
    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value)])
    );
  }
}

export function createWaffoProvider(configs: WaffoConfigs): WaffoProvider {
  return new WaffoProvider(configs);
}
