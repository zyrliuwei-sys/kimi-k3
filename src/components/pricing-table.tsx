'use client';

import {
  useState,
  type ComponentType,
  type CSSProperties,
  type SVGProps,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check as IconCheck } from 'lucide-react';

import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type PricingFeature =
  | string
  | { icon?: IconComponent; label: string; tooltip?: string };

export interface PricingPlan {
  id: string;
  name: string;
  description?: string;
  price: string;
  originalPrice?: string;
  currency?: string;
  interval?: string;
  // Yearly-subscription specific copy. When `yearlyTotal` is set, render an
  // extra line under the price like "billed annually · $190/yr".
  yearlyTotal?: string;
  yearlySubline?: string;
  yearlyCta?: string;
  featured?: boolean;
  badge?: string;
  features: PricingFeature[];
  buttonText?: string;
  productId?: string;
  productName?: string;
  paymentProvider?: string;
  priceInCents?: number;
  credits?: number;
  creditsValidDays?: number;
  plan?: {
    name: string;
    interval: string;
    intervalCount: number;
  };
}

export interface PricingGroup {
  key: string;
  label: string;
  plans: PricingPlan[];
}

export function PricingTable({
  groups,
  onCheckout,
}: {
  groups: PricingGroup[];
  onCheckout?: (plan: PricingPlan) => void;
}) {
  const [activeGroup, setActiveGroup] = useState(groups[0]?.key || '');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const currentGroup = groups.find((g) => g.key === activeGroup) || groups[0];

  const checkoutMutation = useMutation({
    mutationFn: (plan: PricingPlan) =>
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
        payment_provider: plan.paymentProvider || 'stripe',
      }),
    onSuccess: (data) => {
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      }
    },
    onSettled: () => {
      setLoadingId(null);
    },
  });

  function handleCheckout(plan: PricingPlan) {
    if (onCheckout) {
      onCheckout(plan);
      return;
    }

    if (!plan.productId || !plan.priceInCents) return;

    setLoadingId(plan.id);
    checkoutMutation.mutate(plan);
  }

  return (
    <div className="space-y-10">
      {/* Group tabs — pill toggle (only when more than one group) */}
      {groups.length > 1 && (
        <div className="flex justify-center">
          <div className="border-border bg-muted/40 inline-flex items-center rounded-full border p-1">
            {groups.map((group) => (
              <button
                key={group.key}
                onClick={() => setActiveGroup(group.key)}
                className={cn(
                  'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
                  activeGroup === group.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plans grid */}
      <div className="mx-auto grid w-full grid-cols-1 gap-4 md:grid-cols-3 md:gap-8">
        {currentGroup?.plans.map((plan) => (
          <PricingCard
            key={plan.id}
            plan={plan}
            loading={loadingId === plan.id}
            onCheckout={() => handleCheckout(plan)}
          />
        ))}
      </div>
    </div>
  );
}

function PricingCard({
  plan,
  loading,
  onCheckout,
}: {
  plan: PricingPlan;
  loading: boolean;
  onCheckout: () => void;
}) {
  const isFeatured = !!plan.featured;

  return (
    <div
      className={cn(
        'flex w-full flex-col rounded-3xl p-2',
        isFeatured
          ? 'bg-neutral-900 dark:bg-neutral-100'
          : 'bg-neutral-50 dark:bg-neutral-800'
      )}
    >
      {/* Name + description panel */}
      <div
        className={cn(
          'rounded-[18px] px-8 py-12 md:px-8 md:py-12',
          isFeatured
            ? 'bg-neutral-800 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.15),0_4px_6px_-2px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-white dark:shadow-[0_8px_16px_-4px_rgba(0,0,0,0.08),0_4px_6px_-2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.06)]'
            : 'bg-white shadow-[0_8px_8px_-3px_rgba(0,0,0,0.04),0_3px_3px_-1.5px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-neutral-900 dark:shadow-[0_8px_8px_-3px_rgba(255,255,255,0.02),0_0_0_1px_rgba(255,255,255,0.05)]'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              'text-base font-bold md:text-2xl',
              isFeatured
                ? 'text-white dark:text-neutral-900'
                : 'text-neutral-700 dark:text-neutral-200'
            )}
          >
            {plan.name}
          </p>
          {plan.badge && (
            <span
              className={cn(
                'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                isFeatured
                  ? 'bg-neutral-700 text-neutral-200 dark:bg-neutral-300 dark:text-neutral-800'
                  : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
              )}
            >
              {plan.badge}
            </span>
          )}
        </div>
        {plan.description && (
          <p
            className={cn(
              'mt-2 text-sm text-balance lg:text-base',
              isFeatured
                ? 'text-neutral-400 dark:text-neutral-600'
                : 'text-neutral-500 dark:text-neutral-400'
            )}
          >
            {plan.description}
          </p>
        )}
      </div>

      {/* Price + CTA + features */}
      <div className="mt-2 p-8 md:mt-8">
        {/* Original price strikethrough (yearly mode) */}
        {plan.originalPrice && (
          <span
            className={cn(
              'mb-1 block text-sm line-through',
              isFeatured
                ? 'text-neutral-500 dark:text-neutral-500'
                : 'text-neutral-400 dark:text-neutral-500'
            )}
          >
            {plan.originalPrice}
          </span>
        )}

        <div className="flex items-baseline-last gap-2">
          <span
            className={cn(
              'text-2xl font-medium tracking-tight md:text-3xl lg:text-6xl',
              isFeatured
                ? 'text-white dark:text-neutral-900'
                : 'text-neutral-800 dark:text-neutral-100'
            )}
          >
            {plan.price}
          </span>
          {plan.interval && (
            <>
              <span
                className={cn(
                  'text-sm',
                  isFeatured
                    ? 'text-neutral-500 dark:text-neutral-500'
                    : 'text-neutral-500 dark:text-neutral-400'
                )}
              >
                /
              </span>
              <span
                className={cn(
                  'text-sm',
                  isFeatured
                    ? 'text-neutral-500 dark:text-neutral-500'
                    : 'text-neutral-500 dark:text-neutral-400'
                )}
              >
                {plan.interval}
              </span>
            </>
          )}
        </div>

        {/* Yearly subline (yearly mode only) */}
        {plan.yearlySubline && plan.yearlyTotal && (
          <p
            className={cn(
              'mt-2 text-sm',
              isFeatured
                ? 'text-neutral-400 dark:text-neutral-600'
                : 'text-neutral-500 dark:text-neutral-400'
            )}
          >
            {plan.yearlySubline} ·{' '}
            <span className="text-foreground/80 font-medium">
              {plan.yearlyTotal}
            </span>
            /yr
          </p>
        )}

        <Button
          variant="default"
          className={cn(
            'mt-4 w-full cursor-pointer rounded-full px-4 py-6 text-base font-medium transition-all duration-200 active:scale-[0.98] md:mt-6',
            isFeatured
              ? 'bg-linear-to-t from-indigo-600 to-indigo-500 text-white shadow-[0px_0.5px_1px_0px_var(--color-indigo-300)_inset] hover:opacity-95'
              : 'bg-white text-neutral-600 shadow-[0_8px_8px_-3px_rgba(0,0,0,0.04),0_3px_3px_-1.5px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-neutral-950 dark:text-neutral-300 dark:shadow-[0_8px_8px_-3px_rgba(255,255,255,0.02),0_0_0_1px_rgba(255,255,255,0.05)]'
          )}
          onClick={onCheckout}
          disabled={loading}
        >
          {loading
            ? m['common.pricing.processing']()
            : plan.buttonText || m['common.pricing.get_started']()}
        </Button>

        <GridLineHorizontal className="my-8" featured={isFeatured} />

        <p
          className={cn(
            'font-mono text-sm tracking-tight uppercase',
            isFeatured
              ? 'text-neutral-500 dark:text-neutral-500'
              : 'text-neutral-400 dark:text-neutral-500'
          )}
        >
          {plan.name} plan includes
        </p>

        <div className="my-4 flex flex-col gap-6">
          {plan.features.map((feature, index) => {
            const isObj = typeof feature !== 'string';
            const label = isObj ? feature.label : feature;
            return (
              <Step key={index} featured={isFeatured}>
                {label}
              </Step>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const Step = ({
  children,
  featured,
}: {
  children: React.ReactNode;
  featured?: boolean;
}) => {
  return (
    <div className="flex items-start justify-start gap-2">
      <div
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          featured
            ? 'bg-neutral-700 dark:bg-neutral-300'
            : 'bg-neutral-200 dark:bg-neutral-700'
        )}
      >
        <IconCheck
          className={cn(
            'size-2 stroke-[4px]',
            featured
              ? 'text-white dark:text-neutral-900'
              : 'text-neutral-700 dark:text-neutral-300'
          )}
        />
      </div>
      <p
        className={cn(
          'text-sm font-medium',
          featured
            ? 'text-neutral-300 dark:text-neutral-700'
            : 'text-neutral-600 dark:text-neutral-400'
        )}
      >
        {children}
      </p>
    </div>
  );
};

export const GridLineHorizontal = ({
  className,
  offset,
  featured,
}: {
  className?: string;
  offset?: string;
  featured?: boolean;
}) => {
  return (
    <div
      style={
        {
          '--background': featured ? '#171717' : '#ffffff',
          '--background-dark': featured ? '#f5f5f5' : '#171717',
          '--height': '1px',
          '--width': '5px',
          '--fade-stop': '100%',
          '--offset': offset || '200px',
          maskComposite: 'exclude',
        } as CSSProperties
      }
      className={cn(
        'h-(--height) w-full',
        'bg-size-[var(--width)_var(--height)]',
        '[mask:linear-gradient(to_left,var(--background)_var(--fade-stop),transparent),linear-gradient(to_right,var(--background)_var(--fade-stop),transparent),linear-gradient(black,black)]',
        'dark:[mask:linear-gradient(to_left,var(--background-dark)_var(--fade-stop),transparent),linear-gradient(to_right,var(--background-dark)_var(--fade-stop),transparent),linear-gradient(black,black)]',
        'mask-exclude',
        'z-30',
        featured
          ? 'bg-[linear-gradient(to_right,#525252,#525252_50%,transparent_0,transparent)] dark:bg-[linear-gradient(to_right,#a3a3a3,#a3a3a3_50%,transparent_0,transparent)]'
          : 'bg-[linear-gradient(to_right,#e5e5e5,#e5e5e5_50%,transparent_0,transparent)] dark:bg-[linear-gradient(to_right,#404040,#404040_50%,transparent_0,transparent)]',
        className
      )}
    />
  );
};
