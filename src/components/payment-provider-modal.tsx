'use client';

import { ArrowUpRight, CreditCard, Loader2, PlusIcon } from 'lucide-react';

import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** A provider name registered by the server-side PaymentManager. */
export type PaymentProvider = string;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: PaymentProvider[];
  loadingProvider?: PaymentProvider | null;
  onSelect: (provider: PaymentProvider) => void;
  planName?: string;
  price?: string;
  /** Copy for contextual paywalls, e.g. a blocked generation request. */
  title?: string;
  description?: string;
}

const providerLabels: Record<string, string> = {
  stripe: 'Stripe',
  creem: 'Creem',
  waffo: 'Waffo Pancake',
  paypal: 'PayPal',
  alipay: 'Alipay',
  wechat: 'WeChat Pay',
};

function providerLabel(provider: PaymentProvider) {
  return (
    providerLabels[provider] ||
    provider
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

export function PaymentProviderModal({
  open,
  onOpenChange,
  providers,
  loadingProvider,
  onSelect,
  planName,
  price,
  title,
  description,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-foreground/15 bg-background overflow-hidden p-0 shadow-[0_24px_70px_-20px_rgba(32,32,32,0.45)] sm:max-w-xl">
        <div className="relative isolate">
          <PlusIcon
            aria-hidden="true"
            className="text-foreground/70 absolute -top-3 -left-3 z-10 size-6"
            strokeWidth={1}
          />
          <PlusIcon
            aria-hidden="true"
            className="text-foreground/70 absolute -top-3 -right-3 z-10 size-6"
            strokeWidth={1}
          />
          <PlusIcon
            aria-hidden="true"
            className="text-foreground/70 absolute -bottom-3 -left-3 z-10 size-6"
            strokeWidth={1}
          />
          <PlusIcon
            aria-hidden="true"
            className="text-foreground/70 absolute -right-3 -bottom-3 z-10 size-6"
            strokeWidth={1}
          />

          <div
            aria-hidden="true"
            className="border-border pointer-events-none absolute -inset-y-6 left-0 z-0 w-px border-l"
          />
          <div
            aria-hidden="true"
            className="border-border pointer-events-none absolute -inset-y-6 right-0 z-0 w-px border-r"
          />
          <div
            aria-hidden="true"
            className="border-foreground/15 pointer-events-none absolute -top-6 -bottom-6 left-1/2 -z-10 border-l border-dashed"
          />

          <DialogHeader className="border-border relative overflow-hidden border-b px-6 pt-7 pb-6 sm:px-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_100%_at_0%_0%,color-mix(in_oklab,var(--foreground)_9%,transparent),transparent)]"
            />
            <DialogTitle className="font-serif text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
              {title || m['common.pricing.choose_payment']()}
            </DialogTitle>
            <DialogDescription className="text-base sm:text-[1.05rem]">
              {description ||
                (planName
                  ? price
                    ? m['common.pricing.payment_for']({ plan: planName, price })
                    : m['common.pricing.payment_for_plan']({ plan: planName })
                  : m['common.pricing.choose_payment_desc']())}
            </DialogDescription>
          </DialogHeader>

          <div className="relative space-y-3 px-6 py-6 sm:px-8 sm:py-7">
            {providers.map((p) => {
              const loading = loadingProvider === p;
              return (
                <Button
                  key={p}
                  variant="outline"
                  className="group border-border bg-background hover:border-foreground/45 hover:bg-muted/45 relative h-16 w-full justify-between overflow-hidden rounded-none px-4 text-base shadow-none transition-[border-color,background-color,transform] hover:-translate-y-0.5 sm:h-[4.5rem] sm:px-5 sm:text-lg"
                  disabled={!!loadingProvider}
                  onClick={() => onSelect(p)}
                >
                  <span className="relative z-10 flex items-center gap-3.5">
                    <span className="border-border bg-muted/40 group-hover:border-foreground/30 group-hover:bg-background grid size-9 place-items-center border transition-colors sm:size-10">
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CreditCard className="size-[18px]" strokeWidth={1.7} />
                      )}
                    </span>
                    <span className="font-semibold tracking-tight">
                      {providerLabel(p)}
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="text-muted-foreground group-hover:text-foreground relative z-10 size-4 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    strokeWidth={1.6}
                  />
                  <span
                    aria-hidden="true"
                    className="bg-foreground/[0.035] absolute inset-y-0 left-0 w-0 transition-[width] duration-300 group-hover:w-full"
                  />
                </Button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
