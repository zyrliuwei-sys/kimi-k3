"use client";

import { PricingTable, type PricingGroup } from "@/components/pricing-table";
import { useTranslations } from "next-intl";
import {
  Folder,
  Folders,
  Sparkles,
  Mail,
  Zap,
  Terminal,
  Check,
  Infinity as InfinityIcon,
  Headphones,
  Puzzle,
} from "lucide-react";

export function Pricing() {
  const t = useTranslations("landing");

  const starterFeatures = [
    { icon: Folder, label: t("pricing.feature_1_project") },
    { icon: Sparkles, label: t("pricing.feature_5k_credits") },
    { icon: Mail, label: t("pricing.feature_email_support") },
  ];
  const proFeatures = [
    { icon: Folders, label: t("pricing.feature_unlimited_projects") },
    { icon: Sparkles, label: t("pricing.feature_50k_credits") },
    { icon: Zap, label: t("pricing.feature_priority_support") },
    { icon: Terminal, label: t("pricing.feature_api_access") },
  ];
  const enterpriseFeatures = [
    { icon: Check, label: t("pricing.feature_everything_pro") },
    { icon: InfinityIcon, label: t("pricing.feature_unlimited_credits") },
    { icon: Headphones, label: t("pricing.feature_dedicated_support") },
    { icon: Puzzle, label: t("pricing.feature_custom_integrations") },
  ];

  const groups: PricingGroup[] = [
    {
      key: "monthly",
      label: t("pricing.monthly"),
      plans: [
        {
          id: "starter-monthly",
          name: t("pricing.starter"),
          description: t("pricing.starter_desc"),
          price: "$9",
          interval: "mo",
          features: starterFeatures,
          productId: "starter_monthly",
          priceInCents: 900,
          currency: "usd",
          plan: { name: "Starter", interval: "month", intervalCount: 1 },
        },
        {
          id: "pro-monthly",
          name: t("pricing.pro"),
          description: t("pricing.pro_desc"),
          price: "$29",
          interval: "mo",
          featured: true,
          badge: t("pricing.popular"),
          features: proFeatures,
          productId: "pro_monthly",
          priceInCents: 2900,
          currency: "usd",
          plan: { name: "Pro", interval: "month", intervalCount: 1 },
        },
        {
          id: "enterprise-monthly",
          name: t("pricing.enterprise"),
          description: t("pricing.enterprise_desc"),
          price: "$99",
          interval: "mo",
          features: enterpriseFeatures,
          productId: "enterprise_monthly",
          priceInCents: 9900,
          currency: "usd",
          plan: { name: "Enterprise", interval: "month", intervalCount: 1 },
        },
      ],
    },
    {
      key: "yearly",
      label: t("pricing.yearly"),
      plans: [
        {
          id: "starter-yearly",
          name: t("pricing.starter"),
          description: t("pricing.starter_desc"),
          price: "$86",
          originalPrice: "$108",
          interval: "yr",
          features: starterFeatures,
          productId: "starter_yearly",
          priceInCents: 8600,
          currency: "usd",
          plan: { name: "Starter", interval: "year", intervalCount: 1 },
        },
        {
          id: "pro-yearly",
          name: t("pricing.pro"),
          description: t("pricing.pro_desc"),
          price: "$278",
          originalPrice: "$348",
          interval: "yr",
          featured: true,
          badge: t("pricing.popular"),
          features: proFeatures,
          productId: "pro_yearly",
          priceInCents: 27800,
          currency: "usd",
          plan: { name: "Pro", interval: "year", intervalCount: 1 },
        },
        {
          id: "enterprise-yearly",
          name: t("pricing.enterprise"),
          description: t("pricing.enterprise_desc"),
          price: "$950",
          originalPrice: "$1,188",
          interval: "yr",
          features: enterpriseFeatures,
          productId: "enterprise_yearly",
          priceInCents: 95000,
          currency: "usd",
          plan: { name: "Enterprise", interval: "year", intervalCount: 1 },
        },
      ],
    },
  ];

  return (
    <section id="pricing" className="px-4 py-24 sm:py-32 border-t border-border">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-20">
          <h2 className="font-serif font-normal text-4xl sm:text-5xl tracking-tight">
            {t("pricing.title")}
          </h2>
          <p className="mt-5 text-muted-foreground">
            {t("pricing.description")}
          </p>
        </div>
        <PricingTable groups={groups} />
      </div>
    </section>
  );
}
