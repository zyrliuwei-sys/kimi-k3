"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/core/i18n/navigation";
import { localeNames, locales } from "@/config/locale";
import { Languages, Check, Globe, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function LocaleSelector({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "pill";
  className?: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function handleSwitch(newLocale: string) {
    router.replace(pathname, { locale: newLocale });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center transition-colors outline-none",
          variant === "icon"
            ? "justify-center rounded-md size-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            : "gap-2 rounded-full border px-4 h-9 text-sm",
          className
        )}
      >
        {variant === "icon" ? (
          <>
            <Languages className="size-4" />
            <span className="sr-only">Switch language</span>
          </>
        ) : (
          <>
            <Globe className="size-4" />
            <span>{localeNames[locale] || locale}</span>
            <ChevronDown className="size-4 opacity-70" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => handleSwitch(loc)}
            className="flex items-center justify-between gap-2"
          >
            {localeNames[loc] || loc}
            {loc === locale && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
