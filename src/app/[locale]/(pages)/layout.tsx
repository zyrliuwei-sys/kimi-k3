import { Link } from "@/core/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { envConfigs } from "@/config";

export default function PagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="size-4" />
          {envConfigs.app_name}
        </Link>
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          {children}
        </article>
      </div>
    </div>
  );
}
