import { Link } from "@/core/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function CTA() {
  const t = await getTranslations("landing");

  return (
    <section className="px-4 pb-24 sm:pb-24">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-dashed px-6 py-12 sm:px-10 sm:py-16 text-center">
          <h2 className="font-serif font-medium text-4xl sm:text-5xl lg:text-5xl tracking-tight leading-[1.1] max-w-3xl mx-auto">
            {t("cta.headline")}
          </h2>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-4xl mx-auto leading-relaxed">
            {t("cta.subheadline")}
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/dashboard"
              className={cn(
                buttonVariants({ size: "lg" }),
                "gap-2 rounded-full px-8 h-12"
              )}
            >
              {t("cta.button")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
