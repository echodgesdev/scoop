// @ts-check
// Regulars progression store — the unlock + served state for the customer
// "regulars" (the static catalog lives in customers.js). Persists across
// sessions in localStorage, mirroring the Recipes / Challenges stores; one
// canonical instance owned by World.
//
// Unlock trigger (epic phase 2): a regular unlocks the first time you complete
// an order for them. The wave-end flip-reveal animation (epic phase 4) is not
// built yet — `drainPendingReveals()` exposes the just-unlocked names so it can
// hook in later without changing this store.
import { CHARACTERS } from './customers.js';

const STORAGE_KEY = 'scoop.regulars';

/**
 * @typedef {object} RegularEntry
 * @property {string} name
 * @property {import('../types.js').ScoopColor} favoriteFlavor
 * @property {string} blurb
 * @property {number} served    lifetime completed orders
 * @property {boolean} unlocked
 */

export class Regulars {
  constructor() {
    this.state = this._load();
    // Names unlocked since the last drain — for the future wave-end reveal.
    /** @type {string[]} */
    this.pendingReveals = [];
  }

  _load() {
    const defaults = { /** @type {Record<string,boolean>} */ unlocked: {}, /** @type {Record<string,number>} */ served: {} };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            unlocked: { ...(parsed.unlocked || {}) },
            served: { ...(parsed.served || {}) }
          };
        }
      }
    } catch {}
    return defaults;
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch {}
  }

  /** Wipe all unlock + served progress back to a fresh save. */
  reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.state = this._load();
    this.pendingReveals = [];
  }

  /** @param {string} name */
  isUnlocked(name) { return this.state.unlocked[name] === true; }
  /** @param {string} name */
  servedCount(name) { return this.state.served[name] || 0; }
  /** How many regulars are unlocked (for the "N / total" header). */
  unlockedCount() { return CHARACTERS.reduce((n, c) => n + (this.isUnlocked(c.name) ? 1 : 0), 0); }
  /** Total regulars in the catalog. */
  get total() { return CHARACTERS.length; }

  /**
   * Record a completed order for a regular: bump their served count and, on the
   * first serve, unlock them (queuing the name for the future reveal).
   * @param {string|null|undefined} name
   * @returns {{ count: number, wasNewUnlock: boolean }}
   */
  recordServed(name) {
    if (!name) return { count: 0, wasNewUnlock: false };
    const count = (this.state.served[name] || 0) + 1;
    this.state.served[name] = count;
    const wasNewUnlock = this.state.unlocked[name] !== true;
    if (wasNewUnlock) {
      this.state.unlocked[name] = true;
      this.pendingReveals.push(name);
    }
    this._save();
    return { count, wasNewUnlock };
  }

  /** Take and clear the names unlocked since the last call (future flip reveal). */
  drainPendingReveals() {
    const out = this.pendingReveals;
    this.pendingReveals = [];
    return out;
  }

  /**
   * The roster decorated with live unlock + served state, in catalog order.
   * Drives the Regulars collection screen.
   * @returns {RegularEntry[]}
   */
  getAll() {
    return CHARACTERS.map(c => ({
      name: c.name,
      favoriteFlavor: c.favoriteFlavor,
      blurb: c.blurb,
      served: this.servedCount(c.name),
      unlocked: this.isUnlocked(c.name)
    }));
  }
}
