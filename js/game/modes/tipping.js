// @ts-check
import { PICKUP_TYPE, TIP_COIN, PICKUP_TO_POWER, CUSTOMER_FACE_OFFSET_PX } from '../config.js';
import { STATE, REACH } from '../shop.js';
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

// Scripted tutorial day. Every guided beat hands the player GHOST scoops (plopped
// straight onto the cone); catching from the sky isn't introduced until the final
// free-play stretch. Flavors are junior singles. In the pop lessons the customer
// wants the BOTTOM scoop and the colors above it are "junk" the player tosses to
// reach it — junk is only ever popped, never served, so the served set stays a
// clean 3+ distinct (vanilla/pink/mint) for Set 1's "discover 3".
const T_C1 = /** @type {ScoopColor} */ ('vanilla');   // #1 — move + deliver (patience off)
const T_C2 = /** @type {ScoopColor} */ ('pink');      // #2 — patience demo + recovery
const T_C3 = /** @type {ScoopColor} */ ('mint');      // #3 — first delivery with patience ON
const T_TIP = /** @type {ScoopColor} */ ('vanilla');  // #6 — the tip beat
/**
 * Pop lesson (#4): the customer wants `wanted` (the BOTTOM scoop); `plop` lists the
 * ghost scoops bottom→top, so the junk stacked on top is swiped off. One pop.
 */
const POP1 = { slot: 2, wanted: /** @type {ScoopColor} */ ('pink'), plop: /** @type {ScoopColor[]} */ (['pink', 'blueberry']) };
/**
 * Two-customer lesson (#5 + #6): three scoops, two customers. The TOP scoop goes to
 * the customer at `slotA`, the BOTTOM to the one at `slotB`, and the MIDDLE matches
 * nobody (toss it) — so a single stack serves two people. Serving the top scoop only
 * succeeds at the customer who wants it, so the order is forced: A → toss → B. `plop`
 * is built bottom→top from these colors.
 */
const TWO = {
  topColor:    /** @type {ScoopColor} */ ('pink'),       // on top → served FIRST, goes to slotA
  midColor:    /** @type {ScoopColor} */ ('blueberry'),  // matches nobody → swiped off
  bottomColor: /** @type {ScoopColor} */ ('mint'),       // at the bottom → served LAST, goes to slotB
  slotA: 4,    // wants the TOP scoop
  slotB: 0     // wants the BOTTOM scoop
};
// Staging slots (0..4). Each guided customer sits away from where the cone ends up
// after the previous delivery, so every beat also rehearses moving the cone (slot
// spacing always exceeds the serve REACH, so even one slot over needs a walk).
const SLOT_1ST = 0;   // #1 — far left of the centered start
const SLOT_2ND = 3;   // #2 — patience demo (kept off the edge so its long bubble reads)
const SLOT_3A  = 1;   // #3 — first patience-on delivery
const SLOT_TIP = 3;   // #6 — the tip
const GUIDE_VALUE = 50;          // a junior-single's points (so the "+50" pill is honest)
const FACE_BUBBLE_GAP = 125;     // px from a customer's FACE CENTER to a bubble hugging it (head ≈168 tall)
const POINTS_BEAT = 1.2;         // how long the "+50" pill lingers
const TIP_BEAT = 2.8;            // read beat for the tip explanation
const DRAIN_S = 1.4;             // how fast the demo customer's patience drains
const FINAL_MAX_LIVE = 2;        // gentle sky during the final free-play stretch (vs the mode's 7)
// First-scoop "plop": a tutorial-owned ghost scoop eases down from PLOP_RISE px
// above the landing slot over PLOP_FALL_S, then commits to the tray (land-squash).
// Restored from the original tutorial (git 8962db3) — accelerating drop feels best.
const PLOP_FALL_S = 0.5;
const PLOP_RISE = 150;
const PLOP_GAP_S = 0.18;         // beat between consecutive plops in a queue
const ORDER_BEAT = 0.5;          // beat after the first customer's order bubble pops, before the scoop plops in
const easeIn = (/** @type {number} */ t) => t * t;

/**
 * Tipping tutorial — a fully SCRIPTED, heavily-telegraphed onboarding day that
 * introduces one mechanic at a time and then relies on it. The five phases:
 *   1. GHOST scoop, learn to move + deliver (patience OFF).
 *   2. GHOST scoop, carry it to the customer, a patience→anger→death DEMO (lose
 *      health), then deliver for real (still no-fail).
 *   3. Patience ON: a 1-scoop delivery; a 2-scoop pop lesson (customer wants the
 *      bottom scoop, swipe the junk off); then a 3-scoop, TWO-customer beat — top
 *      scoop → one customer, bottom → another, middle → nobody (toss it).
 *   4. A tip (paused to read it), still ghost scoops, patience on.
 *   5. Hand off to real play: catching from the sky (no more ghosts), a gentle
 *      sky cap, patience on; the "finish the day" callout shows after the first
 *      real delivery and the remaining customers run unguided.
 * It drives World directly (freeze cone, stage customers via `shop.spawnScripted`,
 * pause/cap the sky, run the demo). Combos + perfect catches are disabled for the
 * whole day (see World) so it can't cheese a score. `start()` is the only entry;
 * `update()` is the step machine; `draw()` renders the beat's speech bubbles. The
 * cone's `frozen` flag doubles as a full PAUSE (game._deliver/_pop bail on frozen),
 * which is how guided beats stop the player from acting ahead of the prompt.
 */
class TippingTutorial extends TutorialBase {
  constructor() {
    super();
    this.step = 0;
    this.t = 0;             // seconds in the current step
    this._phase = 0;        // sub-phase within a step
    /** @type {Customer | null} the customer the current beat is about */
    this._c = null;
    /** @type {Customer | null} the second customer (the two-customer pop lesson) */
    this._c2 = null;
    /** @type {string | null} captured name so the death-demo customer resurrects as themself */
    this._cName = null;
    /** @type {{ color: ScoopColor, t: number } | null} the plop ghost currently falling (drawn, not a field scoop) */
    this._ghost = null;
    /** @type {ScoopColor[]} colors still queued to plop onto the cone (bottom→top) */
    this._plopQueue = [];
    this._plopGap = 0;      // beat before the next queued ghost starts falling
    this._freePlayBase = 0; // waves.servedCount when the final free-play stretch began
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
    // The scripted day ends when the final free-play customers fill the day meter
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
    w.field.setMaxLive(w.mode.maxLive);   // restore the mode's sky cap (the final stretch lowered it)
    this._ghost = null;
    this._plopQueue = [];
    this.dayHintText = null;
    this.bubbles = [];
  }

  /** @param {Customer | null} c */
  _served(c) { return !!c && c.state === STATE.LEAVING && c.mood === 'happy'; }
  /** @param {Customer | null} c */
  _waiting(c) { return !!c && c.state === STATE.WAITING; }
  /** Customer left ANGRY (patience ran out) — the patience-on recovery trigger. @param {Customer | null} c */
  _expired(c) { return !!c && c.state === STATE.LEAVING && c.mood === 'angry'; }

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
  /**
   * Stage a fresh scripted customer at `slot` (order = `order`) and start plopping
   * `plop` (bottom→top) onto a frozen, emptied cone — the shared opening of every
   * ghost beat. @param {Game} game @param {number} slot @param {ScoopColor[]} order
   * @param {ScoopColor[]} plop @param {{ character?: string|null, tip?: (PickupTypeName|'coin'|null) }} [opts]
   * @returns {Customer}
   */
  _stageGhost(game, slot, order, plop, opts = {}) {
    const pl = game.world.player;
    const c = game.world.shop.spawnScripted(slot, order, { value: GUIDE_VALUE, ...opts });
    pl.frozen = true; pl.clearStack();
    this._startPlops(plop);
    return c;
  }

  /** Stage (or restage) the two-customer lesson: A at slotA wants the top scoop, B at
   *  slotB wants the bottom, junk in the middle. @param {Game} game */
  _stageTwo(game) {
    const sh = game.world.shop, pl = game.world.player;
    this._c  = sh.spawnScripted(TWO.slotA, [TWO.topColor],    { value: GUIDE_VALUE });
    this._c2 = sh.spawnScripted(TWO.slotB, [TWO.bottomColor], { value: GUIDE_VALUE });
    pl.frozen = true; pl.clearStack();
    this._startPlops([TWO.bottomColor, TWO.midColor, TWO.topColor]);
  }

  /** Pull a scripted customer off the board immediately (no slide-off) so a restage
   *  never spawns a fresh customer on top of the old one — and never exhausts the
   *  regular roster (which would leave the new one character-less). @param {Game} game @param {Customer | null} c */
  _remove(game, c) {
    const list = game.world.shop.customers;
    const i = c ? list.indexOf(c) : -1;
    if (i >= 0) list.splice(i, 1);
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
        // PHASE 1 — move + deliver, patience OFF. Freeze the world (no sky scoops,
        // no patience), stage #1 far from the centered start; the plop is deferred
        // to _tick so it lands AFTER #1's order bubble pops.
        sh.scripted = true; w.freezePatience = true;
        fld.setSpawnPaused(true); fld.scoops.length = 0;
        this._c = sh.spawnScripted(SLOT_1ST, [T_C1], { value: GUIDE_VALUE });
        pl.frozen = true; pl.clearStack();
        break;
      case 4: {
        // PHASE 2 — patience DEMO. Ghost a scoop, make the player carry it to #2
        // (far side); on arrival the demo runs (patience drains → anger → damage).
        const c2 = this._stageGhost(game, SLOT_2ND, [T_C2], [T_C2]);
        this._c = c2;
        this._cName = c2.character;
        break;
      }
      case 5:
        // PHASE 2 recovery — resurrect #2 (no-fail; patience still frozen) so the
        // player actually delivers the ghost scoop this time.
        this._c = this._stageGhost(game, SLOT_2ND, [T_C2], [T_C2], { character: this._cName });
        break;
      case 6:
        // PHASE 3a — patience ON from here. A plain 1-scoop delivery to rehearse it.
        w.freezePatience = false;
        this._c = this._stageGhost(game, SLOT_3A, [T_C3], [T_C3]);
        break;
      case 7:
        // PHASE 3b — pop lesson (#4): customer wants the BOTTOM scoop; swipe the junk off.
        this._c = this._stageGhost(game, POP1.slot, [POP1.wanted], POP1.plop);
        break;
      case 8:
        // PHASE 3c — two-customer lesson (#5 + #6): top scoop → A, bottom → B, middle
        // → nobody (toss it). One stack serves two people.
        this._stageTwo(game);
        break;
      case 9:
        // PHASE 4 — a tip, paused so it can be read (patience frozen for the beat);
        // the scoop is still ghosted (no catching yet) and delivered with patience on.
        w.freezePatience = true;
        this._c = sh.spawnScripted(SLOT_TIP, [T_TIP], { value: GUIDE_VALUE, tip: TIP_COIN });
        pl.frozen = true; pl.clearStack();
        break;
      case 10:
        // PHASE 5 — hand off to real play: catching from the sky (no more ghosts),
        // patience on, a GENTLE sky cap. The "finish the day" callout waits for the
        // first real delivery (set in _tick, keyed off servedCount).
        sh.scripted = false;
        fld.setSpawnPaused(false);
        fld.setMaxLive(FINAL_MAX_LIVE);
        w.freezePatience = false;
        pl.frozen = false;
        this._freePlayBase = w.waves.servedCount;
        this._c = null; this._c2 = null;
        break;
    }
  }

  // ---- per-frame tick ----------------------------------------------------
  /** @param {number} dt @param {Game} game */
  _tick(dt, game) {
    const w = game.world, sh = w.shop, pl = w.player;
    switch (this.step) {

      case 1: {
        // PHASE 1a — customer slides in, order bubble pops (WAITING + beat), THEN the
        // scoop plops onto the frozen cone, THEN the "move" tooltip: beats in sequence.
        const c = this._c;
        if (this._phase === 0) {
          if (c && c.state === STATE.WAITING && c.waitT >= ORDER_BEAT) {
            this._startPlops([T_C1]);
            this._phase = 1;
          }
        }
        if (this._phase === 1) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 2; }
        }
        if (this._phase === 2) {
          this.bubbles = [this._scoopBubble(game, '◀  Move left and right  ▶')];
          if (sh.customerAt(pl.x) >= 0) this._setStep(2, game);
        }
        break;
      }

      case 2:
        // PHASE 1b — deliver. Re-plop ONLY if tossed while still owed (never after a
        // serve, which would leave a scoop stuck on the cone).
        if (pl.stack.length === 0 && this._waiting(this._c)) pl.push(T_C1);
        if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver', false)];
        if (this._served(this._c)) this._setStep(3, game);
        break;

      case 3:
        // PHASE 1c — the points reward reads.
        if (this._c) this.bubbles = [this._customerBubble(game, this._c, '+50 points!', true, '#ffd166')];
        if (this.t >= POINTS_BEAT) this._setStep(4, game);
        break;

      case 4: {
        // PHASE 2 — carry the ghost scoop to #2, then the scripted patience demo.
        const c = this._c;
        if (!c) { this._setStep(5, game); break; }
        if (this._served(c)) { this._setStep(6, game); break; }   // frame-perfect early serve → skip the demo
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (this._phase === 1) {
          if (pl.stack.length === 0) pl.push(T_C2);               // tossed → give it back
          this.bubbles = [this._scoopBubble(game, 'Bring it to the customer')];
          // Freeze just outside serve range so the demo always runs before a tap could land.
          if (Math.abs(pl.x - c.x) < REACH * 1.3) { pl.frozen = true; this.bubbles = []; this._phase = 2; }
        } else if (this._phase === 2) {
          // Telegraphed FAIL: warn, drain their patience to zero, then take damage.
          this.bubbles = [this._customerBubble(game, c, 'Deliver before their patience runs out!', false, '#ff6fa3')];
          if (this._waiting(c)) {
            c.order.timeLeft -= (c.order.duration / DRAIN_S) * dt;
            if (c.order.timeLeft <= 0) {
              c.order.timeLeft = 0;
              c.state = STATE.LEAVING; c.mood = 'angry';
              w.onExpire(1);                                       // health drop + shake + sound + bar flash
              this._phase = 3;
            }
          }
        } else if (this._phase === 3) {
          this.bubbles = [this._customerBubble(game, c, 'Too slow — you lost health!', true, '#ff6fa3')];
          if (!sh.list.includes(c)) this._setStep(5, game);
        }
        break;
      }

      case 5:
        // PHASE 2 recovery — deliver for real (no-fail; patience still frozen). Plop
        // → unfreeze → deliver; re-plop if tossed.
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (this._served(this._c)) {
          this._setStep(6, game);
        } else if (pl.stack.length === 0) {
          pl.frozen = true; this._startPlops([T_C2]); this._phase = 0;
        } else if (this._c) {
          this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver', false)];
        }
        break;

      case 6:
        // PHASE 3a — patience ON. A plain 1-scoop delivery under the clock; resurrect
        // on a timeout (the damage stands) and re-plop if tossed, so the script holds.
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (this._served(this._c)) {
          this._setStep(7, game);
        } else if (this._expired(this._c)) {
          this._remove(game, this._c);                          // clear the angry one before resurrecting
          this._c = this._stageGhost(game, SLOT_3A, [T_C3], [T_C3]); this._phase = 0;
        } else if (pl.stack.length === 0) {
          pl.frozen = true; this._startPlops([T_C3]); this._phase = 0;
        } else if (this._c) {
          this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver', false)];
        }
        break;

      case 7: {
        // PHASE 3b — pop lesson (#4). Customer wants the BOTTOM scoop; swipe the junk
        // off the top to reach it (one pop).
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
        } else if (this._expired(this._c)) {
          this._remove(game, this._c);                          // clear the angry one before restaging
          this._c = this._stageGhost(game, POP1.slot, [POP1.wanted], POP1.plop); this._phase = 0;   // timed out → restage
        } else if (this._phase === 1) {
          const cols = pl.colors();
          if (cols.length === 0) { pl.frozen = true; this._startPlops(POP1.plop); this._phase = 0; break; }   // over-popped
          if (cols.length === 1 && cols[0] === POP1.wanted) { this._phase = 2; break; }                       // junk cleared
          this.bubbles = [this._scoopBubble(game, 'Swipe up to toss the top scoop', '#ffd166')];
        } else {
          if (pl.stack.length === 0 && !this._served(this._c)) {  // over-popped after revealing → restage
            pl.frozen = true; this._startPlops(POP1.plop); this._phase = 0; break;
          }
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver', false)];
          if (this._served(this._c)) this._setStep(8, game);
        }
        break;
      }

      case 8: {
        // PHASE 3c — TWO customers, three scoops: top → A, bottom → B, middle → nobody.
        // Serve A (top), toss the junk, serve B (bottom): one stack feeds two people.
        // The delivery rule forces that order — the top scoop only takes at A.
        const A = this._c, B = this._c2;
        if (this._phase === 0) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 1; }
          break;
        }
        if (this._served(A) && this._served(B)) { this._setStep(9, game); break; }
        const cols = pl.colors();
        // Broken — a needed customer timed out, or their flavor got tossed before
        // their turn (the junk middle being tossed is fine; it isn't anyone's color).
        const brokenA = !this._served(A) && (this._expired(A) || !cols.includes(TWO.topColor));
        const brokenB = !this._served(B) && (this._expired(B) || !cols.includes(TWO.bottomColor));
        if (brokenA || brokenB) {
          // Clear BOTH old customers first — otherwise the fresh pair spawns on top of
          // them and the duplicates exhaust the roster (leaving one character-less).
          this._remove(game, A); this._remove(game, B);
          this._stageTwo(game); this._phase = 0; break;
        }
        if (!this._served(A)) {
          if (A) this.bubbles = [this._customerBubble(game, A, 'Serve your top scoop here', false)];
        } else if (cols.length > 1) {
          this.bubbles = [this._scoopBubble(game, 'Nobody wants this — swipe it off', '#ffd166')];
        } else if (B) {
          this.bubbles = [this._customerBubble(game, B, 'Now serve this customer', false)];
        }
        break;
      }

      case 9:
        // PHASE 4 — tip. Read beat (paused), then ghost the scoop and deliver (patience on).
        if (this._phase === 0) {
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'A tip! Tips can be power-ups.', true, '#ffd166')];
          if (this.t >= TIP_BEAT) { w.freezePatience = false; this._startPlops([T_TIP]); this._phase = 1; }
        } else if (this._phase === 1) {
          if (this._advancePlops(dt, game)) { pl.frozen = false; this._phase = 2; }
        } else {
          if (this._expired(this._c)) {                           // timed out → restage with the tip again
            this._remove(game, this._c);                          // clear the angry one before resurrecting
            this._c = sh.spawnScripted(SLOT_TIP, [T_TIP], { value: GUIDE_VALUE, tip: TIP_COIN });
            pl.frozen = true; pl.clearStack(); this._startPlops([T_TIP]); this._phase = 1; break;
          }
          if (pl.stack.length === 0 && !this._served(this._c)) {
            pl.frozen = true; this._startPlops([T_TIP]); this._phase = 1; break;
          }
          if (this._c) this.bubbles = [this._customerBubble(game, this._c, 'Tap to deliver for the tip!', false)];
          if (this._served(this._c)) this._setStep(10, game);
        }
        break;

      case 10:
        // PHASE 5 — free play. Until the first real order lands, telegraph the new
        // catching mechanic AND the day goal; the moment a customer is served, clear
        // BOTH and go fully hands-off (the goal callout shouldn't linger all round).
        if (w.waves.servedCount > this._freePlayBase) {
          this.dayHintText = null;
          this.bubbles = [];
        } else {
          this.dayHintText = 'Complete orders until the day is done!';
          this.bubbles = [{ x: game.bounds.width / 2, y: game.bounds.height * 0.34, text: 'Now catch the falling scoops!', point: null, accent: '#5cd8ff' }];
        }
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
      // Keep the pill on-screen: measure it and clamp its center so an edge-slot
      // customer's bubble doesn't run off the canvas (the caret follows the clamp).
      ctx.save();
      ctx.font = "bold 27px 'Comic Sans MS', sans-serif";
      const halfW = (ctx.measureText(b.text).width + 42) / 2 + 8;
      ctx.restore();
      const x = Math.max(halfW, Math.min(game.bounds.width - halfW, b.x));
      this._hint(ctx, x, b.y, b.text, { t, accent: b.accent || '#5cd8ff', point: b.point || null });
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
      g.challenges.recordCoinCollected();
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
