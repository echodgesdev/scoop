// @ts-check
// Tiny synchronous pub/sub. Subsystems subscribe to named game events; game.js
// emits them at the point of decision. Listeners run in subscription order;
// exceptions are caught so one bad listener can't kill the frame.

/**
 * @template {Record<string, any>} E
 */
export class EventBus {
  constructor() {
    /** @type {Map<keyof E, Set<(payload: any) => void>>} */
    this._listeners = new Map();
  }

  /**
   * @template {keyof E} K
   * @param {K} event
   * @param {(payload: E[K]) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(event, handler) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /**
   * @template {keyof E} K
   * @param {K} event
   * @param {E[K]} [payload]
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[bus] handler for "${String(event)}" threw:`, err);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}
