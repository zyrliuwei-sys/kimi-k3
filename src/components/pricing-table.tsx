"use client";

import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  featured?: boolean;
  badge?: string;
  features: PricingFeature[];
  buttonText?: string;
  productId?: string;
  paymentProvider?: string;
  priceInCents?: number;
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
  const t = useTranslations("common");
  const [activeGroup, setActiveGroup] = useState(groups[0]?.key || "");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const currentGroup = groups.find((g) => g.key === activeGroup) || groups[0];

  async function handleCheckout(plan: PricingPlan) {
    if (onCheckout) {
      onCheckout(plan);
      return;
    }

    if (!plan.productId || !plan.priceInCents) return;

    setLoadingId(plan.id);
    try {
      const res = await fetch("/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: plan.productId,
          price: plan.priceInCents,
          currency: plan.currency || "usd",
          type: plan.plan ? "subscription" : "one-time",
          description: plan.name,
          plan: plan.plan,
          payment_provider: plan.paymentProvider || "stripe",
        }),
      });
      const data = await res.json();
      if (data.code === 0 && data.data?.checkout_url) {
        window.location.href = data.data.checkout_url;
      }
    } catch {
      // error handled silently
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-10">
      {/* Group tabs — pill toggle */}
      {groups.length > 1 && (
        <div className="flex justify-center">
          <div className="inline-flex items-center rounded-full border border-border bg-muted/40 p-1">
            {groups.map((group) => (
              <button
                key={group.key}
                onClick={() => setActiveGroup(group.key)}
                className={cn(
                  "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
                  activeGroup === group.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plans grid */}
      <div
        className={cn(
          "mx-auto grid gap-6",
          currentGroup?.plans.length === 2
            ? "max-w-3xl sm:grid-cols-2"
            : currentGroup?.plans.length === 3
              ? "max-w-5xl sm:grid-cols-2 lg:grid-cols-3"
              : "max-w-6xl sm:grid-cols-2 lg:grid-cols-4"
        )}
      >
        {currentGroup?.plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative flex flex-col rounded-3xl border bg-background p-8 transition-colors",
              plan.featured
                ? "border-2 border-primary"
                : "border-border hover:border-foreground/30"
            )}
          >
            {/* Price */}
            <div className="mb-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">
                {plan.price}
              </span>
              {plan.interval && (
                <span className="text-base text-muted-foreground">
                  /{plan.interval}
                </span>
              )}
            </div>
            {plan.originalPrice && (
              <span className="mb-1 text-sm text-muted-foreground line-through">
                {plan.originalPrice}
              </span>
            )}

            {/* Description */}
            {plan.description && (
              <p className="mb-8 text-sm text-muted-foreground">
                {plan.description}
              </p>
            )}

            {/* CTA — full-width pill */}
            <Button
              className={cn(
                "h-11 w-full rounded-full text-sm font-medium",
                plan.featured
                  ? ""
                  : "bg-foreground text-background hover:bg-foreground/90"
              )}
              onClick={() => handleCheckout(plan)}
              disabled={loadingId === plan.id}
            >
              {loadingId === plan.id
                ? t("pricing.processing")
                : plan.buttonText || t("pricing.get_started")}
            </Button>

            {/* Features */}
            <ul className="mt-8 space-y-3.5">
              {plan.features.map((feature, i) => {
                const isObj = typeof feature !== "string";
                const Icon: IconComponent =
                  (isObj && feature.icon) || Check;
                const label = isObj ? feature.label : feature;
                return (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-foreground">{label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
