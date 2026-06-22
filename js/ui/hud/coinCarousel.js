// @ts-check
// An auto-cycling coin-reveal carousel: the run's unlock coins laid in a row, the
// current one centred + large and its neighbours shrunk / translucent, each flipping
// in turn — cycle · pause · cycle · pause. A tap skips straight to the end (all
// revealed). Shared by the between-day night sky and the game-over recap; the caller
// supplies a container element and an onComplete to advance the scene. Pure DOM over
// the shared unlock-flip coin (unlockCardHtml).
import { unlockCardHtml } from './templates/roundOverTemplate.js';

const FULL_DWELL_MS = 1500;   // per-coin time at/below the ceiling (flip + a beat to read)
const MIN_DWELL_MS = 500;     // floor so the reveal stays legible no matter how many coins
const SPACING = 150;          // px between adjacent coin centres

// Coins reveal at full speed up to this many; beyond it they share a fixed time budget
// so EVERY coin is still shown but the carousel hits a soft ceiling instead of growing
// without bound.
export const COIN_DWELL_CEILING = 3;

/**
 * Per-coin dwell (ms): FULL_DWELL_MS up to COIN_DWELL_CEILING coins, then shortened
 * (total budget held near the ceiling) and floored at MIN_DWELL_MS. game.js uses this
 * to size the night sweep so it matches the carousel exactly.
 * @param {number} count
 */
export function coinDwellMs(count) {
  if (count <= COIN_DWELL_CEILING) return FULL_DWELL_MS;
  return Math.max(MIN_DWELL_MS, (FULL_DWELL_MS * COIN_DWELL_CEILING) / count);
}

export class CoinCarousel {
  /** @param {{ el: HTMLElement | null, sound?: { perfect: () => void } | null }} opts */
  constructor({ el, sound = null }) {
    this.el = el;
    this.sound = sound;
    /** @type {number[]} */
    this._timers = [];
    this._index = 0;
    this._count = 0;
    this._rest = false;
    this._dwell = FULL_DWELL_MS;   // per-coin ms, recomputed per start() from the count
    /** @type {() => void} */
    this._onComplete = () => {};
  }

  /**
   * Render `coins` into the container and start auto-cycling. `onComplete` fires once
   * the last coin has flipped (or a skip lands), so the caller can move on.
   * @param {any[]} coins @param {() => void} [onComplete]
   */
  start(coins, onComplete = () => {}) {
    this.clear();
    if (!this.el) { onComplete(); return; }
    this._count = coins.length;
    this._onComplete = onComplete;
    this._dwell = coinDwellMs(this._count);
    // Flip duration tracks the dwell so each coin finishes turning before it advances
    // (CSS reads --coin-flip-ms; it cascades to the .wt-reveal-inner inside).
    this.el.style.setProperty('--coin-flip-ms', `${Math.min(700, Math.round(this._dwell * 0.7))}ms`);
    this.el.innerHTML = coins.map(c => `<div class="ro-coin">${unlockCardHtml(/** @type {any} */ (c))}</div>`).join('');
    this._layout();
    this._cycle();
  }

  /** True while coins are still flipping — so a tap should skip rather than advance. */
  get cycling() { return this._count > 0 && !this._rest; }

  /** Skip the animation: reveal every coin and centre the last one at once. */
  skip() {
    if (this._rest || !this.el) return;
    this._clearTimers();
    this._cards().forEach(c => c.classList.add('snap', 'revealed'));
    this._index = Math.max(0, this._count - 1);
    this._layout();
    this._rest = true;
    this._onComplete();
  }

  /** @returns {HTMLElement[]} */
  _cards() { return this.el ? /** @type {HTMLElement[]} */ (Array.from(this.el.querySelectorAll('.ro-coin'))) : []; }

  /** Position every coin by its offset from the current one: centre large, others shrink + fade. */
  _layout() {
    this._cards().forEach((c, i) => {
      const off = i - this._index;
      const abs = Math.abs(off);
      const scale = off === 0 ? 1 : Math.max(0.42, 0.7 - (abs - 1) * 0.12);
      const opacity = off === 0 ? 1 : Math.max(0, 0.5 - (abs - 1) * 0.22);
      c.style.transform = `translateX(${off * SPACING}px) scale(${scale})`;
      c.style.opacity = String(opacity);
      c.style.zIndex = String(50 - abs);
      c.classList.toggle('current', off === 0);
    });
  }

  /** Flip the current coin, hold a beat, then advance — or rest + fire onComplete after the last. */
  _cycle() {
    const cur = this._cards()[this._index];
    if (cur) {
      cur.classList.remove('snap');
      void cur.offsetWidth;      // reflow so the flip transition plays
      cur.classList.add('revealed');
      if (this.sound) this.sound.perfect();
    }
    this._timers.push(/** @type {any} */ (setTimeout(() => {
      if (this._index < this._count - 1) {
        this._index += 1;
        this._layout();
        this._cycle();
      } else {
        this._rest = true;
        this._onComplete();
      }
    }, this._dwell)));
  }

  _clearTimers() { this._timers.forEach(t => clearTimeout(t)); this._timers = []; }

  /** Stop all timers + reset state (leaves the rendered DOM for the caller to clear/replace). */
  clear() { this._clearTimers(); this._index = 0; this._count = 0; this._rest = false; }
}
