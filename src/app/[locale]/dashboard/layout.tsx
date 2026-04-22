"use client";

import { useTranslations } from "next-intl";
import { LayoutDashboard, Settings, CreditCard, Key, Receipt, Coins } from "lucide-react";
import { envConfigs } from "@/config";
import { AppLayout } from "@/components/app-layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations();

  const navItems = [
    { href: "/dashboard", label: t("dashboard.nav.overview"), icon: LayoutDashboard },
    { href: "/dashboard/billing", label: t("dashboard.nav.billing"), icon: CreditCard },
    { href: "/dashboard/payments", label: t("dashboard.nav.payments"), icon: Receipt },
    { href: "/dashboard/credits", label: t("dashboard.nav.credits"), icon: Coins },
    { href: "/dashboard/apikeys", label: t("dashboard.nav.apikeys"), icon: Key },
  ];

  const footerNavItems = [
    { href: "/dashboard/settings", label: t("dashboard.nav.settings"), icon: Settings },
  ];

  return (
    <AppLayout navItems={navItems} footerNavItems={footerNavItems} brand={envConfigs.app_name}>
      {children}
    </AppLayout>
  );
}
