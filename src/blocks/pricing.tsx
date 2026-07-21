'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Rocket, Sparkles, Zap } from 'lucide-react';
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
  'creem',
  'stripe',
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

  const starterFeatures = [
    { icon: Zap, label: m['landing.pricing.pack.requests']({ count: 180 }) },
    { icon: Sparkles, label: m['landing.pricing.pack.kimi_access']() },
    { icon: Check, label: m['landing.pricing.pack.context']() },
    { icon: Check, label: m['landing.pricing.pack.email_support']() },
  ];
  const proFeatures = [
    { icon: Zap, label: m['landing.pricing.pack.requests']({ count: 950 }) },
    {
      icon: Check,
      label: m['landing.pricing.pack.everything_in']({
        name: m['landing.pricing.pack.starter'](),
      }),
    },
    { icon: Rocket, label: m['landing.pricing.pack.priority_queue']() },
    { icon: Check, label: m['landing.pricing.pack.priority_support']() },
  ];
  const scaleFeatures = [
    { icon: Zap, label: m['landing.pricing.pack.requests']({ count: 1900 }) },
    { icon: Check, label: m['landing.pricing.pack.best_price']() },
    {
      icon: Check,
      label: m['landing.pricing.pack.everything_in']({
        name: m['landing.pricing.pack.pro'](),
      }),
    },
    { icon: Check, label: m['landing.pricing.pack.dedicated_support']() },
  ];

  const groups: PricingGroup[] = [
    {
      key: 'packs',
      label: m['landing.pricing.title'](),
      plans: [
        {
          id: 'credits_180',
          name: m['landing.pricing.pack.starter'](),
          description: m['landing.pricing.pack.starter_desc'](),
          price: '$10',
          features: starterFeatures,
          productId: 'credits_180',
          priceInCents: 1000,
          currency: 'usd',
          credits: 180,
          buttonText: m['landing.pricing.pack.buy'](),
        },
        {
          id: 'credits_950',
          name: m['landing.pricing.pack.pro'](),
          description: m['landing.pricing.pack.pro_desc'](),
          price: '$50',
          featured: true,
          badge: m['landing.pricing.popular'](),
          features: proFeatures,
          productId: 'credits_950',
          priceInCents: 5000,
          currency: 'usd',
          credits: 950,
          buttonText: m['landing.pricing.pack.buy'](),
        },
        {
          id: 'credits_1900',
          name: m['landing.pricing.pack.scale'](),
          description: m['landing.pricing.pack.scale_desc'](),
          price: '$100',
          badge: m['landing.pricing.best_value'](),
          features: scaleFeatures,
          productId: 'credits_1900',
          priceInCents: 10000,
          currency: 'usd',
          credits: 1900,
          buttonText: m['landing.pricing.pack.buy'](),
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
    // Packs always have a price — no free tier here.
    if (!plan.priceInCents) return;

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
      'creem') as PaymentProvider;

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
        providers={enabledProviders.length ? enabledProviders : ['creem']}
        loadingProvider={loadingProvider}
        onSelect={handleProviderSelect}
        planName={pendingPlan?.name}
        price={pendingPlan?.price}
      />
    </section>
  );
}
