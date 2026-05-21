type Opts = {
  debounceMs: number;
  flush: (pageId: string) => void | Promise<void>;
};

/**
 * Pure-ish scheduler: debounces per-page store events and forces an immediate,
 * debounce-cancelling flush on last disconnect so the final edits are never lost.
 * No Yjs / no DB — those are injected via `flush`.
 */
export function createMaterializeScheduler({ debounceMs, flush }: Opts) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function clear(pageId: string) {
    const t = timers.get(pageId);
    if (t) {
      clearTimeout(t);
      timers.delete(pageId);
    }
  }

  return {
    onStore(pageId: string) {
      clear(pageId);
      timers.set(
        pageId,
        setTimeout(() => {
          timers.delete(pageId);
          void flush(pageId);
        }, debounceMs),
      );
    },
    onLastDisconnect(pageId: string) {
      clear(pageId); // cancel pending debounce — we flush now instead
      void flush(pageId);
    },
  };
}
