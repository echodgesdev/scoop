// @ts-check
import { GameMode } from './game-mode.js';
import { TutorialBase } from '../tutorial.js';
import { PICKUP_TYPE } from '../config.js';
import { STATE } from '../shop.js';

/** @typedef {import('../game.js').Game} Game */
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */

// Tipping plays with a shorter cone (4) but a fuller sky (7 falling scoops).
const TIPPING_MAX_STACK = 4;
const TIPPING_MAX_LIVE = 7;
// Relative weight of the "coin" (bonus points) tip vs. the four power-up tips
// (whose weights come from the bubble-mix debug control), and the coin payout.
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
 * Tipping: no bubble lane at all — power-ups come from customer TIPS (and the
 * combo breaker). A tighter board, the combo breaker on by default, the upward
 * gesture tosses the top scoop, and the down gesture is unused (no rotate).
 * Power-up handling is the inherited fire-on-catch default; it only ever runs
 * via tips/breaker/loot box calling the shared Game._firePower.
 */
export class TippingMode extends GameMode {
  get id() { return 'tipping'; }
  get label() { return 'Tipping (no bubbles)'; }
  get maxStack() { return TIPPING_MAX_STACK; }
  get maxLive() { return TIPPING_MAX_LIVE; }
  get comboBreaker() { return true; }

  // No bubble lane — power-ups arrive as tips.
  bubbleTypes() { return []; }

  /**
   * Roll a tip for a freshly-spawned customer. Frequency comes from the bubble
   * spawn-gap debug control (shorter gap → more tips), the mix from the bubble
   * weights (+ a fixed coin share). @returns {PickupTypeName | 'coin' | null}
   */
  rollTip() {
    const g = this.game;
    const avgGap = (g.pickups.spawnMin + g.pickups.spawnMax) / 2;
    const chance = Math.max(0.1, Math.min(0.9, 4 / Math.max(0.5, avgGap)));
    if (Math.random() > chance) return null;
    const w = g.pickups.weights;
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
   * tip auto-fires (same as a caught bubble in Auto).
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

  // Upward gesture tosses the top scoop; the down gesture does nothing.
  onSwipeUp() { this.game._discardTop(); }
  onSwipeDown() {}

  makeTutorial() { return new TippingTutorial(); }
}
