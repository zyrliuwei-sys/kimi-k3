import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';

/**
 * The /files gallery — a curated shelf of one-click file tools. Modeled on
 * the reference site's card wall but intentionally a single card: only the
 * presentation tool is curated here, so the shelf reads as a highlight reel
 * instead of a repeat of the composer's three-way tool picker.
 */
export function FilesGallery() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14">
      {/* Shelf header: quiet title with an "all" pill on the baseline of the
          reference's tab row — with one card there are no tabs to switch. */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          {m['files.gallery.title']()}
        </h1>
        <span className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs font-medium">
          {m['files.gallery.all']()}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-4">
        <Link
          href="/api-playground?tool=pptx"
          className="group bg-card hover:border-foreground/25 block w-full max-w-sm overflow-hidden rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="bg-muted aspect-[16/10] overflow-hidden">
            <img
              src="/imgs/generated/files-gallery-pptx-1788091429254.png"
              alt={m['files.gallery.pptx.title']()}
              width={1280}
              height={800}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </div>
          <div className="p-4">
            <h2 className="text-sm font-semibold">
              {m['files.gallery.pptx.title']()}
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              {m['files.gallery.pptx.desc']()}
            </p>
            <span className="group-hover:border-foreground/30 mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors">
              {m['file_studio.gallery.one_click']()}
              <ArrowRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}
