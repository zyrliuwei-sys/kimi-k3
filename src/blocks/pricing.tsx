'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  PricingTable,
  type PricingGroup,
  type PricingPlan,
} from '@/components/pricing-table';

type BillingMode = 'packs' | 'monthly' | 'yearly';

const PAYPAL_PROVIDER = 'paypal';

const FEATURE_CHECK = { icon: Check, label: '' };

function feat(iconComponent: any, label: string) {
  return { icon: iconComponent, label };
}

// Feature builders — one per (tier × mode) so the monthly and yearly lists can
// diverge. Each list is intentionally 3× the original (~12/9/9) so the cards
// tell a richer story drawn from the landing-page copy (hero, stats, features,
// vfeatures, api-playground). Higher tiers include a "Includes every X
// feature" line so we don't repeat Lite/Plus bullets wholesale.

// ── Lite ────────────────────────────────────────────────────────────────

function buildLiteMonthlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_context']()),
    feat(icon, m['landing.pricing.feature_email_support']()),
    feat(icon, m['landing.pricing.feature_streaming']()),
    feat(icon, m['landing.pricing.feature_json_mode']()),
    feat(icon, m['landing.pricing.feature_python_sdk']()),
    feat(icon, m['landing.pricing.feature_node_sdk']()),
    feat(icon, m['landing.pricing.feature_api_playground']()),
    feat(icon, m['landing.pricing.feature_prompt_cheatsheet']()),
    feat(icon, m['landing.pricing.feature_multilang']()),
    feat(icon, m['landing.pricing.feature_uptime_basic']()),
  ];
}

function buildLiteYearlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_year']({ credits })),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_context']()),
    feat(icon, m['landing.pricing.feature_email_support']()),
    feat(icon, m['landing.pricing.feature_streaming']()),
    feat(icon, m['landing.pricing.feature_json_mode']()),
    feat(icon, m['landing.pricing.feature_python_sdk']()),
    feat(icon, m['landing.pricing.feature_node_sdk']()),
    feat(icon, m['landing.pricing.feature_api_playground']()),
    feat(icon, m['landing.pricing.feature_locked_price']()),
    feat(icon, m['landing.pricing.feature_annual_billing']()),
    feat(icon, m['landing.pricing.feature_annual_report']()),
  ];
}

// ── Plus ────────────────────────────────────────────────────────────────

function buildPlusMonthlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_priority_chat']()),
    feat(icon, m['landing.pricing.feature_includes_lite']()),
    feat(icon, m['landing.pricing.feature_function_calling']()),
    feat(icon, m['landing.pricing.feature_webhooks']()),
    feat(icon, m['landing.pricing.feature_vector_search']()),
    feat(icon, m['landing.pricing.feature_workspaces']()),
    feat(icon, m['landing.pricing.feature_uptime_high']()),
  ];
}

function buildPlusYearlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_year']({ credits })),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_priority_chat']()),
    feat(icon, m['landing.pricing.feature_includes_lite']()),
    feat(icon, m['landing.pricing.feature_function_calling']()),
    feat(icon, m['landing.pricing.feature_webhooks']()),
    feat(icon, m['landing.pricing.feature_vector_search']()),
    feat(icon, m['landing.pricing.feature_save_vs_monthly_plus']()),
    feat(icon, m['landing.pricing.feature_annual_planning']()),
  ];
}

// ── Pro ─────────────────────────────────────────────────────────────────

function buildProMonthlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_dedicated_support']()),
    feat(icon, m['landing.pricing.feature_includes_plus']()),
    feat(icon, m['landing.pricing.feature_sso']()),
    feat(icon, m['landing.pricing.feature_team_seats']()),
    feat(icon, m['landing.pricing.feature_custom_sla']()),
    feat(icon, m['landing.pricing.feature_rate_limit_top']()),
    feat(icon, m['landing.pricing.feature_qbr']()),
  ];
}

function buildProYearlyFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_year']({ credits })),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_dedicated_support']()),
    feat(icon, m['landing.pricing.feature_includes_plus']()),
    feat(icon, m['landing.pricing.feature_sso']()),
    feat(icon, m['landing.pricing.feature_team_seats']()),
    feat(icon, m['landing.pricing.feature_custom_sla']()),
    feat(icon, m['landing.pricing.feature_locked_price']()),
    feat(icon, m['landing.pricing.feature_annual_review']()),
  ];
}

// ── One-time packs ──────────────────────────────────────────────────────

function buildStarterPackFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_streaming']()),
    feat(icon, m['landing.pricing.feature_no_expiry']()),
    feat(icon, m['landing.pricing.feature_instant_delivery']()),
    feat(icon, m['landing.pricing.feature_no_card']()),
  ];
}

function buildStandardPackFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_streaming']()),
    feat(icon, m['landing.pricing.feature_no_expiry']()),
    feat(icon, m['landing.pricing.feature_priority_queue']()),
    feat(icon, m['landing.pricing.feature_multi_project']()),
  ];
}

function buildBoostPackFeatures(
  icon: any,
  credits: number
): { icon: any; label: string }[] {
  return [
    feat(icon, m['landing.pricing.feature_credits_month']({ credits })),
    feat(icon, m['landing.pricing.feature_kimi_access']()),
    feat(icon, m['landing.pricing.feature_streaming']()),
    feat(icon, m['landing.pricing.feature_no_expiry']()),
    feat(icon, m['landing.pricing.feature_best_per_request']()),
    feat(icon, m['landing.pricing.feature_unlocks_all']()),
  ];
}

export function Pricing({ title }: { title?: string } = {}) {
  const router = useRouter();
  const { data: session } = useSession();
  // Three tabs: left = one-time packs, middle = monthly, right = yearly.
  // Default to monthly so the subscription tiers (the bread and butter) greet
  // the visitor before they have to click anything.
  const [mode, setMode] = useState<BillingMode>('monthly');

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
    price: 99,
    credits: 1180,
    productId: 'pro_monthly',
  };

  // Per product: yearly total (= 12 × monthlyEquiv), yearly credits (= 12 × monthly credits), monthly-equivalent display, yearly productId
  // `price` and `monthlyEquiv` always reconcile (12 × monthly = yearly), so the
  // card subline "billed annually · $X/yr" matches the big number.
  // Pro yearly credits bumped from 11160 → 14160 to match the new Pro monthly
  // (1180 credits × 12); the previous 11160 dated back to when monthly was 930.
  const liteYearly = {
    id: 'lite_yearly',
    price: 180,
    monthlyEquiv: 15,
    credits: 2688,
    productId: 'lite_yearly',
  };
  const plusYearly = {
    id: 'plus_yearly',
    price: 420,
    monthlyEquiv: 35,
    credits: 5520,
    productId: 'plus_yearly',
  };
  const proYearly = {
    id: 'pro_yearly',
    price: 948,
    monthlyEquiv: 79,
    credits: 14160,
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
        features: buildLiteMonthlyFeatures(Zap, liteMonthly.credits),
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
        features: buildPlusMonthlyFeatures(Zap, plusMonthly.credits),
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
        features: buildProMonthlyFeatures(Zap, proMonthly.credits),
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
        features: buildLiteYearlyFeatures(Zap, liteYearly.credits),
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
        features: buildPlusYearlyFeatures(Zap, plusYearly.credits),
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
        features: buildProYearlyFeatures(Zap, proYearly.credits),
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
        credits: 105,
        productId: 'starter_once',
        productName: 'Starter Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildStarterPackFeatures(Zap, 105),
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
        credits: 340,
        productId: 'standard_once',
        productName: 'Standard Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildStandardPackFeatures(Zap, 340),
      },
      {
        id: 'boost_once',
        name: m['landing.pricing.pack.scale'](),
        description: m['landing.pricing.pack.scale_desc'](),
        price: '$79',
        badge: m['landing.pricing.best_value'](),
        priceInCents: 7900,
        currency: 'usd',
        credits: 930,
        productId: 'boost_once',
        productName: 'Boost Pack',
        buttonText: m['landing.pricing.buy_pack'](),
        features: buildBoostPackFeatures(Zap, 930),
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
          <p className="text-muted-foreground mt-5 text-left">
            {m['landing.pricing.description']()}
          </p>
        </div>

        {/* Three-tab pill — packs | monthly (default) | yearly */}
        <BillingModeToggle value={mode} onChange={setMode} />

        <PricingTable groups={groups} onCheckout={handleCheckout} />
      </div>
    </section>
  );
}

// Three-tab pill: packs (left) | monthly (middle, default) | yearly (right).
// Yearly keeps the emerald "Save 17%" badge to surface the discount.
function BillingModeToggle({
  value,
  onChange,
}: {
  value: BillingMode;
  onChange: (v: BillingMode) => void;
}) {
  const options: { key: BillingMode; label: () => string }[] = [
    { key: 'packs', label: () => m['landing.pricing.group.onetime']() },
    { key: 'monthly', label: () => m['landing.pricing.monthly']() },
    { key: 'yearly', label: () => m['landing.pricing.yearly']() },
  ];

  return (
    <div className="mb-10 flex justify-center">
      <div className="border-border bg-muted/40 inline-flex items-center rounded-full border p-1 text-sm">
        {options.map((opt) => {
          const active = value === opt.key;
          const isYearly = opt.key === 'yearly';
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={cn(
                'rounded-full px-5 py-1.5 font-medium transition-colors',
                isYearly && 'inline-flex items-center gap-2',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label()}
              {isYearly && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
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
