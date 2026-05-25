"use client";

import { useEffect, useRef, useState } from "react";
import { getAuthClient, useSession } from "@/core/auth/client";

// Mounts the Google One Tap prompt for signed-out visitors when the
// admin has enabled it. Self-contained: pulls config from
// /api/config/public, gates on session, and triggers at most once
// per page load.
export function GoogleOneTap() {
  const { data: session, isPending } = useSession();
  const [configs, setConfigs] = useState<Record<string, string> | null>(null);
  const triggered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        const data = (res?.data ?? res) as Record<string, string>;
        setConfigs(data || {});
      })
      .catch(() => {
        if (!cancelled) setConfigs({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (triggered.current) return;
    if (!configs) return;
    if (isPending) return;
    if (session?.user) return;
    if (
      configs.google_one_tap_enabled !== "true" ||
      !configs.google_client_id
    ) {
      return;
    }

    triggered.current = true;
    const client = getAuthClient(configs);
    (client as any).oneTap?.({
      callbackURL: "/",
      onPromptNotification: () => {
        // Silently ignore dismissals / FedCM hiccups — the user can still
        // sign in via the normal /sign-in page.
      },
    }).catch(() => {
      // Same — One Tap cancellations throw NetworkError/AbortError that
      // aren't actionable.
    });
  }, [configs, session, isPending]);

  return null;
}
