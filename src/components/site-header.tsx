"use client";

import { Link } from "@/core/i18n/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSelector } from "@/components/locale-selector";
import { cn } from "@/lib/utils";
import { envConfigs } from "@/config";

export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
}

export function SiteHeader({
  navLinks,
}: {
  navLinks?: NavLink[];
}) {
  const t = useTranslations("common");
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <Link href="/" className="flex items-center">
          <span className="font-serif italic text-lg">{envConfigs.app_name}</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {navLinks?.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 md:flex">
          <LocaleSelector />
          <ThemeToggle />
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ size: "sm" }), "gap-1")}
          >
            {t("nav.get_started")}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-2">
            {navLinks?.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <LocaleSelector />
            <ThemeToggle />
            <div className="flex-1" />
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ size: "sm" }), "gap-1")}
              onClick={() => setMobileOpen(false)}
            >
              {t("nav.get_started")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
