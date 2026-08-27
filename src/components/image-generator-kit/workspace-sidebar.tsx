import { useState } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';

import type { ImageGeneratorNavItem } from './types';
import { cn } from './utils';

type WorkspaceSidebarProps = {
  brand: React.ReactNode;
  navItems: ImageGeneratorNavItem[];
};

export function WorkspaceSidebar({ brand, navItems }: WorkspaceSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <aside
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        'hidden h-full shrink-0 flex-col border-r border-black/[0.07] bg-[#fbfbfc] px-2 py-3 transition-[width] duration-300 ease-out md:flex dark:border-white/10 dark:bg-[#0d0e11]',
        open ? 'w-52' : 'w-14'
      )}
    >
      <div className="flex h-9 items-center gap-2 px-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
          <Sparkles className="size-3.5" />
        </span>
        <span
          className={cn(
            'truncate text-sm font-semibold tracking-[-0.03em] transition-opacity',
            !open && 'opacity-0'
          )}
        >
          {brand}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'ml-auto text-neutral-400 transition-opacity hover:text-neutral-950 dark:hover:text-white',
            !open && 'opacity-0'
          )}
          aria-label="Toggle sidebar"
        >
          <PanelLeftClose className="size-3.5" />
        </button>
      </div>
      <nav className="mt-7 space-y-1">
        {navItems.map((item, index) => {
          const body = (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center text-neutral-600 dark:text-white/60">
                {item.icon ??
                  (index === 0 ? (
                    <Menu className="size-4" />
                  ) : (
                    <PanelLeftOpen className="size-4" />
                  ))}
              </span>
              <span
                className={cn(
                  'truncate text-sm transition-opacity',
                  !open && 'opacity-0'
                )}
              >
                {item.label}
              </span>
            </>
          );
          const className =
            'flex h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left text-neutral-600 transition-colors hover:bg-black/[0.045] hover:text-neutral-950 dark:text-white/55 dark:hover:bg-white/[0.07] dark:hover:text-white';
          return item.href ? (
            <a
              key={`${item.label}-${index}`}
              href={item.href}
              className={className}
            >
              {body}
            </a>
          ) : (
            <button
              key={`${item.label}-${index}`}
              type="button"
              onClick={item.onClick}
              className={className}
            >
              {body}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
