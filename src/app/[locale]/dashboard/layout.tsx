"use client";

import { useTranslations } from "next-intl";
import { LayoutDashboard, Settings, CreditCard, Key } from "lucide-react";
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
    { href: "/dashboard/settings", label: t("dashboard.nav.settings"), icon: Settings },
    { href: "/dashboard/billing", label: t("dashboard.nav.billing"), icon: CreditCard },
    { href: "/dashboard/api-keys", label: t("dashboard.nav.api_keys"), icon: Key },
  ];

  return (
    <AppLayout navItems={navItems} brand={envConfigs.app_name}>
      {children}
    </AppLayout>
  );
}
