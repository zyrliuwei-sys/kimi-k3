import { Link } from "@/core/i18n/navigation";
import type { ComponentType, SVGProps } from "react";
import { envConfigs } from "@/config";
import { cn } from "@/lib/utils";
import { LocaleSelector } from "@/components/locale-selector";

export interface FooterColumn {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}

export interface FooterSocial {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string;
  label: string;
}

export function SiteFooter({
  tagline,
  columns,
  socials,
  copyright,
}: {
  tagline?: string;
  columns?: FooterColumn[];
  socials?: FooterSocial[];
  copyright?: string;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-7xl px-6 pt-14 pb-6 sm:px-10 sm:pt-16 lg:px-16">
        {tagline && (
          <p className="font-serif italic text-3xl leading-[1.15] tracking-tight text-neutral-100 sm:text-4xl mb-12 max-w-2xl">
            {tagline}
          </p>
        )}

        {columns && columns.length > 0 && (
          <div
            className={cn(
              "grid gap-x-8 gap-y-10 sm:gap-x-12",
              columns.length <= 3
                ? "grid-cols-2 sm:grid-cols-3"
                : columns.length === 4
                  ? "grid-cols-2 sm:grid-cols-4"
                  : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
            )}
          >
            {columns.map((col) => (
              <div key={col.title} className="space-y-5">
                <h4 className="text-[13px] font-semibold tracking-wide text-neutral-100">
                  {col.title}
                </h4>
                <ul className="space-y-2">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Socials + language row */}
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          {socials && socials.length > 0 ? (
            <div className="flex items-center gap-5">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-300 transition-colors hover:text-neutral-100"
                >
                  <s.icon className="size-[18px]" />
                </a>
              ))}
            </div>
          ) : (
            <div />
          )}
          <LocaleSelector
            variant="pill"
            className="border-neutral-700 text-neutral-200 hover:bg-white/5 hover:text-neutral-50"
          />
        </div>

        {/* Bottom bar */}
        <div className="mt-6 flex flex-col gap-3 border-t border-neutral-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-serif italic text-base text-neutral-300">
            ShipAny Next
          </span>
          <span className="text-sm text-neutral-500">
            {copyright || `© ${year} ${envConfigs.app_name}. All rights reserved.`}
          </span>
        </div>
      </div>
    </footer>
  );
}
