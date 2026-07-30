import type { ComponentType } from 'react';

import { m } from '@/paraglide/messages.js';
import { ComingSoon } from '@/components/coming-soon';

/**
 * Shared wrapper for the lorka-style sidebar modes that don't have a real
 * implementation yet (video / search / tools / history). Keeps the route
 * files short — each is just an icon + three i18n strings.
 */
export function PlaygroundComingSoon({
  icon,
  namespace,
}: {
  icon: ComponentType<{ className?: string }>;
  namespace: 'video' | 'search' | 'tools' | 'history';
}) {
  return (
    <ComingSoon
      icon={icon}
      eyebrow={m[`playground.coming_soon.${namespace}.eyebrow`]()}
      title={m[`playground.coming_soon.${namespace}.title`]()}
      description={m[`playground.coming_soon.${namespace}.desc`]()}
      comingSoonLabel={m['playground.coming_soon.pill']()}
      backHomeLabel={m['playground.coming_soon.back_home']()}
    />
  );
}
