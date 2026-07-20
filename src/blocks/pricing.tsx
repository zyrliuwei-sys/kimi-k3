'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Check,
  Folders,
  Headphones,
  Infinity as InfinityIcon,
  Mail,
  Puzzle,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
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

const ALL_PROVIDERS: PaymentProvider[] = [
  'stripe',
  'creem',
  'paypal',
  'alipay',
  'wechat',
];

export function Pricing({ title }: { title?: string } = {}) {
  const router = useRouter();
  const { data: session } = useSession();

  const { data: configsData } = usePublicConfig();
  const configs = configsData ?? {};
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);

  const enabledProviders = useMemo<PaymentProvider[]>(
    () => ALL_PROVIDERS.filter((p) => configs[`${p}_enabled`] === 'true'),
    [configs]
  );

  const freeFeatures = [
    { icon: Sparkles, label: m['landing.pricing.feature_free_1']() },
    { icon: Check, label: m['landing.pricing.feature_free_2']() },
    { icon: Mail, label: m['landing.pricing.feature_free_3']() },
  ];
  const proFeatures = [
    { icon: Folders, label: m['landing.pricing.feature_pro_1']() },
    { icon: Check, label: m['landing.pricing.feature_pro_2']() },
    { icon: Zap, label: m['landing.pricing.feature_pro_3']() },
    { icon: Terminal, label: m['landing.pricing.feature_pro_4']() },
  ];
  const enterpriseFeatures = [
    { icon: Check, label: m['landing.pricing.feature_ent_1']() },
    { icon: InfinityIcon, label: m['landing.pricing.feature_ent_2']() },
    { icon: Headphones, label: m['landing.pricing.feature_ent_3']() },
    { icon: Puzzle, label: m['landing.pricing.feature_ent_4']() },
  ];

  const freePlan = (over: Partial<PricingPlan> = {}): PricingPlan => ({
    id: 'free',
    name: m['landing.pricing.starter'](),
    description: m['landing.pricing.starter_desc'](),
    price: '$0',
    features: freeFeatures,
    productId: 'free',
    priceInCents: 0,
    currency: 'usd',
    credits: 0,
    buttonText: m['landing.pricing.free_cta'](),
    ...over,
  });

  const groups: PricingGroup[] = [
    {
      key: 'monthly',
      label: m['landing.pricing.monthly'](),
      plans: [
        freePlan({ id: 'free-monthly' }),
        {
          id: 'pro-monthly',
          name: m['landing.pricing.pro'](),
          description: m['landing.pricing.pro_desc'](),
          price: '$9.9',
          interval: 'mo',
          featured: true,
          badge: m['landing.pricing.popular'](),
          features: proFeatures,
          productId: 'pro_monthly',
          priceInCents: 990,
          currency: 'usd',
          credits: 3000,
          plan: { name: 'Pro', interval: 'month', intervalCount: 1 },
        },
        {
          id: 'enterprise-monthly',
          name: m['landing.pricing.enterprise'](),
          description: m['landing.pricing.enterprise_desc'](),
          price: '$49',
          interval: 'mo',
          features: enterpriseFeatures,
          productId: 'enterprise_monthly',
          priceInCents: 4900,
          currency: 'usd',
          credits: 30000,
          plan: { name: 'Enterprise', interval: 'month', intervalCount: 1 },
        },
      ],
    },
    {
      key: 'yearly',
      label: m['landing.pricing.yearly'](),
      plans: [
        freePlan({ id: 'free-yearly' }),
        {
          id: 'pro-yearly',
          name: m['landing.pricing.pro'](),
          description: m['landing.pricing.pro_desc'](),
          price: '$99',
          originalPrice: '$118',
          interval: 'yr',
          featured: true,
          badge: m['landing.pricing.best_value'](),
          features: proFeatures,
          productId: 'pro_yearly',
          priceInCents: 9900,
          currency: 'usd',
          credits: 36000,
          plan: { name: 'Pro', interval: 'year', intervalCount: 1 },
        },
        {
          id: 'enterprise-yearly',
          name: m['landing.pricing.enterprise'](),
          description: m['landing.pricing.enterprise_desc'](),
          price: '$490',
          originalPrice: '$588',
          interval: 'yr',
          features: enterpriseFeatures,
          productId: 'enterprise_yearly',
          priceInCents: 49000,
          currency: 'usd',
          credits: 360000,
          plan: { name: 'Enterprise', interval: 'year', intervalCount: 1 },
        },
      ],
    },
  ];

  const checkoutMutation = useMutation({
    mutationFn: ({
      plan,
      provider,
    }: {
      plan: PricingPlan;
      provider: PaymentProvider;
    }) =>
      apiPost<{ checkout_url?: string }>('/api/payment/checkout', {
        product_id: plan.productId,
        product_name: plan.productName || plan.name,
        plan_name: plan.plan?.name || plan.name,
        price: plan.priceInCents,
        currency: plan.currency || 'usd',
        type: plan.plan ? 'subscription' : 'one-time',
        description: plan.name,
        plan: plan.plan,
        credits: plan.credits,
        credits_valid_days: plan.creditsValidDays,
        payment_provider: provider,
      }),
    onSuccess: (data) => {
      if (!data?.checkout_url) {
        toast.error('Checkout failed');
        setLoadingProvider(null);
        return;
      }
      window.location.href = data.checkout_url;
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Checkout failed');
      setLoadingProvider(null);
    },
  });

  function startCheckout(plan: PricingPlan, provider: PaymentProvider) {
    setLoadingProvider(provider);
    checkoutMutation.mutate({ plan, provider });
  }

  async function handleCheckout(plan: PricingPlan) {
    // Free plan — no payment, just create an account.
    if (!plan.priceInCents) {
      router.push('/sign-up');
      return;
    }

    if (!session?.user) {
      const redirect = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '/pricing'
      );
      router.push(`/sign-in?redirect=${redirect}`);
      return;
    }

    const selectEnabled = configs.select_payment_enabled === 'true';
    const defaultProvider = (configs.default_payment_provider ||
      enabledProviders[0] ||
      'stripe') as PaymentProvider;

    if (selectEnabled && enabledProviders.length > 1) {
      setPendingPlan(plan);
      setModalOpen(true);
      return;
    }

    await startCheckout(plan, defaultProvider);
  }

  function handleProviderSelect(provider: PaymentProvider) {
    if (!pendingPlan) return;
    startCheckout(pendingPlan, provider);
  }

  return (
    <section
      id="pricing"
      className="border-border border-t px-4 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-20 text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {title ?? m['landing.pricing.title']()}
          </h2>
          <p className="text-muted-foreground mt-5">
            {m['landing.pricing.description']()}
          </p>
        </div>
        <PricingTable groups={groups} onCheckout={handleCheckout} />
      </div>

      <PaymentProviderModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setPendingPlan(null);
            setLoadingProvider(null);
          }
        }}
        providers={enabledProviders.length ? enabledProviders : ['stripe']}
        loadingProvider={loadingProvider}
        onSelect={handleProviderSelect}
        planName={pendingPlan?.name}
        price={pendingPlan?.price}
      />
    </section>
  );
}
