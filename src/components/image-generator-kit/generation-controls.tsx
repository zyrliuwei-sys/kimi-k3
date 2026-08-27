import { ChevronDown, Frame, Images, Layers3 } from 'lucide-react';

import { cn } from './utils';

type GenerationControlsProps = {
  aspectRatio: string;
  imageCount: number;
  model?: string;
  models: string[];
  onAspectRatioChange: (value: string) => void;
  onImageCountChange: (value: number) => void;
  onModelChange?: (value: string) => void;
  ratios: readonly string[];
  strings: { aspectRatio: string; imageCount: string; model: string };
};

export function GenerationControls({
  aspectRatio,
  imageCount,
  model,
  models,
  onAspectRatioChange,
  onImageCountChange,
  onModelChange,
  ratios,
  strings,
}: GenerationControlsProps) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ControlMenu
        icon={<Images className="size-3.5" />}
        label={strings.imageCount}
        value={String(imageCount)}
      >
        <div className="grid grid-cols-4 gap-1.5 p-2">
          {[1, 2, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onImageCountChange(count)}
              className={cn(
                'rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors',
                count === imageCount
                  ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                  : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
              )}
            >
              {count}
            </button>
          ))}
        </div>
      </ControlMenu>

      <ControlMenu
        icon={<Frame className="size-3.5" />}
        label={strings.aspectRatio}
        value={aspectRatio || 'Smart'}
      >
        <div className="grid min-w-48 grid-cols-3 gap-1.5 p-2">
          {ratios.map((ratio) => (
            <button
              key={ratio || 'smart'}
              type="button"
              onClick={() => onAspectRatioChange(ratio)}
              className={cn(
                'rounded-lg px-2 py-2 text-xs font-semibold transition-colors',
                ratio === aspectRatio
                  ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                  : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
              )}
            >
              {ratio || 'Smart'}
            </button>
          ))}
        </div>
      </ControlMenu>

      {models.length && onModelChange ? (
        <ControlMenu
          className="ml-auto"
          icon={<Layers3 className="size-3.5" />}
          label={strings.model}
          value={model ?? models[0]}
        >
          <div className="min-w-48 p-1.5">
            {models.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => onModelChange(entry)}
                className={cn(
                  'block w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors',
                  entry === model
                    ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                    : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                )}
              >
                {entry}
              </button>
            ))}
          </div>
        </ControlMenu>
      ) : null}
    </div>
  );
}

function ControlMenu({
  children,
  className,
  icon,
  label,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <details className={cn('group relative', className)}>
      <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-black/[0.045] hover:text-neutral-950 dark:text-white/50 dark:hover:bg-white/[0.07] dark:hover:text-white [&::-webkit-details-marker]:hidden">
        {icon}
        <span className="max-w-24 truncate">{value}</span>
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className="absolute bottom-11 left-0 z-30 overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#1a1b20] dark:shadow-[0_18px_42px_rgba(0,0,0,0.35)]">
        {children}
      </div>
    </details>
  );
}
