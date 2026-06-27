import type { Media } from '../lib/api';

type Listener = () => void;

function createHoverStore() {
  let media: Media | null = null;
  const listeners = new Set<Listener>();

  return {
    get media() { return media; },

    setMedia(newMedia: Media | null) {
      media = newMedia;
      listeners.forEach(l => l());
    },

    clear() {
      media = null;
      listeners.forEach(l => l());
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const hoverStore = createHoverStore();
