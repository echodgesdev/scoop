// @ts-check
import { MAX_STACK, MAX_LIVE_SCOOPS, PICKUP_TYPE } from '../config.js';
import { TutorialBase } from '../tutorial.js';

/** @typedef {import('../game.js').Game} Game */
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../types.js').Bounds} Bounds */

/**
 * A GAME MODE is one self-contained strategy: its board sizing, how power-ups
 * are sourced + handled, which tray verbs the up/down gestures map to, the
 * active-slot position, and which tutorial plays. game.js owns the shared
 * machinery (catching, serving, the active-slot visual, _firePower, the combo
 * breaker, day/night, …) and just DELEGATES to `this.mode` — it never branches
 * on the mode id. Add a mode = one file in modes/ + one line in modes/index.js;
 * remove a mode = delete that file + that line. Nothing else references it.
 *
 * This base IS the Auto Trigger behavior (fire on catch, bubble lane, slingshot
 * up / rotate down, no queue). Banked and Tipping override the bits they change.
 */
export class GameMode {
  /** @param {Game} game */
  constructor(game) {
    this.game = game;
  }

  // --- identity + board config (overridden per mode) -------------------------
  get id() { return 'auto'; }
  get label() { return 'Auto Trigger'; }
  get maxStack() { return MAX_STACK; }
  get maxLive() { return MAX_LIVE_SCOOPS; }
  /** Whether the combo breaker is on by default for this mode (debug can flip). */
  get comboBreaker() { return false; }

  // --- power-up handling (Auto default: fire the instant it's caught) --------
  /** @param {PickupTypeName} type @param {number} x @param {number} y */
  onCatch(type, x, y) { this.game._firePower(type, x, y); }
  /** Spend the next banked power-up (Shift). No queue in the base. */
  onShift() {}
  /** True when there's nothing to spend (drives the Shift "nope" beep). */
  queueEmpty() { return true; }
  /** Per-frame update for mode-owned animation (e.g. the banked queue). @param {number} dt */
  step(dt) {}
  /** Screen-fixed draw for mode-owned UI (banked queue row). @param {CanvasRenderingContext2D} ctx @param {Bounds} bounds */
  drawQueueSlots(ctx, bounds) {}
  /** Wave-end cashout of any mode-owned resource; call onDone when finished. @param {() => void} onDone */
  cashout(onDone) { onDone(); }
  /** Reset on game start / mode switch. */
  reset() {}

  // --- power-up SOURCE (Auto/Banked: catch bubbles) --------------------------
  /**
   * Which bubble types the pickup field may spawn. The tutorial forces a single
   * ⚡ demo (once the first order is served) so the power-up lesson always has
   * something to catch; otherwise it's the player's unlocked set.
   * @returns {PickupTypeName[]}
   */
  bubbleTypes() {
    const g = this.game;
    if (g.tutorial.active) {
      return g.waves.servedColors.size >= 1 ? [PICKUP_TYPE.FEATHER] : [];
    }
    return g.challenges.unlockedPowerupTypes();
  }
  /** Roll a customer tip (tip-sourced modes only). @returns {PickupTypeName | 'coin' | null} */
  rollTip() { return null; }
  /** Grant a customer's tip on order completion (tip-sourced modes). @param {PickupTypeName | 'coin'} tip @param {number} x @param {number} y */
  grantTip(tip, x, y) {}

  // --- tray verbs ------------------------------------------------------------
  /** Up gesture / Space. Auto: slingshot the bottom scoop. */
  onSwipeUp() { this.game._slingshot(); }
  /** Down gesture. Auto: rotate the tray one slot. */
  onSwipeDown() { this.game._rotateStack(); }

  // --- touch + HUD -----------------------------------------------------------
  /**
   * A tap landed: chance for the mode to consume it (Banked spends from the
   * queue strip). Return true if handled; false lets the tap serve.
   * @param {number} vx @param {number} vy
   */
  onTapSpend(vx, vy) { return false; }
  /** Y of the on-canvas active-power-up slot (Banked sits higher for its queue). @param {Bounds} bounds */
  activeSlotY(bounds) { return bounds.height - 80; }

  // --- tutorial --------------------------------------------------------------
  /** The hint overlay that plays over Wave 0 for this mode. @returns {TutorialBase} */
  makeTutorial() { return new TutorialBase(); }
}
