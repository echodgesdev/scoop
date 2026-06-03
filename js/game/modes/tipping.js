// @ts-check
import { PICKUP_TYPE } from '../config.js';
import { STATE } from '../shop.js';
import { TutorialBase } from '../tutorial.js';

/** @typedef {import('../../game.js').Game} Game */
/** @typedef {import('../../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../../types.js').Bounds} Bounds */

// Tipping plays with a shorter cone (4) but a fuller sky (7 falling scoops).
const TIPPING_MAX_STACK = 4;
const TIPPING_MAX_LIVE = 7;
// Relative weight of the "coin" (bonus points) tip vs. the four power-up tips
// (whose weights come from the power-up mix config), and the coin payout.
const TIP_COIN_WEIGHT = 0.4;
const TIP_COIN_POINTS = 50;

/**
 * Tipping tutorial: no bubbles — power-ups arrive as customer tips, and the top
 * scoop is tossed with the upward gesture (no rotate verb).
 */
class TippingTutorial extends TutorialBase {
  /** Buried wanted color: toss the top off (upward) rather than rotate. */
  _buriedHint(touch) {
    return touch ? 'Swipe up to toss the top scoop' : 'Space — toss the top scoop';
  }

  /** Surface the tip concept whenever a waiting customer is carrying one. @param {Game} game */
  _powerHint(game) {
    const tipped = game.shop.list.some(c => c.state === STATE.WAITING && c.tip);
    return tipped ? 'Finish a customer with a token — they tip you a reward!' : null;
  }
}

/**
 * Tipping — the game's one and only mode. Power-ups come from customer TIPS (and
 * the combo breaker), not a bubble lane: a tighter board, the combo breaker on,
 * the upward gesture tosses the top scoop, no rotate. game.js owns the shared
 * machinery (catching, serving, the active-slot visual, _firePower, the combo
 * breaker, day/night, …) and DELEGATES to this object via modes/index.js.
 */
export class TippingMode {
  /** @param {Game} game */
  constructor(game) {
    this.game = game;
  }

  get id() { return 'tipping'; }
  get label() { return 'Tipping'; }
  get maxStack() { return TIPPING_MAX_STACK; }
  get maxLive() { return TIPPING_MAX_LIVE; }
  /** The combo breaker is part of Tipping's identity. */
  get comboBreaker() { return true; }

  /**
   * Roll a tip for a freshly-spawned customer. Frequency comes from the tip-gap
   * config (shorter gap → more tips), the mix from the power-up weights (+ a
   * fixed coin share). @returns {PickupTypeName | 'coin' | null}
   */
  rollTip() {
    const g = this.game;
    const avgGap = (g.tipGapMin + g.tipGapMax) / 2;
    // Tips are the only power-up source, so keep them common — a healthy share
    // of customers carry one (clamped so it never feels constant).
    const chance = Math.max(0.3, Math.min(0.9, 5 / Math.max(0.5, avgGap)));
    if (Math.random() > chance) return null;
    const w = g.powerupWeights;
    /** @type {(PickupTypeName | 'coin')[]} */
    const types = [PICKUP_TYPE.HEART, PICKUP_TYPE.FEATHER, PICKUP_TYPE.PAUSE, PICKUP_TYPE.RAINBOW, 'coin'];
    const weights = [w[0] || 0, w[1] || 0, w[2] || 0, w[3] || 0, TIP_COIN_WEIGHT];
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) return types[i];
    }
    return 'coin';
  }

  /**
   * Grant a customer's tip on order completion: coin = bonus points; a power-up
   * tip auto-fires (the shared engine runs the timed effect / heal).
   * @param {PickupTypeName | 'coin'} tip @param {number} x @param {number} y
   */
  grantTip(tip, x, y) {
    const g = this.game;
    if (tip === 'coin') {
      g.shop.addScore(TIP_COIN_POINTS);
      g.hud.setScore(g.shop.score);
      g.effects.burst(x, y, ['#ffd700', '#fff7c0', '#fff'], 18);
      g.effects.popText(x, y - 28, `+${TIP_COIN_POINTS}`, { color: '#ffd700', size: 24 });
      g.sound.bubblePop();
    } else {
      g._firePower(tip, g.player.x, g.player.stackTopY());
    }
  }

  /** Up gesture / Space: toss the top scoop (Tipping has no rotate verb). */
  onSwipeUp() { this.game._discardTop(); }

  /**
   * Resting Y of the on-canvas active-power-up slot — ~15% up from the bottom.
   * The bubble's entrance arcs up and pauses ~10% higher before settling here.
   * @param {Bounds} bounds
   */
  activeSlotY(bounds) { return bounds.height * 0.85; }

  /** Nothing mode-owned to reset between runs. */
  reset() {}

  makeTutorial() { return new TippingTutorial(); }
}
