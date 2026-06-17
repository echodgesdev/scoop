// @ts-check
import { PICKUP_TYPE, TIP_COIN, PICKUP_TO_POWER, CUSTOMER_FACE_OFFSET_PX } from '../config.js';
import { STATE } from '../shop.js';
import { TutorialBase } from '../tutorial.js';
import { drawScoop } from '../../view/playerView.js';

/** @typedef {import('../../game.js').Game} Game */
/** @typedef {import('../world.js').World} World */
/** @typedef {import('../../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../../types.js').Bounds} Bounds */
/** @typedef {import('../../types.js').Customer} Customer */
/** @typedef {import('../../types.js').ScoopColor} ScoopColor */

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

// Scripted tutorial day — flavors used per beat (all junior singles, ≥3 distinct
// so Set 1's "discover 3" clears), the throwaway top scoop for the swipe lesson,
// the staging slots, and the beat durations.
const T_C1 = 'vanilla', T_C2 = 'pink', T_C3 = 'mint', T_C4 = 'choco', T_C5 = 'blueberry', T_C6 = 'pink';
const T_TOP = 'mint';            // the scoop tossed in the swipe lesson (≠ T_C5)
const FIRST_SLOT = 0;            // #1 is far from center so step 1 teaches movement
const GUIDE_SLOT = 2;            // every other guided customer waits center
const GUIDE_VALUE = 50;          // a junior-single's points (so the "+50" pill is honest)
const FACE_BUBBLE_GAP = 125;     // px from a customer's FACE CENTER to a bubble hugging it (head ≈168 tall)
const POINTS_BEAT = 1.2;         // how long the "+50" pill lingers
const TIP_BEAT = 2.8;            // read beat for the tip explanation
const DRAIN_S = 1.4;             // how fast the demo customer's patience drains
// First-scoop "plop": a tutorial-owned ghost scoop eases down from PLOP_RISE px
// above the landing slot over PLOP_FALL_S, then commits to the tray (land-squash).
// Restored from the original tutorial (git 8962db3) — accelerating drop feels best.
const PLOP_FALL_S = 0.5;
const PLOP_RISE = 150;
const PLOP_GAP_S = 0.18;         // beat between consecutive plops in a queue
const ORDER_BEAT = 0.5;          // beat after the first customer's order bubble pops, before the scoop plops in
const easeIn = (/** @type {number} */ t) => t * t;

/**
 * Tipping tutorial — a fully SCRIPTED, heavily-telegraphed onboarding day. It
 * drives World directly (freeze cone, stage customers via `shop.spawnScripted`,
 * stop/inject sky scoops, run a patience→anger→death DEMO) and shows one beat at
 * a time. Combos + perfect catches are disabled for the whole day (see World), so
 * it can't be used to cheese a score. `start()` is the only entry; `update()` is a
 * step machine; `draw()` renders the current beat's speech bubbles. The cone's
 * `frozen` flag doubles as a full PAUSE (game._deliver/_pop also bail on frozen),
 * which is how the guided beats stop the player from acting ahead of the prompt.
 */
class TippingTutorial extends TutorialBase {
  constructor() {
    super();
    this.step = 0;
    this.t = 0;             // seconds in the current step
    this._phase = 0;        // sub-phase within a step
    this._sub = 0;          // which of step 7's two customers
    /** @type {Customer | null} the customer the current beat is about */
    this._c = null;
    /** @type {string | null} captured name so the death-demo customer resurrects as themself */
    this._cName = null;
    /** @type {import('../../types.js').Scoop | null} the scripted falling scoop */
    this._scoop = null;
    /** @type {{ color: ScoopColor, t: number } | null} the plop ghost currently falling (drawn, not a field scoop) */
    this._ghost = null;
    /** @type {ScoopColor[]} colors still queued to plop onto the cone (bottom→top) */
    this._plopQueue = [];
    this._plopGap = 0;      // beat before the next queued ghost starts falling
    /** @type {Array<{ x: number, y: number, text: string, point?: ('up'|'down'|null), accent?: string }>} */
    this.bubbles = [];
    /** @type {string | null} text for the #dayHint gauge callout (game._syncDayHint reads it) */
    this.dayHintText = null;
  }

  /** @param {Game} game */
  start(game) {
    this.active = true;
    this._setStep(1, game);
  }

  /** @param {number} n @param {Game} game */
  _setStep(n, game) {
    this.step = n;
    this.t = 0;
    this._phase = 0;
    this.bubbles = [];
    this._enter(game);
  }

  /** @param {number} dt @param {Game} game */
  update(dt, game) {
    if (!this.active) return;
    // The scripted day ends when step 10's regular customers fill the day meter
    // (wave advances). Release any control we still hold and finish.
    if (game.world.waves.wave !== 0) { this._cleanup(game); this._finish(); return; }
    this.t += dt;
    this._tick(dt, game);
  }

  /** Hand every borrowed control back to normal play. @param {Game} game */
  _cleanup(game) {
    const w = game.world;
    w.shop.scripted = false;
    w.freezePatience = false;
    w.player.frozen = false;
    w.field.setSpawnPaused(false);
    this._ghost = null;
    this._plopQueue = [];
    this.dayHintText = null;
    this.bubbles = [];
  }

  /** @param {Customer | null} c */
  _served(c) { return !!c && c.state === STATE.LEAVING && c.mood === 'happy'; }
  /** @param {Customer | null} c */
  _waiting(c) { return !!c && c.state === STATE.WAITING; }

  /** A hint pinned just above the cone's top scoop — snapped to it, pointing down. @param {Game} game @param {string} text @param {string} [accent] */
  _scoopBubble(game, text, accent) {
    const pl = game.world.player;
    return { x: pl.x, y: pl.stackTopY() - 44, text, point: /** @type {'down'} */ ('down'), accent };
  }
  /** A bubble hugging a customer's FACE — above (point down) or below (point up).
   *  Anchored to the real face center (groundY + CUSTOMER_FACE_OFFSET_PX + yOff), so
   *  "below" lands under the chin pointing up at them — i.e. what you tap.
   *  @param {Game} game @param {Customer} c @param {string} text @param {boolean} above @param {string} [accent] */
  _customerBubble(game, c, text, above, accent) {
    const faceY = game.world._groundY() + CUSTOMER_FACE_OFFSET_PX + (c.yOff || 0);
    return above
      ? { x: c.x, y: faceY - FACE_BUBBLE_GAP, text, point: /** @type {'down'} */ ('down'), accent }
      : { x: c.x, y: faceY + FACE_BUBBLE_GAP, text, point: /** @type {'up'} */ ('up'), accent };
  }
  /** Keep one scripted scoop of `color` falling until caught (at `dropX`, default center). @param {Game} game @param {ScoopColor} color @param {number} [dropX] */
  _ensureScoop(game, color, dropX) {
    const w = game.world;
    if (w.player.colors().includes(color)) return;          // already caught it
    if (this._scoop && w.field.scoops.includes(this._scoop)) return;  // still falling
    this._scoop = w.field.spawnScripted(dropX != null ? dropX : game.bounds.width / 2, /** @type {any} */ (color));
  }

  /** Begin plopping `colors` (bottom→top) onto the cone via the ghost animation. @param {ScoopColor[]} colors */
  _startPlops(colors) {
    this._plopQueue = colors.slice();
    this._ghost = null;
    this._plopGap = 0;
  }
  /**
   * Advance the plop QUEUE: ease the current ghost down and, on landing, commit it
   * to the tray (land-squash + burst + sound), then start the next after a beat.
   * Returns true once the whole queue has landed. The falling ghost is drawn by draw().
   * @param {number} dt @param {Game} game
   */
  _advancePlops(dt, game) {
    const pl = game.world.player;
    if (this._ghost) {
      this._ghost.t += dt / PLOP_FALL_S;
      if (this._ghost.t >= 1) {
        pl.push(/** @type {any} */ (this._ghost.color));
        game.effects.burst(pl.x, pl.stackTopY(), [game.world.shop.hex(/** @type {any} */ (this._ghost.color)), '#fff'], 8);
        game.sound.catch_();
        this._ghost = null;
        this._plopGap = PLOP_GAP_S;
      }
      return false;
    }
    if (this._plopQueue.length === 0) return true;
    this._plopGap -= dt;
    if (this._plopGap <= 0) this._ghost = { color: /** @type {ScoopColor} */ (this._plopQueue.shift()), t: 0 };
    return false;
  }

  // ---- per-step entry side effects --------------------------------------
  /** @param {Game} game */
  _enter(game) {
    const w = game.world, sh = w.shop, fld = w.field, pl = w.player;
    switch (this.step) {
      case 1:
        sh.scripted = true; w.freezePatience = true;
        fld.setSpawnPaused(true); fld.scoops.length = 0;   // no sky scoops until step 4
        this._c = sh.spawnScripted(FIRST_SLOT, [T_C1], { value: GUIDE_VALUE });
        pl.frozen = true; pl.clearStack();
        // Sequence runs in _tick: customer slides in → order bubble pops → a beat →
        // the first scoop plops onto the cone → "move" tooltip. The plop is deferred
        // so it lands AFTER the order bubble shows.
        break;
      case 4:
        this._c = sh.spawnScripted(GUIDE_SLOT, [T_C2], { value: GUIDE_VALUE });
        this._scoop = null;
        break;
      case 5:
        // Carry the scoop they just caught over to the customer — no teleport, no
        // re-plop (both felt busted). cName lets step 6 resurrect them.
        this._cName = this._c ? this._c.character : null;
        break;
      case 6:
        // No health regen — the damage stands. Resurrect the same customer, plop a
        // fresh scoop, and let patience run for REAL so they deliver it this time.
        this._c = sh.spawnScripted(GUIDE_SLOT, [T_C2], { value: GUIDE_VALUE, character: this._cName });
        pl.frozen = true; pl.clearStack();
        this._startPlops([/** @type {any} */ (T_C2)]);
        w.freezePatience = false;
        break;
      case 7:
        w.freezePatience = true;                           // guided again — pause patience
        this.dayHintText = '☀️ Complete orders until the day is done!';
        this._sub = 0; this._scoop = null;
        this._c = sh.spawnScripted(GUIDE_SLOT, [T_C3], { value: GUIDE_VALUE });
        break;
      case 8:
        // Two scoops plop onto the (frozen) cone — bottom wanted (T_C5), junk on
        // top (T_TOP) — for the swipe-to-toss lesson.
        pl.frozen = true; pl.clearStack();
        this._startPlops([/** @type {any} */ (T_C5), /** @type {any} */ (T_TOP)]);
        this._c = sh.spawnScripted(GUIDE_SLOT, [T_C5], { value: GUIDE_VALUE });
        break;
      case 9:
        pl.frozen = true;                                  // PAUSE to read the tip note
        this._scoop = null;
        this._c = sh.spawnScripted(GUIDE_SLOT, [T_C6], { value: GUIDE_VALUE, tip: TIP_COIN });
        break;
      case 10:
        // Hand off to real play: sky + auto-spawn resume, patience runs for real.
        sh.scripted = false;
        fld.setSpawnPaused(false);
        w.freezePatience = false;
        pl.frozen = false;
        this.dayHintText = '☀️ Finish the day!';
        this._c = null; this._scoop = null;
        break;
    }
  }

  // ---- per-frame tick ----------------------------------------------------
  /** @param {number} dt @param {Game} game */
  _tick(dt, game) {
    const w = game.world, sh = w.shop, pl = w.player;
    switch (this.step) {
      case 1: {
        const c = this._c;
        // Phase 0: let the customer slide in and their order bubble pop (WAITING),
        // hold a beat, THEN drop the scoop in — so the beats read in sequence.
        if (this._phase === 0) {
          if (c && c.state === STATE.WAITING && c.waitT >= ORDER_BEAT) {
            this._startPlops([/** @type {any} */ (T_C1)]);
            this._phase = 1;
          }
        }
        // Phase 1: the scoop eases down and plops onto the frozen cone.
        if (this._phase === 1) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 2; }
        }
        // Phase 2: hand movement over with the "move" tooltip.
        if (this._phase === 2) {
          this.bubbles = [this._scoopBubble(game, '◀  Move left and right  ▶')];
          if (sh.customerAt(pl.x) >= 0) this._setStep(2, game);
        }
        break;
      }

      case 2:
        // Re-plop ONLY if they tossed it while the customer is still owed — never
        // after a successful delivery (that left a scoop stuck on the cone).
        if (pl.stack.length === 0 && this._waiting(this._c)) pl.push(/** @type {any} */ (T_C1));
        if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver', false)];
        if (this._served(this._c)) this._setStep(3, game);
        break;

      case 3:
        if (this._c) this.bubbles = [this._customerBubble(game, this._c, '+50 points!', true, '#ffd166')];
        if (this.t >= POINTS_BEAT) this._setStep(4, game);
        break;

      case 4:
        // Scoop falls off to the LEFT — away from the centered customer — so the
        // player catches it there and then carries it over in step 5.
        this._ensureScoop(game, T_C2, game.bounds.width * 0.22);
        if (this._scoop && this._scoop.y > game.bounds.height * 0.5) {
          // Short text so the pill fits at the off-center drop x (no edge clip).
          this.bubbles = [{ x: this._scoop.x, y: this._scoop.y - 56, text: 'Catch it!', point: 'down' }];
        }
        if (pl.colors().includes(T_C2)) this._setStep(5, game);
        break;

      case 5: {
        const c = this._c;
        if (!c) { this._setStep(6, game); break; }
        if (this._served(c)) { this._setStep(7, game); break; }   // delivered in time → no demo
        if (this._phase === 0) {
          // Carry the caught scoop over; the (paused) demo begins on reaching them.
          if (pl.stack.length === 0) pl.push(/** @type {any} */ (T_C2));   // tossed → give it back
          else if (sh.customerAt(pl.x) >= 0) { pl.frozen = true; this._phase = 1; }
        } else if (this._phase === 1) {
          // Telegraphed FAIL: warn, drain their patience to zero, then take damage.
          this.bubbles = [this._customerBubble(game, c, 'Deliver before their patience runs out!', false, '#ff6fa3')];
          if (this._waiting(c)) {
            c.order.timeLeft -= (c.order.duration / DRAIN_S) * dt;     // drain for show
            if (c.order.timeLeft <= 0) {
              c.order.timeLeft = 0;
              c.state = STATE.LEAVING; c.mood = 'angry';
              w.onExpire(1);                                            // health drop + shake + sound + bar flash
              this._phase = 2;
            }
          }
        } else if (this._phase === 2) {
          // Damage tooltip while the angry customer slides off, then recover.
          this.bubbles = [this._customerBubble(game, c, 'Too slow — you lost health!', true, '#ff6fa3')];
          if (!sh.list.includes(c)) this._setStep(6, game);
        }
        break;
      }

      case 6:
        // Recovery: deliver for real, no tooltips. Patience runs normally; if they
        // toss it or the customer expires again, re-stage and keep going.
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (this._served(this._c)) {
          this._setStep(7, game);
        } else if (pl.stack.length === 0) {
          // Tossed it → re-plop the scoop back onto the cone.
          pl.frozen = true; this._startPlops([/** @type {any} */ (T_C2)]); this._phase = 0;
        } else if (!sh.list.includes(this._c)) {
          // Their patience ran out → resurrect + re-plop until it's delivered.
          this._c = sh.spawnScripted(GUIDE_SLOT, [T_C2], { value: GUIDE_VALUE, character: this._cName });
          pl.frozen = true; pl.clearStack(); this._startPlops([/** @type {any} */ (T_C2)]); this._phase = 0;
        }
        break;

      case 7: {
        const color = this._sub === 0 ? T_C3 : T_C4;
        this._ensureScoop(game, color);
        if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Catch & serve!', false)];
        if (this._served(this._c)) {
          if (this._sub === 0) {
            this._sub = 1; this._scoop = null;
            this._c = sh.spawnScripted(GUIDE_SLOT, [T_C4], { value: GUIDE_VALUE });
          } else {
            this._setStep(8, game);
          }
        }
        break;
      }

      case 8:
        if (this._phase === 0) {
          // Plop the two scoops in; unfreeze for the swipe lesson once they land.
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (pl.stack.length === 0 && !this._served(this._c)) {
          // Over-tossed the cone empty BEFORE serving → soft-lock recovery: re-stage
          // both scoops and replay the swipe beat. (A successful serve also empties
          // the cone, but _served guards that so we still advance to step 9 below.)
          pl.frozen = true; this.bubbles = [];
          this._startPlops([/** @type {any} */ (T_C5), /** @type {any} */ (T_TOP)]);
          this._phase = 0;
        } else if (this._phase === 1) {
          this.bubbles = [this._scoopBubble(game, 'Swipe up to toss the top scoop', '#ffd166')];
          if (pl.stack.length === 1 && pl.colors()[0] === T_C5) this._phase = 2;
        } else {
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Now serve the bottom flavor — tap to deliver', false)];
          if (this._served(this._c)) this._setStep(9, game);
        }
        break;

      case 9:
        if (this._phase === 0) {
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'A tip! Some tips are power-ups you unlock later.', true, '#ffd166')];
          if (this.t >= TIP_BEAT) { pl.frozen = false; this._scoop = null; this._phase = 1; }
        } else {
          this._ensureScoop(game, T_C6);
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Catch & deliver for the tip!', false)];
          if (this._served(this._c)) this._setStep(10, game);
        }
        break;

      case 10:
        this.bubbles = [];   // no tooltips — just the gauge callout until the day ends
        break;
    }
  }

  /** @param {CanvasRenderingContext2D} ctx @param {Game} game */
  draw(ctx, game) {
    if (!this.active) return;
    const t = game.clock || 0;
    // The first-scoop plop: ghost eases down toward the next tray slot, fading in.
    if (this._ghost) {
      const pl = game.world.player;
      const tgt = pl.scoopPosition(pl.stack.length);
      const startY = tgt.y - PLOP_RISE;
      const y = startY + (tgt.y - startY) * easeIn(this._ghost.t);
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._ghost.t * 2);
      drawScoop(ctx, pl.x, y, /** @type {any} */ (this._ghost.color));
      ctx.restore();
    }
    for (const b of this.bubbles) {
      this._hint(ctx, b.x, b.y, b.text, { t, accent: b.accent || '#5cd8ff', point: b.point || null });
    }
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

    // Tutorial REPLAY (sandbox): only the coin tip can appear — the one token
    // unlocked when the tutorial was first cleared. No power-ups, no pacing.
    if (g.tutorialSandbox) return g.challenges.isCoinUnlocked() ? TIP_COIN : null;

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
