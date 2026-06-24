// @ts-check
/**
 * A cancelable bag of one-shot timers. Schedule delayed callbacks with
 * after(ms, fn); cancelAll() drops every pending one at once. Game-agnostic.
 *
 * Why this exists: scripted sequences (a wave-end cashout, a game-over teardown)
 * are chains of delayed steps. Built from raw setTimeout they can't be stopped,
 * so two things go wrong — every step has to re-check "am I still in this phase?"
 * before doing anything, and a sequence abandoned mid-flight (return to title,
 * restart) leaves orphan timers that fire later into an unrelated run. Owning the
 * timers here means a single cancelAll() on teardown kills the whole chain, so
 * the steps stay guard-free and no stale timer ever lands in the next run.
 */
export class Scheduler {
  constructor() {
    /** @type {Set<number>} pending timer ids */
    this._timers = new Set();
  }

  /**
   * Run fn after ms milliseconds. The id is forgotten once it fires; cancelAll is
   * the usual exit, so the return value is rarely needed.
   * @param {number} ms @param {() => void} fn @returns {number} timer id
   */
  after(ms, fn) {
    const id = /** @type {any} */ (setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, ms));
    this._timers.add(id);
    return id;
  }

  /** Cancel every pending timer. Safe any time — including on phase exit / teardown. */
  cancelAll() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  }
}
