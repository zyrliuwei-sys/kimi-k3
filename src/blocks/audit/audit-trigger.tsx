'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';

import { AuditModal } from './audit-modal';

/**
 * CTA that opens the audit modal.
 *
 * The button + modal live in one component so the parent doesn't need
 * to own modal state. Pick the variant that matches the surrounding
 * pill / link cluster:
 *
 *   - 'pill'    — small outline pill (matches the "Document Analysis"
 *                 chip on the API playground welcome state)
 *   - 'compact' — link-style for footers or feature blocks
 */
export function AuditTrigger({
  variant = 'pill',
  className,
  defaultUrl,
}: {
  variant?: 'pill' | 'compact';
  className?: string;
  defaultUrl?: string;
}) {
  const [open, setOpen] = useState(false);

  if (variant === 'compact') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            buttonVariants({ variant: 'link', size: 'default' }),
            'text-foreground/75 hover:text-foreground inline-flex items-center gap-1.5',
            className
          )}
        >
          <Search className="size-3.5" />
          {m['landing.hero.cta_audit']()}
        </button>
        <AuditModal
          open={open}
          onOpenChange={setOpen}
          defaultUrl={defaultUrl}
        />
      </>
    );
  }

  // 'pill' variant — same hover style and color tone as the existing
  // Document Analysis pill so the two read as a sibling set.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'inline-flex items-center gap-1.5 rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
          className
        )}
      >
        <Search className="size-3.5" />
        {m['landing.hero.cta_audit']()}
      </button>
      <AuditModal open={open} onOpenChange={setOpen} defaultUrl={defaultUrl} />
    </>
  );
}
