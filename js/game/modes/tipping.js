// @ts-check
import { PICKUP_TYPE, TIP_COIN, PICKUP_TO_POWER } from '../config.js';
import { STATE } from '../shop.js';
import { TutorialBase } from '../tutorial.js';

/** @typedef {import('../../game.js').Game} Game */
/** @typedef {import('../world.js').World} World */
/** @typedef {import('../../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../../types.js').Bounds} Bounds */

// Tipping plays with a shorter cone (4) but a fuller sky (7 falling scoops).
const TIPPING_MAX_STACK = 4;
const TIPPING_MAX_LIVE = 7;
// Relative weight of the "coin" (bonus points) tip vs. the four power-up tips
// (whose weights come from the power-up mix config), and the coin payout.
const TIP_COIN_WEIGHT = 0.4;
const TIP_COIN_POINTS = 50;
// Tip PACING (so a player can't string a chain of big power-ups and blitz the
// day). MINOR tips (heart heal + coin cash) are safe anytime; MAJOR tips (the
// timed power-ups 🌈/⚡/❄️) are rationed:
//   · held back until the day is underway (waveFraction past this threshold),
//   · capped per day, and
//   · never offered while that power-up is already running OR already waiting
//     as another on-screen customer's tip — so two of the same never overlap.
const MAJOR_TIP_DAY_FRACTION = 0.3;
const MAX_MAJOR_TIPS_PER_DAY = 5;
/** The timed (major) power-up tips, paced by the rules above. Heart is minor. */
const MAJOR_TIP_TYPES = [PICKUP_TYPE.FEATHER, PICKUP_TYPE.PAUSE, PICKUP_TYPE.RAINBOW];

/**
 * Tipping tutorial: power-ups arrive as customer tips, and the top scoop is
 * tossed with the upward gesture (no rotate verb).
 */
class TippingTutorial extends TutorialBase {
  /** Buried wanted color: toss the top off (upward) rather than rotate. */
  _buriedHint(touch) {
    return touch ? 'Swipe up to toss the top scoop' : 'Space — toss the top scoop';
  }

  /** Surface the tip concept whenever a waiting customer is carrying one. @param {Game} game */
  _powerHint(game) {
    const tipped = game.world.shop.list.some(c => c.state === STATE.WAITING && c.tip);
    return tipped ? 'Finish a customer with a token — they tip you a reward!' : null;
  }
}

/**
 * Tipping — the game's one and only mode. Power-ups come from customer TIPS (and
 * the combo breaker): a tighter board, the combo breaker on, the upward gesture
 * tosses the top scoop, no rotate. World owns the shared machinery (catching,
 * serving, the active-slot sim, firePower, the combo breaker, …) and DELEGATES to
 * this object via modes/index.js.
 */
export class TippingMode {
  /** @param {World} world */
  constructor(world) {
    this.world = world;
    // Per-day major-power-up budget. `_tipDay` is the day the count belongs to;
    // it resets the count when the day rolls over (detected in rollTip).
    this._tipDay = -1;
    this._majorTipsToday = 0;
  }

  get id() { return 'tipping'; }
  get label() { return 'Tipping'; }
  get maxStack() { return TIPPING_MAX_STACK; }
  get maxLive() { return TIPPING_MAX_LIVE; }
  /** The combo breaker is part of Tipping's identity. */
  get comboBreaker() { return true; }

  /**
   * Is a MAJOR power-up "busy" right now — so we shouldn't offer it again? True
   * if it's the running timed power-up, or already waiting as another on-screen
   * customer's tip. Keeps the same big power-up from overlapping itself.
   * @param {World} g @param {PickupTypeName} type
   */
  _majorBusy(g, type) {
    if (g.activeBubble && g.activeBubble.type === type) return true;
    const power = PICKUP_TO_POWER[type];
    if (power && g.powerups.active(power)) return true;
    return g.shop.list.some(c => c.tip === type);
  }

  /**
   * Roll a tip for a freshly-spawned customer. Frequency comes from the tip-gap
   * config (shorter gap → more tips). The MIX is paced: minor tips (heart + coin)
   * are always eligible, while the major timed power-ups are held back early in
   * the day, capped per day, and de-duplicated against what's already in play.
   * @returns {PickupTypeName | 'coin' | null}
   */
  rollTip() {
    const g = this.world;
    // New day → refill the major-power-up budget.
    if (g.waves.wave !== this._tipDay) {
      this._tipDay = g.waves.wave;
      this._majorTipsToday = 0;
    }

    const avgGap = (g.tipGapMin + g.tipGapMax) / 2;
    // Tips are the only power-up source, so keep them common — a healthy share
    // of customers carry one (clamped so it never feels constant).
    const chance = Math.max(0.3, Math.min(0.9, 5 / Math.max(0.5, avgGap)));
    if (Math.random() > chance) return null;

    const w = g.powerupWeights;
    /** @type {Record<string, number>} weight by power-up type (PICKUP order: heart, ⚡, ❄️, 🌈) */
    const weightByType = {
      [PICKUP_TYPE.HEART]: w[0] || 0,
      [PICKUP_TYPE.FEATHER]: w[1] || 0,
      [PICKUP_TYPE.PAUSE]: w[2] || 0,
      [PICKUP_TYPE.RAINBOW]: w[3] || 0
    };
    const unlocked = g.challenges.unlockedPowerupTypes();

    // MINOR pool (always eligible once unlocked): the heart heal + the coin cash
    // tip. During the Day-0 tutorial nothing here is unlocked yet, so no tip.
    /** @type {(PickupTypeName | typeof TIP_COIN)[]} */
    const types = [];
    /** @type {number[]} */
    const weights = [];
    if (unlocked.includes(PICKUP_TYPE.HEART)) { types.push(PICKUP_TYPE.HEART); weights.push(weightByType[PICKUP_TYPE.HEART]); }
    if (g.challenges.isCoinUnlocked()) { types.push(TIP_COIN); weights.push(TIP_COIN_WEIGHT); }

    // MAJOR pool (the timed power-ups): only once the day is underway, only while
    // under the per-day budget, and only types that aren't already running or
    // already pending on another customer.
    const dayUnderway = g.waves.waveFraction >= MAJOR_TIP_DAY_FRACTION;
    if (dayUnderway && this._majorTipsToday < MAX_MAJOR_TIPS_PER_DAY) {
      for (const t of MAJOR_TIP_TYPES) {
        if (!unlocked.includes(t)) continue;
        if (this._majorBusy(g, t)) continue;
        types.push(t); weights.push(weightByType[t] || 0);
      }
    }
    if (types.length === 0) return null;   // nothing eligible right now → no tip

    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    let pick = types[types.length - 1];
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) { pick = types[i]; break; }
    }
    // Charge a major against the day budget so the big ones stay rationed.
    if (pick !== TIP_COIN && pick !== PICKUP_TYPE.HEART) this._majorTipsToday += 1;
    return pick;
  }

  /**
   * Grant a customer's tip on order completion: coin = bonus points; a power-up
   * tip auto-fires (the shared engine runs the timed effect / heal).
   * @param {PickupTypeName | 'coin'} tip @param {number} x @param {number} y
   */
  grantTip(tip, x, y) {
    const g = this.world;
    if (tip === TIP_COIN) {
      g.shop.addScore(TIP_COIN_POINTS);
      g.bus.emit('coin', { x, y, points: TIP_COIN_POINTS });
    } else {
      g.firePower(tip, g.player.x, g.player.stackTopY());
    }
  }

  /** Up gesture / Space: toss the top scoop (Tipping has no rotate verb). */
  onSwipeUp() { this.world.discardTop(); }

  /**
   * Resting Y of the on-canvas active-power-up slot — ~15% up from the bottom.
   * The bubble's entrance arcs up and pauses ~10% higher before settling here.
   * @param {Bounds} bounds
   */
  activeSlotY(bounds) { return bounds.height * 0.85; }

  /** Reset the per-day tip budget for a fresh run. */
  reset() {
    this._tipDay = -1;
    this._majorTipsToday = 0;
  }

  makeTutorial() { return new TippingTutorial(); }
}
