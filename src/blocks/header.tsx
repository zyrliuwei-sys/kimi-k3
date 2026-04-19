import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";

export async function Header() {
  const t = await getTranslations("landing");

  const navLinks = [
    { href: "#features", label: t("nav.features") },
    { href: "#pricing", label: t("nav.pricing") },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
