'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Aceternity-style collapsible sidebar. The shadcn `Sidebar` from
 * `./sidebar` is a different family (uses `SidebarProvider`, controlled
 * `collapsible` prop, peer-data width transitions); this one is a
 * controlled `open` boolean with `motion` width animation. Playground
 * uses it; admin / settings keep the shadcn one.
 *
 * The exported names are prefixed to avoid colliding with the shadcn
 * `Sidebar` / `SidebarBody` we already re-export.
 */
const COLLAPSED_WIDTH = 64;
const EXPANDED_WIDTH = 280;

export function AceternitySidebar({
  children,
  open,
  setOpen,
  className,
}: {
  children: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group/sidebar relative z-10 flex h-svh shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800',
        className
      )}
      style={{
        width: open ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      data-state={open ? 'open' : 'closed'}
    >
      {children}
    </div>
  );
}

export function AceternitySidebarBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-1 flex-col overflow-x-hidden overflow-y-auto px-2 py-4',
        className
      )}
    >
      {children}
    </div>
  );
}

export function AceternitySidebarLink({
  link,
  isActive,
  className,
}: {
  link: {
    label: string;
    href: string;
    icon: React.ReactNode;
  };
  isActive?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={link.href}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
        isActive
          ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white'
          : 'text-neutral-700 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-700/60',
        className
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {link.icon}
      </span>
      <motion.span
        initial={false}
        animate={{
          opacity: 1,
          width: 'auto',
          marginLeft: 0,
        }}
        // When the parent group is closed, hide the label. We can't
        // read state directly here, so we rely on the parent group
        // selector — `group-data-[state=closed]/sidebar:hidden`.
        className="overflow-hidden whitespace-pre group-data-[state=closed]/sidebar:hidden"
      >
        {link.label}
      </motion.span>
    </Link>
  );
}
