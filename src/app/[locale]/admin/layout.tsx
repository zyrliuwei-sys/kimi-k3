"use client";

import { useTranslations } from "next-intl";
import { LayoutDashboard, Users, Shield, Settings } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { envConfigs } from "@/config";
import { AppLayout } from "@/components/app-layout";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("admin");

  const navItems = [
    { href: "/admin", label: t("nav.overview"), icon: LayoutDashboard },
    { href: "/admin/users", label: t("nav.users"), icon: Users },
    { href: "/admin/roles", label: t("nav.roles"), icon: Shield },
    { href: "/admin/settings", label: t("nav.settings"), icon: Settings },
  ];

  const brand = (
    <>
      {envConfigs.app_name}
      <span className="ml-2 text-xs font-normal text-muted-foreground">Admin</span>
    </>
  );

  return (
    <AppLayout
      navItems={navItems}
      brand={brand}
      brandHref="/admin"
      mobileBrand={`${envConfigs.app_name} Admin`}
      requirePermission="admin.*"
      headerExtra={
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          {t("back_to_dashboard")}
        </Link>
      }
    >
      {children}
    </AppLayout>
  );
}
