import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

export type SelectableChatModelId =
  | 'kimi-k3'
  | 'gpt-5.6-sol'
  | 'claude-opus-4-8';

interface ModelOption {
  id: SelectableChatModelId;
  name: string;
}

function getOptions(): ModelOption[] {
  return [
    {
      id: 'kimi-k3',
      name: m['playground.chat.models.kimi.name'](),
    },
    {
      id: 'gpt-5.6-sol',
      name: m['playground.chat.models.gpt_sol.name'](),
    },
    {
      id: 'claude-opus-4-8',
      name: m['playground.chat.models.claude_opus.name'](),
    },
  ];
}

/**
 * Product-chat model selector. The surrounding chat route sends only the id;
 * the server owns the allowlist, provider mapping, token budget, and pricing.
 */
export function ChatModelPicker({
  selectedId,
  onSelect,
  disabled = false,
  className,
}: {
  selectedId: SelectableChatModelId;
  onSelect: (id: SelectableChatModelId) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const options = getOptions();
  const selected =
    options.find((option) => option.id === selectedId) ?? options[0];

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        aria-label={m['playground.chat.model_label']()}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="text-foreground/80 hover:bg-foreground/[0.055] focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[12px] font-semibold tracking-tight transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="max-w-32 truncate">{selected.name}</span>
        <ChevronDown
          className={cn(
            'text-foreground/45 size-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={m['playground.chat.models.close']()}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="bg-popover text-popover-foreground border-foreground/10 absolute right-0 bottom-full z-50 mb-2 w-52 overflow-hidden rounded-xl border p-1 shadow-[0_18px_44px_-20px_rgba(0,0,0,0.38)]">
            <div className="space-y-0.5">
              {options.map((option) => {
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
                      'flex w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                      'hover:bg-foreground/[0.045]',
                      active && 'bg-foreground/[0.06]'
                    )}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
