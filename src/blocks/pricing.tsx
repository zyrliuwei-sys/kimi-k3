'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import {
  PricingTable,
  type PricingGroup,
  type PricingPlan,
} from '@/components/pricing-table';

type BillingPeriod = 'monthly' | 'yearly';

const PAYPAL_PROVIDER = 'paypal';

const FEATURE_CHECK = { icon: Check, label: '' };

function feat(iconComponent: any, label: string) {
  return { icon: iconComponent, label };
}

function buildLiteFeatures(
  icon: any,
  isYearly: boolean,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(
      icon,
      isYearly
        ? m['landing.pricing.feature_credits_year']({ credits })
        : m['landing.pricing.feature_credits_month']({ credits })
    ),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_context']()),
    feat(icon, m['landing.pricing.feature_email_support']()),
  ];
}

function buildPlusFeatures(
  icon: any,
  isYearly: boolean,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(
      icon,
      isYearly
        ? m['landing.pricing.feature_credits_year']({ credits })
        : m['landing.pricing.feature_credits_month']({ credits })
    ),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_priority_support']()),
  ];
}

function buildProFeatures(
  icon: any,
  isYearly: boolean,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(
      icon,
      isYearly
        ? m['landing.pricing.feature_credits_year']({ credits })
        : m['landing.pricing.feature_credits_month']({ credits })
    ),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_dedicated_support']()),
  ];
}

export function Pricing({ title }: { title?: string } = {}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [period, setPeriod] = useState<BillingPeriod>('yearly');

  // Per product: monthly price, monthly credits, monthly productId
  const liteMonthly = {
    id: 'lite_monthly',
    price: 19,
    credits: 224,
    productId: 'lite_monthly',
  };
  const plusMonthly = {
    id: 'plus_monthly',
    price: 39,
    credits: 460,
    productId: 'plus_monthly',
  };
  const proMonthly = {
    id: 'pro_monthly',
    price: 79,
    credits: 930,
    productId: 'pro_monthly',
  };

  // Per product: yearly total, yearly credits, monthly-equivalent display, yearly productId
  const liteYearly = {
    id: 'lite_yearly',
    price: 190,
    monthlyEquiv: 15.83,
    credits: 2688,
    productId: 'lite_yearly',
  };
  const plusYearly = {
    id: 'plus_yearly',
    price: 390,
    monthlyEquiv: 32.5,
    credits: 5520,
    productId: 'plus_yearly',
  };
  const proYearly = {
    id: 'pro_yearly',
    price: 790,
    monthlyEquiv: 65.83,
    credits: 11160,
    productId: 'pro_yearly',
  };

  // Build the subscription group based on the toggle state.
  const subscribePlans: PricingPlan[] = useMemo(() => {
    if (period === 'monthly') {
      return [
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
          features: buildLiteFeatures(Zap, false, liteMonthly.credits),
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
          features: buildPlusFeatures(Zap, false, plusMonthly.credits),
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
          features: buildProFeatures(Zap, false, proMonthly.credits),
        },
      ];
    }
    // yearly — UI shows monthly equivalent, CTA shows total yearly price
    return [
      {
        id: liteYearly.id,
        name: m['landing.pricing.tier.lite'](),
        description: m['landing.pricing.tier.lite_desc'](),
        // Big number: monthly equivalent price
        price: `$${liteYearly.monthlyEquiv.toFixed(2)}`,
        originalPrice: `$${liteMonthly.price}`,
        interval: 'mo',
        // Yearly subline + CTA copy
        yearlyTotal: `$${liteYearly.price}`,
        yearlySubline: m['landing.pricing.per_year_suffix'](),
        yearlyCta: m['landing.pricing.subscribe_yearly'](),
        priceInCents: liteYearly.price * 100,
        currency: 'usd',
        credits: liteYearly.credits,
        productId: liteYearly.productId,
        productName: 'Lite',
        buttonText: `${m['landing.pricing.subscribe_yearly']()} · $${liteYearly.price}`,
        features: buildLiteFeatures(Zap, true, liteYearly.credits),
      },
      {
        id: plusYearly.id,
        name: m['landing.pricing.tier.plus'](),
        description: m['landing.pricing.tier.plus_desc'](),
        price: `$${plusYearly.monthlyEquiv.toFixed(2)}`,
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
        features: buildPlusFeatures(Zap, true, plusYearly.credits),
      },
      {
        id: proYearly.id,
        name: m['landing.pricing.tier.pro'](),
        description: m['landing.pricing.tier.pro_desc'](),
        price: `$${proYearly.monthlyEquiv.toFixed(2)}`,
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
        features: buildProFeatures(Zap, true, proYearly.credits),
      },
    ];
  }, [period]);

  // One-time packs group (no toggle).
  const onetimePlans: PricingPlan[] = useMemo(
    () => [
      {
        id: 'starter_once',
        name: m['landing.pricing.pack.starter'](),
        description: m['landing.pricing.pack.starter_desc'](),
        price: '$10',
        priceInCents: 1000,
        currency: 'usd',
        credits: 118,
        productId: 'starter_once',
        productName: 'Starter Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: [
          feat(
            Zap,
            m['landing.pricing.feature_credits_month']({ credits: 118 })
          ),
          feat(Check, m['landing.pricing.feature_kimi_access']()),
        ],
      },
      {
        id: 'standard_once',
        name: m['landing.pricing.pack.pro'](),
        description: m['landing.pricing.pack.pro_desc'](),
        price: '$15',
        featured: true,
        badge: m['landing.pricing.popular'](),
        priceInCents: 1500,
        currency: 'usd',
        credits: 176,
        productId: 'standard_once',
        productName: 'Standard Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: [
          feat(
            Zap,
            m['landing.pricing.feature_credits_month']({ credits: 176 })
          ),
          feat(Check, m['landing.pricing.feature_kimi_access']()),
        ],
      },
      {
        id: 'boost_once',
        name: m['landing.pricing.pack.scale'](),
        description: m['landing.pricing.pack.scale_desc'](),
        price: '$20',
        badge: m['landing.pricing.best_value'](),
        priceInCents: 2000,
        currency: 'usd',
        credits: 235,
        productId: 'boost_once',
        productName: 'Boost Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: [
          feat(
            Zap,
            m['landing.pricing.feature_credits_month']({ credits: 235 })
          ),
          feat(Sparkles, m['landing.pricing.feature_priority_queue']()),
        ],
      },
    ],
    []
  );

  const groups: PricingGroup[] = [
    {
      key: 'subscribe',
      label: m['landing.pricing.group.subscribe'](),
      plans: subscribePlans,
    },
    {
      key: 'onetime',
      label: m['landing.pricing.group.onetime'](),
      plans: onetimePlans,
    },
  ];

  const checkoutMutation = useMutation({
    mutationFn: (plan: PricingPlan) =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: plan.productId,
        product_name: plan.productName || plan.name,
        plan_name: plan.productName || plan.name,
        price: plan.priceInCents,
        currency: plan.currency || 'usd',
        // Server reads the catalog and decides type itself.
        description: plan.name,
        credits: plan.credits,
        payment_provider: PAYPAL_PROVIDER,
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

  function handleCheckout(plan: PricingPlan) {
    if (!plan.priceInCents) return;

    if (!session?.user) {
      const redirect = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '/pricing'
      );
      router.push(`/sign-in?redirect=${redirect}`);
      return;
    }
    checkoutMutation.mutate(plan);
  }

  return (
    <section
      id="pricing"
      className="border-border border-t px-4 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {title ?? m['landing.pricing.title']()}
          </h2>
          <p className="text-muted-foreground mt-5">
            {m['landing.pricing.description']()}
          </p>
        </div>

        {/* Subscription billing-period toggle — only renders for the subscribe group */}
        <BillingPeriodToggle value={period} onChange={setPeriod} />

        <PricingTable groups={groups} onCheckout={handleCheckout} />
      </div>
    </section>
  );
}

function BillingPeriodToggle({
  value,
  onChange,
}: {
  value: BillingPeriod;
  onChange: (v: BillingPeriod) => void;
}) {
  return (
    <div className="mb-10 flex justify-center">
      <div className="border-border bg-muted/40 inline-flex items-center rounded-full border p-1 text-sm">
        <button
          type="button"
          onClick={() => onChange('monthly')}
          className={
            'rounded-full px-5 py-1.5 font-medium transition-colors ' +
            (value === 'monthly'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground')
          }
        >
          {m['landing.pricing.monthly']()}
        </button>
        <button
          type="button"
          onClick={() => onChange('yearly')}
          className={
            'inline-flex items-center gap-2 rounded-full px-5 py-1.5 font-medium transition-colors ' +
            (value === 'yearly'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground')
          }
        >
          {m['landing.pricing.yearly']()}
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs ' +
              (value === 'yearly'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')
            }
          >
            {m['landing.pricing.period.save_badge']()}
          </span>
        </button>
      </div>
    </div>
  );
}
