import { Link } from "@/core/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSelector } from "@/components/locale-selector";
import { cn } from "@/lib/utils";
import { envConfigs } from "@/config";

/**
 * Default landing page — minimal placeholder.
 *
 * Replace this with your product landing page using:
 *   /quick-start <your product description>
 */
export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between px-6 border-b border-border">
        <span className="font-semibold">{envConfigs.app_name}</span>
        <div className="flex items-center gap-2">
          <LocaleSelector />
          <ThemeToggle />
          <Link
            href="/sign-in"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ size: "sm" }), "gap-1")}
          >
            Get Started
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {envConfigs.app_name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {envConfigs.app_description}
          </p>
        </div>
      </main>
    </div>
  );
}
