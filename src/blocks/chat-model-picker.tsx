import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

export type SelectableChatModelId =
  | 'kimi-k3'
  | 'glm-5.3-flash'
  | 'deepseek-v4-flash'
  | 'MiniMax-M3'
  | 'glm-5.3'
  | 'gemini-3.5-flash'
  | 'claude-sonnet-5'
  | 'claude-opus-4-8'
  | 'claude-opus-5'
  | 'gpt-5.6-sol'
  | 'claude-fable-5';

/**
 * Mirror of FREE_CHAT_MODEL_IDS in `@/lib/chat-billing` — not imported from
 * there because that module is server-only (it pulls the DB-backed config
 * service into the graph). Keep the two lists in sync.
 */
const FREE_MODEL_IDS: readonly SelectableChatModelId[] = [
  'glm-5.3-flash',
  'deepseek-v4-flash',
];

/**
 * Selectable model ids in picker display order (free → default → premium).
 * Mirrors getOptions() below — keep in sync. Consumers that need a model id
 * without rendering the picker (e.g. picking a default second compare column)
 * use this instead of duplicating the list.
 */
export const SELECTABLE_CHAT_MODEL_IDS: readonly SelectableChatModelId[] = [
  'glm-5.3-flash',
  'deepseek-v4-flash',
  'kimi-k3',
  'MiniMax-M3',
  'glm-5.3',
  'gemini-3.5-flash',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-5',
  'gpt-5.6-sol',
  'claude-fable-5',
];

type ModelTier = 'free' | 'default' | 'premium';

interface ModelOption {
  id: SelectableChatModelId;
  name: string;
  tier: ModelTier;
}

function getOptions(): ModelOption[] {
  return [
    {
      id: 'glm-5.3-flash',
      name: m['playground.chat.models.glm_flash.name'](),
      tier: 'free',
    },
    {
      id: 'deepseek-v4-flash',
      name: m['playground.chat.models.deepseek_flash.name'](),
      tier: 'free',
    },
    {
      id: 'kimi-k3',
      name: m['playground.chat.models.kimi.name'](),
      tier: 'default',
    },
    {
      id: 'MiniMax-M3',
      name: m['playground.chat.models.minimax.name'](),
      tier: 'premium',
    },
    {
      id: 'glm-5.3',
      name: m['playground.chat.models.glm.name'](),
      tier: 'premium',
    },
    {
      id: 'gemini-3.5-flash',
      name: m['playground.chat.models.gemini_flash.name'](),
      tier: 'premium',
    },
    {
      id: 'claude-sonnet-5',
      name: m['playground.chat.models.sonnet.name'](),
      tier: 'premium',
    },
    {
      id: 'claude-opus-4-8',
      name: m['playground.chat.models.claude_opus.name'](),
      tier: 'premium',
    },
    {
      id: 'claude-opus-5',
      name: m['playground.chat.models.opus5.name'](),
      tier: 'premium',
    },
    {
      id: 'gpt-5.6-sol',
      name: m['playground.chat.models.gpt_sol.name'](),
      tier: 'premium',
    },
    {
      id: 'claude-fable-5',
      name: m['playground.chat.models.fable.name'](),
      tier: 'premium',
    },
  ];
}

function tierLabel(tier: ModelTier): string {
  switch (tier) {
    case 'free':
      return m['playground.chat.models.group_free']();
    case 'default':
      return m['playground.chat.models.group_default']();
    case 'premium':
      return m['playground.chat.models.group_premium']();
  }
}

/**
 * Product-chat model selector. The surrounding chat route sends only the id;
 * the server owns the allowlist, provider mapping, token budget, and pricing.
 *
 * Free and paid models are visually separated: free-tier entries sit in their
 * own group with a FREE badge (daily quota, no credits), the default model
 * carries its Default badge, and premium entries carry the PRO badge.
 */
export function ChatModelPicker({
  selectedId,
  onSelect,
  disabled = false,
  className,
  placement = 'up',
}: {
  selectedId: SelectableChatModelId;
  onSelect: (id: SelectableChatModelId) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Menu direction. `up` suits the bottom-docked composer (menu opens over
   * the transcript). `down` suits headers at the top of a clipped container —
   * e.g. the compare board, whose `overflow-x-auto` panel would clip an
   * upward menu above the column header.
   */
  placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /**
   * Dismiss on any click outside the trigger/menu. A document-level listener
   * rather than a fixed backdrop: the composer's motion.div (transform during
   * entrance) and its z-10 wrapper both turned a `fixed inset-0` overlay into
   * a composer-sized hit area, so clicks in the transcript never reached it
   * and the menu stayed open. This also lets the dismissing click pass
   * through to what the user actually aimed at (textarea, a chip, …).
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  /**
   * Fixed coords for the portaled menu. Rendering to document.body escapes
   * clipping by scroll containers — e.g. the compare board's `overflow-x-auto`
   * panel, which used to cut the menu off at its left edge when the picker
   * sits in the first column's header (`right-0` anchoring extends 240px
   * further left than the button).
   */
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const options = getOptions();
  const selected =
    options.find((option) => option.id === selectedId) ?? options[0];

  const MENU_W = 240; // w-60
  const placeMenu = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Clamp inside the viewport so neither edge of the menu hangs off-screen.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
    if (placement === 'down') {
      setMenuPos({ left, top: r.bottom + 8 });
    } else {
      setMenuPos({ left, bottom: window.innerHeight - r.top + 8 });
    }
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    // Keep the fixed menu glued to its trigger while the page scrolls behind.
    window.addEventListener('scroll', placeMenu, true);
    window.addEventListener('resize', placeMenu);
    return () => {
      window.removeEventListener('scroll', placeMenu, true);
      window.removeEventListener('resize', placeMenu);
    };
  }, [open, placeMenu]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={m['playground.chat.model_label']()}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="text-foreground/80 hover:bg-foreground/[0.055] focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[12px] font-semibold tracking-tight transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {selected.tier === 'free' && (
          <span className="rounded bg-emerald-500/15 px-1 py-px text-[9px] leading-none font-bold tracking-wide text-emerald-600 dark:text-emerald-400">
            {m['playground.chat.models.free_badge']()}
          </span>
        )}
        <span className="max-w-32 truncate">{selected.name}</span>
        <ChevronDown
          className={cn(
            'text-foreground/45 size-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
            }}
            className="bg-popover text-popover-foreground border-foreground/10 z-50 w-60 overflow-hidden rounded-xl border p-1 shadow-[0_18px_44px_-20px_rgba(0,0,0,0.38)]"
          >
            <div className="max-h-[19rem] space-y-2 overflow-y-auto p-0.5">
              {(['free', 'default', 'premium'] as ModelTier[]).map((tier) => (
                <div key={tier} className="space-y-0.5">
                  <div className="text-foreground/45 px-3 pt-1 pb-0.5 text-[10px] font-bold tracking-wider uppercase">
                    {tierLabel(tier)}
                  </div>
                  {options
                    .filter((option) => option.tier === tier)
                    .map((option) => {
                      const active = option.id === selected.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            onSelect(option.id);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors',
                            'hover:bg-foreground/[0.045]',
                            active && 'bg-foreground/[0.06]'
                          )}
                        >
                          <span className="truncate">{option.name}</span>
                          {option.tier === 'free' ? (
                            <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide text-emerald-600 dark:text-emerald-400">
                              {m['playground.chat.models.free_badge']()}
                            </span>
                          ) : option.tier === 'default' ? (
                            <span className="text-foreground/40 bg-foreground/[0.06] shrink-0 rounded px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide">
                              {m['playground.chat.models.default_badge']()}
                            </span>
                          ) : (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide text-amber-600 dark:text-amber-400">
                              {m['playground.chat.models.premium_badge']()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
