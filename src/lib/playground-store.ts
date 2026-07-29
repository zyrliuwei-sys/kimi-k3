/**
 * Tiny shared store for the `/api-playground` multi-session UX.
 *
 * Holds the currently-selected chat row, image task, and video task. The
 * blocks (`ChatPlayground`, `ImagePlayground`, `VideoPlayground`) and the
 * sidebar list (`PlaygroundSidebarList`) subscribe to it; the per-mode
 * "新建…" CTAs just call `clearActive()` which flips every active id to
 * `null` — each block reacts by clearing its local input / pending state
 * through a useEffect.
 *
 * Implemented with `useSyncExternalStore` over a module-scoped state object
 * so we don't pull in a state-management library. The store is intentionally
 * client-only — never read this from a server loader.
 */

import { useSyncExternalStore } from 'react';

export type PlaygroundMode = 'chat' | 'image' | 'video';

export interface PlaygroundState {
  mode: PlaygroundMode;
  activeChatId: string | null;
  activeImageId: string | null;
  activeVideoId: string | null;
}

const state: PlaygroundState = {
  mode: 'chat',
  activeChatId: null,
  activeImageId: null,
  activeVideoId: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PlaygroundState {
  // Return the same object reference so `useSyncExternalStore` can detect
  // changes via identity equality. The internal fields are mutated in place.
  return state;
}

// `useSyncExternalStore` requires a server snapshot. On the server we render
// with `mode='chat'` and no active session — the client will hydrate and the
// user can start fresh.
function getServerSnapshot(): PlaygroundState {
  return state;
}

export const usePlaygroundStore = () => {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return {
    mode: snapshot.mode,
    activeChatId: snapshot.activeChatId,
    activeImageId: snapshot.activeImageId,
    activeVideoId: snapshot.activeVideoId,

    setMode(mode: PlaygroundMode) {
      if (state.mode === mode) return;
      state.mode = mode;
      emit();
    },

    setActiveChatId(id: string | null) {
      if (state.activeChatId === id) return;
      state.activeChatId = id;
      emit();
    },

    setActiveImageId(id: string | null) {
      if (state.activeImageId === id) return;
      state.activeImageId = id;
      emit();
    },

    setActiveVideoId(id: string | null) {
      if (state.activeVideoId === id) return;
      state.activeVideoId = id;
      emit();
    },

    /** "新建聊天" / "新建图像" / "新建视频" — local clear, no server call. */
    clearActive() {
      const changed =
        state.activeChatId !== null ||
        state.activeImageId !== null ||
        state.activeVideoId !== null;
      state.activeChatId = null;
      state.activeImageId = null;
      state.activeVideoId = null;
      if (changed) emit();
    },
  };
};

/** Imperative access for non-React callers (e.g. event handlers in modules). */
export const playgroundStore = {
  get mode() {
    return state.mode;
  },
  get activeChatId() {
    return state.activeChatId;
  },
  get activeImageId() {
    return state.activeImageId;
  },
  get activeVideoId() {
    return state.activeVideoId;
  },
  setMode(mode: PlaygroundMode) {
    if (state.mode === mode) return;
    state.mode = mode;
    emit();
  },
  setActiveChatId(id: string | null) {
    if (state.activeChatId === id) return;
    state.activeChatId = id;
    emit();
  },
  setActiveImageId(id: string | null) {
    if (state.activeImageId === id) return;
    state.activeImageId = id;
    emit();
  },
  setActiveVideoId(id: string | null) {
    if (state.activeVideoId === id) return;
    state.activeVideoId = id;
    emit();
  },
  clearActive() {
    const changed =
      state.activeChatId !== null ||
      state.activeImageId !== null ||
      state.activeVideoId !== null;
    state.activeChatId = null;
    state.activeImageId = null;
    state.activeVideoId = null;
    if (changed) emit();
  },
  subscribe,
};
