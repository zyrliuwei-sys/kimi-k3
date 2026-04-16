"use client";

import { useTranslations } from "next-intl";
import { LayoutDashboard, Users, Shield, KeyRound, Settings } from "lucide-react";
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
    { href: "/admin/settings", label: t("nav.settings"), icon: Settings },
    { href: "/admin/users", label: t("nav.users"), icon: Users, group: t("nav.rbac") },
    { href: "/admin/roles", label: t("nav.roles"), icon: Shield, group: t("nav.rbac") },
    { href: "/admin/permissions", label: t("nav.permissions"), icon: KeyRound, group: t("nav.rbac") },
  ];

  return (
    <AppLayout
      navItems={navItems}
      brand={envConfigs.app_name}
      brandHref="/admin"
      requirePermission="admin.*"
    >
      {children}
    </AppLayout>
  );
}
