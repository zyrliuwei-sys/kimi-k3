"use client";

import { type LucideIcon } from "lucide-react";
import { Link, usePathname } from "@/core/i18n/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export function AppSidebar({
  brand,
  brandHref = "/",
  navItems,
  footer,
}: {
  brand: React.ReactNode;
  brandHref?: string;
  navItems: NavItem[];
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();

  // Group nav items
  const groups: { label?: string; items: NavItem[] }[] = [];
  let currentGroup: string | undefined = '__initial__';
  for (const item of navItems) {
    if (item.group !== currentGroup) {
      groups.push({ label: item.group, items: [item] });
      currentGroup = item.group;
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-4 pb-2">
        <Link href={brandHref} className="flex items-center gap-2 px-2 py-3">
          <span className="text-lg font-bold tracking-tight">{brand}</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, gi) => (
          <SidebarGroup key={gi}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent className="flex flex-col gap-2">
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === navItems[0]?.href
                      ? pathname === item.href
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <Link href={item.href}>
                        <SidebarMenuButton tooltip={item.label} isActive={isActive}>
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </Link>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {footer && (
        <SidebarFooter>
          {footer}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
