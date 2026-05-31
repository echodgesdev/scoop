// @ts-check
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./types.js').Bounds} Bounds */

/**
 * Strategy seam for how caught power-ups are handled. The Game owns the shared
 * pieces — _firePower (apply the effect) and the active-slot visual (the running
 * timed power-up + its countdown ring) — and delegates the mode-specific bits
 * (does a catch fire now or bank for later? is there a queue to draw / cash
 * out?) to whichever PowerupMode is active for this.gameMode.
 *
 * The base class is the "do nothing extra" default; AutoPowerupMode and
 * BankedPowerupMode override what they need. Methods are deliberately small so
 * game.js only ever delegates, never branches on the mode.
 */
export class PowerupMode {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
  }

  /**
   * A bubble was caught (catch hitbox or slingshot). Decide whether to fire it
   * now or bank it.
   * @param {PickupTypeName} type @param {number} x @param {number} y
   */
  onCatch(type, x, y) {}

  /**
   * A loot box was bought (between-wave store). Same fire-vs-bank choice.
   * @param {PickupTypeName} type @param {number} x @param {number} y
   */
  onLootboxSpend(type, x, y) {}

  /** Spend the next banked power-up (Shift). No-op when there's no queue. */
  onShift() {}

  /** Per-frame update for any mode-owned state/animation. @param {number} dt */
  step(dt) {}

  /**
   * Screen-fixed draw for mode-owned UI (e.g. the banked queue row). Called
   * after the world transform is popped.
   * @param {CanvasRenderingContext2D} ctx @param {Bounds} bounds
   */
  drawQueueSlots(ctx, bounds) {}

  /**
   * Wave-end cashout of any mode-owned resource (e.g. the banked queue). Call
   * `onDone` when finished so the game can open the wave-transition overlay.
   * Default: nothing to drain.
   * @param {() => void} onDone
   */
  cashout(onDone) { onDone(); }

  /** True when there's nothing to spend (drives the Shift "nope" beep). */
  queueEmpty() { return true; }

  /** Reset on game start / mode switch. */
  reset() {}
}
