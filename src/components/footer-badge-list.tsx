import { DEFAULT_FOOTER_BADGES } from '@/features/footer-badges/defaults';
import { parseStoredFooterBadges } from '@/features/footer-badges/validation';

import { cn } from '@/lib/utils';
import { usePublicConfig } from '@/hooks/use-public-config';

export function FooterBadgeList({
  className,
  children,
}: {
  className?: string;
  /** Extra hard-coded badges rendered in the same row, after the admin list. */
  children?: React.ReactNode;
}) {
  const { data } = usePublicConfig();
  const badges =
    data?.footer_badges === undefined
      ? DEFAULT_FOOTER_BADGES
      : parseStoredFooterBadges(data.footer_badges);

  if (badges.length === 0 && !children) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-3',
        className
      )}
    >
      {badges.map((badge) => (
        <a
          key={`${badge.href}:${badge.src}`}
          href={badge.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full transition-opacity hover:opacity-80"
        >
          <img
            src={badge.src}
            alt={badge.alt}
            width={badge.width ?? 250}
            height={badge.height}
            loading="lazy"
            className="h-7 w-auto"
          />
        </a>
      ))}
      {children}
    </div>
  );
}
