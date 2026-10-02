'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { usePaymentProviders } from '@/hooks/use-payment-providers';
import { usePublicConfig } from '@/hooks/use-public-config';
import {
  PaymentProviderModal,
  type PaymentProvider,
} from '@/components/payment-provider-modal';
import {
  PricingTable,
  type PricingGroup,
  type PricingPlan,
} from '@/components/pricing-table';

type BillingMode = 'packs' | 'monthly' | 'yearly';

function feat(iconComponent: any, label: string) {
  return { icon: iconComponent, label };
}

// Feature builders — one per tier. Every bullet must describe something the
// product actually ships: buyers who spot an invented feature (SSO, SLAs,
// team seats…) stop trusting the price next to it.

/** Conservative credits-per-message used for the "≈ N messages" estimate.
 * Production median for a Kimi K3 reply is ~3 credits and the mean ~15
 * (skewed by long documents); 10 keeps the estimate honest for most users. */
const CREDITS_PER_MESSAGE_ESTIMATE = 10;

export function estimateMessages(credits: number): string {
  const n = Math.floor(credits / CREDITS_PER_MESSAGE_ESTIMATE);
  const rounded =
    n >= 1000 ? Math.floor(n / 100) * 100 : Math.floor(n / 10) * 10;
  return rounded.toLocaleString('en-US');
}

type Feature = { icon: any; label: string };

function creditLines(
  icon: any,
  credits: number,
  period: 'month' | 'year' | 'once'
): Feature[] {
  const creditLabel =
    period === 'month'
      ? m['landing.pricing.feature_credits_month']({ credits })
      : period === 'year'
        ? m['landing.pricing.feature_credits_year']({ credits })
        : m['landing.pricing.feature_credits_once']({ credits });
  return [
    feat(icon, creditLabel),
    feat(
      icon,
      m['landing.pricing.feature_messages_estimate']({
        count: estimateMessages(credits),
      })
    ),
  ];
}

function buildLiteFeatures(
  icon: any,
  credits: number,
  period: 'month' | 'year'
): Feature[] {
  return [
    ...creditLines(icon, credits, period),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_premium_models']()),
    feat(icon, m['landing.pricing.feature_file_tools']()),
    feat(icon, m['landing.pricing.feature_image_gen']()),
    feat(icon, m['landing.pricing.feature_email_support']()),
    feat(icon, m['landing.pricing.feature_cancel_anytime']()),
  ];
}

function buildPlusFeatures(
  icon: any,
  credits: number,
  period: 'month' | 'year'
): Feature[] {
  return [
    ...creditLines(icon, credits, period),
    feat(icon, m['landing.pricing.feature_includes_lite']()),
    feat(icon, m['landing.pricing.feature_priority_support']()),
    feat(icon, m['landing.pricing.feature_cancel_anytime']()),
  ];
}

function buildProFeatures(
  icon: any,
  credits: number,
  period: 'month' | 'year'
): Feature[] {
  return [
    ...creditLines(icon, credits, period),
    feat(icon, m['landing.pricing.feature_includes_plus']()),
    feat(icon, m['landing.pricing.feature_best_per_request']()),
    feat(icon, m['landing.pricing.feature_priority_support']()),
    feat(icon, m['landing.pricing.feature_cancel_anytime']()),
  ];
}

function withYearlySaving(features: Feature[], icon: any, pct: number) {
  return [
    ...features,
    feat(icon, m['landing.pricing.feature_save_pct']({ pct })),
  ];
}

function buildPackFeatures(icon: any, credits: number): Feature[] {
  return [
    ...creditLines(icon, credits, 'once'),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_premium_models']()),
    feat(icon, m['landing.pricing.feature_file_tools']()),
    feat(icon, m['landing.pricing.feature_no_expiry']()),
    feat(icon, m['landing.pricing.feature_no_subscription']()),
  ];
}

export function Pricing({
  title,
  description,
  embedded = false,
}: {
  title?: string;
  description?: string;
  /** Render the full pricing selector inside another surface, such as a paywall dialog. */
  embedded?: boolean;
} = {}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: publicConfig } = usePublicConfig();
  const { data: paymentProviderData, isLoading: paymentProvidersLoading } =
    usePaymentProviders();
  // Three tabs: left = one-time packs, middle = monthly, right = yearly.
  // Default to one-time packs: a $9 no-subscription pack is the easiest first
  // purchase for a visitor who has just tried the product.
  const [mode, setMode] = useState<BillingMode>('packs');
  const [paymentPlan, setPaymentPlan] = useState<PricingPlan | null>(null);

  // The server returns the providers actually registered in PaymentManager.
  // Adding a future provider only requires registering it there; the picker
  // discovers it automatically without a pricing-page edit.
  const paymentProviders = paymentProviderData?.providers ?? [];
  const showPaymentProviderSelector =
    paymentProviders.length > 1 &&
    publicConfig?.select_payment_enabled !== 'false';

  // Per product: monthly price, monthly credits, monthly productId
  const liteMonthly = {
    id: 'lite_monthly',
    price: 19,
    credits: 1292,
    productId: 'lite_monthly',
  };
  const plusMonthly = {
    id: 'plus_monthly',
    price: 39,
    credits: 2652,
    productId: 'plus_monthly',
  };
  const proMonthly = {
    id: 'pro_monthly',
    price: 99,
    credits: 6732,
    productId: 'pro_monthly',
  };

  // Per product: yearly total (= 12 × monthlyEquiv), yearly credits (= 12 × monthly credits), monthly-equivalent display, yearly productId
  // `price` and `monthlyEquiv` always reconcile (12 × monthly = yearly), so the
  // card subline "billed annually · $X/yr" matches the big number.
  // Yearly credits mirror the API Credits unit used by monthly plans.
  const liteYearly = {
    id: 'lite_yearly',
    price: 180,
    monthlyEquiv: 15,
    credits: 15504,
    productId: 'lite_yearly',
  };
  const plusYearly = {
    id: 'plus_yearly',
    price: 420,
    monthlyEquiv: 35,
    credits: 31824,
    productId: 'plus_yearly',
  };
  const proYearly = {
    id: 'pro_yearly',
    price: 948,
    monthlyEquiv: 79,
    credits: 80784,
    productId: 'pro_yearly',
  };

  // Monthly subscription plans — flat $19/$39/$99 per month.
  const monthlyPlans: PricingPlan[] = useMemo(
    () => [
      {
        id: liteMonthly.id,
        name: m['landing.pricing.tier.lite'](),
        description: m['landing.pricing.tier.lite_desc'](),
        price: `$${liteMonthly.price}`,
        originalPrice: undefined,
        interval: 'mo',
        priceInCents: liteMonthly.price * 100,
        currency: 'usd',
        credits: liteMonthly.credits,
        productId: liteMonthly.productId,
        productName: 'Lite',
        buttonText: m['landing.pricing.subscribe_monthly'](),
        features: buildLiteFeatures(Zap, liteMonthly.credits, 'month'),
      },
      {
        id: plusMonthly.id,
        name: m['landing.pricing.tier.plus'](),
        description: m['landing.pricing.tier.plus_desc'](),
        price: `$${plusMonthly.price}`,
        originalPrice: undefined,
        interval: 'mo',
        featured: true,
        badge: m['landing.pricing.popular'](),
        priceInCents: plusMonthly.price * 100,
        currency: 'usd',
        credits: plusMonthly.credits,
        productId: plusMonthly.productId,
        productName: 'Plus',
        buttonText: m['landing.pricing.subscribe_monthly'](),
        features: buildPlusFeatures(Zap, plusMonthly.credits, 'month'),
      },
      {
        id: proMonthly.id,
        name: m['landing.pricing.tier.pro'](),
        description: m['landing.pricing.tier.pro_desc'](),
        price: `$${proMonthly.price}`,
        originalPrice: undefined,
        interval: 'mo',
        priceInCents: proMonthly.price * 100,
        currency: 'usd',
        credits: proMonthly.credits,
        productId: proMonthly.productId,
        productName: 'Pro',
        buttonText: m['landing.pricing.subscribe_monthly'](),
        features: buildProFeatures(Zap, proMonthly.credits, 'month'),
      },
    ],
    []
  );

  // Yearly subscription plans — UI shows monthly equivalent, CTA shows total yearly price.
  const yearlyPlans: PricingPlan[] = useMemo(
    () => [
      {
        id: liteYearly.id,
        name: m['landing.pricing.tier.lite'](),
        description: m['landing.pricing.tier.lite_desc'](),
        price: `$${liteYearly.monthlyEquiv}`,
        originalPrice: `$${liteMonthly.price}`,
        interval: 'mo',
        yearlyTotal: `$${liteYearly.price}`,
        yearlySubline: m['landing.pricing.per_year_suffix'](),
        yearlyCta: m['landing.pricing.subscribe_yearly'](),
        priceInCents: liteYearly.price * 100,
        currency: 'usd',
        credits: liteYearly.credits,
        productId: liteYearly.productId,
        productName: 'Lite',
        buttonText: `${m['landing.pricing.subscribe_yearly']()} · $${liteYearly.price}`,
        features: withYearlySaving(
          buildLiteFeatures(Zap, liteYearly.credits, 'year'),
          Zap,
          21
        ),
      },
      {
        id: plusYearly.id,
        name: m['landing.pricing.tier.plus'](),
        description: m['landing.pricing.tier.plus_desc'](),
        price: `$${plusYearly.monthlyEquiv}`,
        originalPrice: `$${plusMonthly.price}`,
        interval: 'mo',
        yearlyTotal: `$${plusYearly.price}`,
        yearlySubline: m['landing.pricing.per_year_suffix'](),
        yearlyCta: m['landing.pricing.subscribe_yearly'](),
        featured: true,
        badge: m['landing.pricing.popular'](),
        priceInCents: plusYearly.price * 100,
        currency: 'usd',
        credits: plusYearly.credits,
        productId: plusYearly.productId,
        productName: 'Plus',
        buttonText: `${m['landing.pricing.subscribe_yearly']()} · $${plusYearly.price}`,
        features: withYearlySaving(
          buildPlusFeatures(Zap, plusYearly.credits, 'year'),
          Zap,
          10
        ),
      },
      {
        id: proYearly.id,
        name: m['landing.pricing.tier.pro'](),
        description: m['landing.pricing.tier.pro_desc'](),
        price: `$${proYearly.monthlyEquiv}`,
        originalPrice: `$${proMonthly.price}`,
        interval: 'mo',
        yearlyTotal: `$${proYearly.price}`,
        yearlySubline: m['landing.pricing.per_year_suffix'](),
        yearlyCta: m['landing.pricing.subscribe_yearly'](),
        priceInCents: proYearly.price * 100,
        currency: 'usd',
        credits: proYearly.credits,
        productId: proYearly.productId,
        productName: 'Pro',
        buttonText: `${m['landing.pricing.subscribe_yearly']()} · $${proYearly.price}`,
        features: withYearlySaving(
          buildProFeatures(Zap, proYearly.credits, 'year'),
          Zap,
          20
        ),
      },
    ],
    []
  );

  // One-time packs group (no toggle).
  const onetimePlans: PricingPlan[] = useMemo(
    () => [
      {
        id: 'starter_once',
        name: m['landing.pricing.pack.starter'](),
        description: m['landing.pricing.pack.starter_desc'](),
        price: '$9',
        priceInCents: 900,
        currency: 'usd',
        credits: 612,
        productId: 'starter_once',
        productName: 'Starter Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildPackFeatures(Zap, 612),
      },
      {
        id: 'standard_once',
        name: m['landing.pricing.pack.pro'](),
        description: m['landing.pricing.pack.pro_desc'](),
        price: '$29',
        featured: true,
        badge: m['landing.pricing.popular'](),
        priceInCents: 2900,
        currency: 'usd',
        credits: 1972,
        productId: 'standard_once',
        productName: 'Standard Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildPackFeatures(Zap, 1972),
      },
      {
        id: 'boost_once',
        name: m['landing.pricing.pack.scale'](),
        description: m['landing.pricing.pack.scale_desc'](),
        price: '$79',
        badge: m['landing.pricing.best_value'](),
        priceInCents: 7900,
        currency: 'usd',
        credits: 5372,
        productId: 'boost_once',
        productName: 'Boost Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildPackFeatures(Zap, 5372),
      },
    ],
    []
  );

  // Single active group — the outer BillingModeToggle chooses which plans show.
  // Wrapping in a single-element array keeps PricingTable's group-toggle hidden
  // (it only renders when groups.length > 1).
  const groups: PricingGroup[] = useMemo(() => {
    const plans =
      mode === 'packs'
        ? onetimePlans
        : mode === 'monthly'
          ? monthlyPlans
          : yearlyPlans;
    return [{ key: mode, label: '', plans }];
  }, [mode, monthlyPlans, yearlyPlans, onetimePlans]);

  const checkoutMutation = useMutation({
    mutationFn: ({
      plan,
      provider,
    }: {
      plan: PricingPlan;
      provider?: PaymentProvider;
    }) =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: plan.productId,
        product_name: plan.productName || plan.name,
        plan_name: plan.productName || plan.name,
        price: plan.priceInCents,
        currency: plan.currency || 'usd',
        // Server reads the catalog and decides type itself.
        description: plan.name,
        credits: plan.credits,
        payment_provider: provider,
      }),
    onSuccess: (data) => {
      if (!data?.checkout_url) {
        toast.error('Checkout failed');
        return;
      }
      window.location.href = data.checkout_url;
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Checkout failed');
    },
  });

  function beginCheckout(plan: PricingPlan, provider?: PaymentProvider) {
    checkoutMutation.mutate({ plan, provider });
  }

  function handleCheckout(plan: PricingPlan) {
    if (!plan.priceInCents) return;

    if (!session?.user) {
      const redirect = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '/pricing'
      );
      router.push(`/sign-in?redirect=${redirect}`);
      return;
    }

    if (showPaymentProviderSelector) {
      setPaymentPlan(plan);
      return;
    }

    if (paymentProvidersLoading) {
      toast.message('Loading payment methods...');
      return;
    }

    const provider = paymentProviderData?.defaultProvider;
    if (!provider) {
      toast.error('No payment provider is configured');
      return;
    }

    beginCheckout(plan, provider);
  }

  function handlePaymentProviderSelect(provider: PaymentProvider) {
    if (!paymentPlan) return;
    beginCheckout(paymentPlan, provider);
  }

  if (embedded) {
    const activePlans = groups[0]?.plans ?? [];
    return (
      <>
        <div className="w-full bg-white px-4 pt-4 pb-3 sm:px-5 sm:pt-5 sm:pb-4">
          <div className="relative top-2 mb-4 flex items-start justify-between gap-4">
            <div className="w-full">
              <p className="text-muted-foreground text-center text-sm leading-normal whitespace-nowrap">
                {description ?? m['landing.pricing.description']()}
              </p>
            </div>
          </div>

          <div className="relative top-2">
            <BillingModeToggle value={mode} onChange={setMode} compact />
          </div>

          <div className="grid gap-2.5">
            {activePlans.map((plan) => {
              const isYearly = mode === 'yearly';
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'group relative rounded-2xl border p-3.5 transition-colors',
                    plan.featured
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card hover:border-foreground/30'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold">{plan.name}</h3>
                        {plan.badge ? (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-medium',
                              plan.featured
                                ? 'bg-background/15 text-background/80'
                                : 'bg-foreground/8 text-muted-foreground'
                            )}
                          >
                            {plan.badge}
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          'mt-0.5 text-xs',
                          plan.featured
                            ? 'text-background/60'
                            : 'text-muted-foreground'
                        )}
                      >
                        {plan.credits.toLocaleString()} Credits
                        {isYearly ? ' / year' : ''} ·{' '}
                        {m['landing.pricing.feature_messages_estimate']({
                          count: estimateMessages(plan.credits),
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold tracking-tight">
                        {plan.price}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckout(plan)}
                      disabled={checkoutMutation.isPending}
                      className={cn(
                        'shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-transform active:scale-95 disabled:opacity-50',
                        plan.featured
                          ? 'bg-background text-foreground hover:bg-background/90'
                          : 'bg-foreground text-background hover:bg-foreground/90'
                      )}
                    >
                      {plan.buttonText}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <PaymentProviderModal
          open={!!paymentPlan}
          onOpenChange={(open) => !open && setPaymentPlan(null)}
          providers={paymentProviders}
          loadingProvider={
            checkoutMutation.isPending
              ? (checkoutMutation.variables?.provider ?? null)
              : null
          }
          onSelect={handlePaymentProviderSelect}
          planName={paymentPlan?.name}
          price={paymentPlan?.price}
        />
      </>
    );
  }

  return (
    <>
      <section
        id={embedded ? undefined : 'pricing'}
        className={cn(
          !embedded && 'border-border border-t px-4 py-24 sm:py-32',
          embedded && 'px-4 py-8 sm:px-8 sm:py-10'
        )}
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
              {title ?? m['landing.pricing.title']()}
            </h2>
            <p className="text-muted-foreground mt-5 text-left">
              {description ?? m['landing.pricing.description']()}
            </p>
          </div>

          {/* Three-tab pill — packs (default) | monthly | yearly */}
          <BillingModeToggle value={mode} onChange={setMode} />

          <PricingTable groups={groups} onCheckout={handleCheckout} />
        </div>
      </section>
      <PaymentProviderModal
        open={!!paymentPlan}
        onOpenChange={(open) => !open && setPaymentPlan(null)}
        providers={paymentProviders}
        loadingProvider={
          checkoutMutation.isPending
            ? (checkoutMutation.variables?.provider ?? null)
            : null
        }
        onSelect={handlePaymentProviderSelect}
        planName={paymentPlan?.name}
        price={paymentPlan?.price}
      />
    </>
  );
}

// Three-tab pill: packs (left, default) | monthly (middle) | yearly (right).
// Yearly keeps the emerald "Save 17%" badge to surface the discount.
function BillingModeToggle({
  value,
  onChange,
  compact = false,
}: {
  value: BillingMode;
  onChange: (v: BillingMode) => void;
  compact?: boolean;
}) {
  const options: { key: BillingMode; label: () => string }[] = [
    { key: 'packs', label: () => m['landing.pricing.group.onetime']() },
    { key: 'monthly', label: () => m['landing.pricing.monthly']() },
    { key: 'yearly', label: () => m['landing.pricing.yearly']() },
  ];

  return (
    <div className={cn('flex justify-center', compact ? 'mb-8' : 'mb-10')}>
      <div
        className={cn(
          'border-border bg-muted/40 inline-flex items-center rounded-full border p-1',
          compact ? 'text-xs' : 'text-sm'
        )}
      >
        {options.map((opt) => {
          const active = value === opt.key;
          const isYearly = opt.key === 'yearly';
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={cn(
                'rounded-full font-medium transition-colors',
                compact ? 'px-4 py-1' : 'px-5 py-1.5',
                isYearly && 'inline-flex items-center gap-2',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label()}
              {isYearly && (
                <span
                  className={cn(
                    'rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                    compact
                      ? 'px-1.5 py-0.5 text-[10px]'
                      : 'px-2 py-0.5 text-xs'
                  )}
                >
                  {m['landing.pricing.period.save_badge']()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
