import {
  PaymentProvider,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentOrder,
  type PaymentSession,
} from './types';

/**
 * Payment manager to manage all payment providers
 */
export class PaymentManager {
  // payment providers
  private providers: PaymentProvider[] = [];
  private defaultProvider?: PaymentProvider;

  // add payment provider
  addProvider(provider: PaymentProvider, isDefault = false) {
    this.providers.push(provider);
    if (isDefault) {
      this.defaultProvider = provider;
    }
  }

  // get provider by name — returns undefined if no provider with this exact
  // name is registered. Do NOT silently fall back to the default provider: an
  // explicit name must resolve to that provider or fail clearly, otherwise a
  // selected-but-unconfigured provider (e.g. PayPal) would be silently routed
  // to the default one and surface as a confusing error from the wrong API.
  getProvider(name: string): PaymentProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  // get all provider names
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  getDefaultProvider(): PaymentProvider | undefined {
    // set default provider if not set
    if (!this.defaultProvider && this.providers.length > 0) {
      this.defaultProvider = this.providers[0];
    }

    return this.defaultProvider;
  }

  // create payment using default provider
  async createPayment({
    order,
    provider,
  }: {
    order: PaymentOrder;
    provider?: string;
  }): Promise<CheckoutSession> {
    if (provider) {
      const providerInstance = this.getProvider(provider);
      if (!providerInstance) {
        throw new Error(`Payment provider '${provider}' not found`);
      }
      return providerInstance.createPayment({ order });
    }

    const defaultProvider = this.getDefaultProvider();
    if (!defaultProvider) {
      throw new Error('No payment provider configured');
    }

    return defaultProvider.createPayment({ order });
  }

  // get payment session using default provider
  async getPaymentSession({
    sessionId,
    provider,
  }: {
    sessionId: string;
    provider?: string;
  }): Promise<PaymentSession | null> {
    if (provider) {
      const providerInstance = this.getProvider(provider);
      if (!providerInstance) {
        throw new Error(`Payment provider '${provider}' not found`);
      }
      return providerInstance.getPaymentSession({ sessionId });
    }

    const defaultProvider = this.getDefaultProvider();
    if (!defaultProvider) {
      throw new Error('No payment provider configured');
    }

    return defaultProvider.getPaymentSession({ sessionId });
  }

  // handle webhook using specific provider
  async getPaymentEvent({
    req,
    provider,
  }: {
    req: Request;
    provider?: string;
  }): Promise<PaymentEvent> {
    if (provider) {
      const providerInstance = this.getProvider(provider);
      if (!providerInstance) {
        throw new Error(`Payment provider '${provider}' not found`);
      }
      return providerInstance.getPaymentEvent({ req });
    }

    const defaultProvider = this.getDefaultProvider();
    if (!defaultProvider) {
      throw new Error('No payment provider configured');
    }

    return defaultProvider.getPaymentEvent({ req });
  }
}

// Global payment manager instance
export const paymentManager = new PaymentManager();

// Export all providers
export * from './stripe';
export * from './creem';
export * from './paypal';
export * from './alipay';
export * from './wechat';
