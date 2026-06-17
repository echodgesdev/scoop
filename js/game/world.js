// @ts-check
// The simulation. World owns the models (player, field, shop, waves, power-ups,
// mode), the progression (recipes, challenges), and the sim/config state, and it
// advances them with step(dt) + the rule methods. It mutates ONLY its own state
// and EMITS domain events on the shared bus — it never touches the DOM, canvas,
// HUD, sound, haptics, effects, or timers. Everything visual / audible / flow-
// timed lives in game.js (the coordinator) + reactions.js + view/renderer.js,
// driven by these events plus a per-frame read of World state. This one-way
// dataflow (input → step → events → presentation) keeps the ruleset portable.
import {
  MAX_HEALTH,
  DAMAGE_PER_EXPIRE,
  HEAL_PER_SERVE,
  MAX_STACK,
  PERFECT_CATCH_BAND,
  PERFECT_CATCH_BONUS,
  HEART_HEAL_AMOUNT,
  PICKUP_TYPE,
  PICKUP_TO_POWER,
  PICKUP_WEIGHTS,
  PICKUP_SPAWN_MIN_S,
  PICKUP_SPAWN_MAX_S,
  CUSTOMER_FACE_OFFSET_PX,
  SCOOP_RADIUS,
  COMBO_BREAKER_THRESHOLD,
  COMBO_BREAKER_DURATION_MULT,
  SPAWN_DEMAND_BIAS,
  WAVE0_DEMAND_BIAS,
  DELIVERY_MODE,
  coneYFor,
  groundYFor
} from './config.js';
import { Player } from './player.js';
import { ScoopField, isCaught } from './scoops.js';
import { Shop } from './shop.js';
import { Waves, WAVE_EVENT } from './waves.js';
import { PowerUps } from './powerups.js';
import { Recipes } from './recipes.js';
import { Challenges } from './challenges.js';
import { Regulars } from './regulars.js';
import { CHARACTERS, CHARACTER_BY_NAME } from './customers.js';
import { makeMode } from './modes/index.js';

/** @typedef {import('../types.js').GameEventMap} GameEventMap */
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../types.js').Bounds} Bounds */
/** @typedef {import('../engine/events.js').EventBus<GameEventMap>} Bus */
/** @typedef {import('../engine/input.js').Input} Input */

// Active power-up indicator timings (sim side). When a timed power-up fires its
// indicator floats UP into the "active" slot; when it ends — or is replaced — it
// slides off LEFT, taking PU_LEAVE_S. ACTIVE_SLIDE_S is the total entrance time
// (its draw-phase fractions live in the renderer).
const PU_LEAVE_S = 0.3;
const ACTIVE_SLIDE_S = 0.7;

export class World {
  /**
   * @param {Bus} bus shared event bus (the game creates it)
   * @param {Bounds} bounds shared virtual-canvas size (the game owns/resizes it)
   * @param {Record<string, boolean>} flags shared debug-cheat flags (invincible,
   *   patternTimer, …) — read-only here
   * @param {Input} input shared input state (steering is consumed in step)
   */
  constructor(bus, bounds, flags, input) {
    this.bus = bus;
    this.bounds = bounds;
    this.flags = flags;
    this.input = input;

    // Progression (persisted) — owned by the sim, read by the HUD for its modals.
    this.recipes = new Recipes();
    // Customer "regulars" unlock + served progression (persisted, keyed by name).
    // Created before Challenges so the "serve a regular N times" challenges can
    // read it.
    this.regulars = new Regulars();
    this.challenges = new Challenges(this.recipes, this.regulars);
    // Challenge requirement newly met → domain event; the HUD toast lives in
    // reactions. The sim never reaches the HUD directly.
    this.challenges.onEarned = ch => this.bus.emit('challengeEarned', { title: ch.title });

    // This run's "mystery" regular: one locked regular (rolled in reset) who
    // starts appearing on a random day [5,7] and unlocks when first served — so a
    // single life can unlock at most one new regular. Null once everyone's unlocked.
    /** @type {string | null} */
    this._mysteryName = null;
    this._mysteryRevealDay = 0;

    // Names of the (starter) regulars served during the Day-0 tutorial, in order.
    // Drained for the end-of-tutorial "meet your first regulars" flip-reveal — the
    // one place a starter gets a reveal coin (they're never "locked"). Captured
    // only while the tutorial overlay is active; empty on tutorial-skipped runs.
    /** @type {string[]} */
    this._tutorialServed = [];

    // Sim config (debug-tunable). Delivery method: how a tray serves an order
    // ('any' | 'sequential' | 'whole'). Typed as string since the debug dropdown
    // sets it from a plain string.
    /** @type {string} */
    this.deliveryMode = DELIVERY_MODE.ANY;
    /** @type {number | null} */
    this.spawnIntervalOverride = null;
    // Combo breaker: the score combo doubles as a charge meter — at this many
    // chained serves it "breaks" into a supercharged power-up. comboBreakerEnabled
    // is a per-mode capability (set by _applyModeConfig); the threshold is tunable.
    this.comboBreakerThreshold = COMBO_BREAKER_THRESHOLD;
    this.comboBreakerEnabled = false;
    this.maxStack = MAX_STACK;  // re-set per mode by _applyModeConfig below
    /** @type {number | null} Debug patience override (seconds). null = wave ramp. */
    this.patienceOverride = null;

    this.waves    = new Waves(
      // Recipe sections are challenge-gated again: a section spawns only once it's
      // been unlocked by a cleared set AND the day pool (WAVE_GROUPS) has reached
      // it. Challenges derives the unlocked set from cleared-set rewards.
      () => this.challenges.unlockedSections(),
      id => this.recipes.isDiscovered(id)
    );
    this.powerups = new PowerUps();
    this.player   = new Player(0, 0);
    this.field    = new ScoopField();
    this.shop     = new Shop(this.waves);

    // Power-up economy config (debug-tunable, persists across game starts since
    // it lives here, not on the rebuilt mode). `powerupWeights` is the relative
    // mix of heart/⚡/❄️/🌈 (aligned to PICKUP order); `tipGap{Min,Max}` is the
    // seconds-between-tips range the tip roller reads.
    this.powerupWeights = PICKUP_WEIGHTS.slice();
    this.tipGapMin = PICKUP_SPAWN_MIN_S;
    this.tipGapMax = PICKUP_SPAWN_MAX_S;

    // The game mode (Tipping) owns board size, the tip-sourced power-ups, the
    // tray verbs, and the active slot. World DELEGATES to it via modes/index.js.
    this.mode = makeMode(this);

    // Couple supply to demand: the field biases its queue toward needed colors.
    this.field.setDemandSource(() => this.shop.demandColors(this.player.colors()));
    // Some customers arrive with a tip; the mode's roller decides per spawn.
    this.shop.setTipRoller(() => this.mode.rollTip());
    // Gate which regulars can walk up: unlocked ones, plus this run's mystery
    // candidate once their reveal day arrives.
    this.shop.setRosterSource(() => this.eligibleRegulars());
    this._applyModeConfig();

    // Active timed power-up indicator (mirrors the running power-up's countdown).
    /** @type {{ type: PickupTypeName, fromX: number, fromY: number, anim: number } | null} */
    this.activeBubble = null;
    // Indicators mid-slide-off to the left (a finished / just-replaced power-up).
    /** @type {{ type: PickupTypeName, x: number, y: number, r0: number, t: number }[]} */
    this.puLeaving = [];

    this.health = MAX_HEALTH;

    // Recipes unlocked / mastered during this session — drained on game over.
    /** @type {{ unlocked: string[], mastered: string[] }} */
    this.sessionRecipeEvents = { unlocked: [], mastered: [] };

    // Set by the coordinator each frame: patience is frozen while the tutorial is
    // on (so the staged customer never bails). The tutorial is presentation and
    // lives in game.js; World only reads this boolean.
    this.tutorialActive = false;
  }

  /** Y of the sand-floor top edge — the customer ground line (no view dependency). */
  _groundY() { return groundYFor(this.bounds.height); }

  /**
   * Which regulars can walk up right now: every unlocked one, plus this run's
   * mystery candidate once the current day reaches their reveal day (and until
   * they're served + unlocked, after which the unlocked filter already covers
   * them). The shop's selection waterfall draws from this. @returns {import('./customers.js').CharacterDef[]}
   */
  eligibleRegulars() {
    const pool = CHARACTERS.filter(c => this.regulars.isUnlocked(c.name));
    if (this._mysteryName && this.waves.wave >= this._mysteryRevealDay && !this.regulars.isUnlocked(this._mysteryName)) {
      const def = CHARACTER_BY_NAME.get(this._mysteryName);
      if (def) pool.push(def);
    }
    return pool;
  }

  /**
   * Take and clear the starters served during the Day-0 tutorial (≤ 3) — the
   * end-of-tutorial "meet your first regulars" reveal. Empty after a non-tutorial
   * run, so it's safe to call at every day-end. @returns {string[]}
   */
  drainTutorialReveals() {
    const out = this._tutorialServed.slice(0, 3);
    this._tutorialServed = [];
    return out;
  }

  /**
   * Reset every model + progression-session counter for a fresh run. Flow,
   * presentation, and the loop are the coordinator's to reset.
   * @param {boolean} playWave0 whether the run opens on the tutorial wave
   */
  reset(playWave0) {
    this.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
    this.player.clearStack();
    this.player.frozen = false;
    this.field.reset();
    this.powerups.reset();
    this.shop.layout(this.bounds.width);
    this.waves.reset(playWave0 ? 0 : 1);
    this.shop.setOrderTime(this.waves.tuning().patience);
    this.shop.reset();
    // Roll this run's mystery regular: one locked random-pool regular who starts
    // appearing on a random day [3,7] and unlocks when first served. One shot per
    // life — you must start a fresh run (die) to roll the next candidate.
    this._mysteryName = this.regulars.pickMysteryCandidate();
    this._mysteryRevealDay = 3 + Math.floor(Math.random() * 5);
    this._tutorialServed = [];
    this.health = MAX_HEALTH;
    this.activeBubble = null;
    this.puLeaving.length = 0;
    this.input.moveDelta = 0;  // drop any stale touch-steer state
    // Rebuild the mode for a fresh run, then re-apply its board size + caps.
    this.mode = makeMode(this);
    this.mode.reset();
    this._applyModeConfig();
    // Wave 0 (the opening tutorial wave) leans harder toward demanded colors.
    this.field.setDemandBias(this.waves.wave === 0 ? WAVE0_DEMAND_BIAS : SPAWN_DEMAND_BIAS);
    this.sessionRecipeEvents = { unlocked: [], mastered: [] };
    this.challenges.resetSession();
  }

  /**
   * Apply the mode's load-time settings (board size + combo-breaker capability).
   * The single place mode defaults land; debug sliders can still override after.
   */
  _applyModeConfig() {
    this.maxStack = this.mode.maxStack;
    this.field.setMaxLive(this.mode.maxLive);
    this.comboBreakerEnabled = this.mode.comboBreaker;
  }

  /**
   * Advance the simulation one fixed step. Mutates models + emits events only —
   * no presentation. The coordinator sets `tutorialActive` before calling this.
   * @param {number} dt
   */
  step(dt) {
    this.waves.update(dt);
    this.powerups.update(dt);

    const tuning = this.waves.tuning();
    // Debug overrides win over the wave ramp; only affect spawns from here on
    // (in-flight customers/scoops keep their values).
    this.shop.setOrderTime(this.patienceOverride != null ? this.patienceOverride : tuning.patience);
    if (this.spawnIntervalOverride != null) tuning.spawnInterval = this.spawnIntervalOverride;
    this.player.update(dt, this.input, this.bounds, this.powerups.speedMultiplier);

    const hitbox = this.player.catchHitbox();
    // Missed scoops fall past the cone and dissolve down in the sand (below the
    // ground line), so the fizzle reads as the scoop melting into the floor.
    const missY = this._groundY() + SCOOP_RADIUS * 2;

    // The falling field runs during the tutorial too — Wave 0 is a real,
    // playable wave; the tutorial only overlays hints on top of it.
    this.field.update(dt, this.bounds, tuning, missY, scoop => {
      if (!isCaught(scoop, hitbox)) return false;
      const perfect = Math.abs(scoop.x - hitbox.x) <= PERFECT_CATCH_BAND;
      this._onCatch(scoop, perfect);
      return true;
    });

    this._stepActive(dt);

    // Patience is frozen during the tutorial so the staged customer never bails.
    const patienceOn = this.flags.patternTimer && !this.powerups.pauseActive && !this.tutorialActive;
    const { expired, comboLost } = this.shop.update(dt, { patienceOn });
    if (expired > 0) this.onExpire(expired);
    if (comboLost) this.bus.emit('comboLost', /** @type {any} */ ({}));
  }

  /**
   * @param {import('../types.js').Scoop} scoop
   * @param {boolean} perfect
   */
  _onCatch(scoop, perfect) {
    if (this.player.stack.length >= this.maxStack) {
      this.bus.emit('trayFull', /** @type {any} */ ({}));
      return;
    }
    this.player.push(scoop.color);
    if (perfect) {
      this.shop.addScore(PERFECT_CATCH_BONUS);
      this.shop.refreshCombo();
    }
    this.bus.emit('catch', { scoop, perfect });
  }

  /** The upward gesture (swipe up / Space): the mode tosses the top scoop. */
  pop() {
    this.mode.onSwipeUp();
  }

  /** Spit out the top scoop (discard) — the Tipping upward gesture. */
  discardTop() {
    const stack = this.player.stack;
    if (stack.length === 0) { this.bus.emit('serveFail', /** @type {any} */ ({})); return; }
    const idx = stack.length - 1;
    const pos = this.player.scoopPosition(idx);
    const color = stack[idx].color;
    this.player.popTop();
    this.bus.emit('discard', { x: pos.x, y: pos.y, color });
  }

  /**
   * Hand the top of the tray to customer `index` (the serve verb). Routes through
   * the active delivery mode; emits handoff / partialServe presentation events and
   * forwards completions to _onOrderComplete.
   * @param {number} index a waiting customer the cone is standing at
   */
  serve(index) {
    const stack = this.player.stack;
    if (stack.length === 0) {
      this.bus.emit('serveFail', /** @type {any} */ ({}));
      return;
    }
    const rainbow = this.powerups.rainbowActive;
    const customer = this.shop.list[index];

    // 'whole' delivery: the entire tray must equal the order; serve it in one
    // action (every scoop flies over, the tray clears).
    if (this.deliveryMode === DELIVERY_MODE.WHOLE) {
      const result = this.shop.serveWhole(index, this.player.colors(), rainbow);
      if (!result.accepted) { this.bus.emit('serveFail', /** @type {any} */ ({})); return; }
      for (let i = 0; i < stack.length; i++) {
        const p = this.player.scoopPosition(i);
        customer.order.served.push({ color: stack[i].color, t: 0, srcX: p.x, srcY: p.y });
        this.bus.emit('handoff', { x: p.x, y: p.y, color: stack[i].color });
      }
      this.player.clearStack();
      this._onOrderComplete(result, customer);
      return;
    }

    // 1-at-a-time delivery ('any' or 'sequential'): hand over the top scoop.
    const topColor = stack[stack.length - 1].color;
    const srcPos = this.player.scoopPosition(stack.length - 1);

    const result = this.shop.serveOne(index, topColor, rainbow, this.deliveryMode);
    if (!result.accepted) {
      this.bus.emit('serveFail', /** @type {any} */ ({}));
      return;
    }

    // Customer took the top scoop — physically remove it from the tray and queue
    // the flying-scoop animation on the customer's mini-cone.
    this.player.popTop();
    customer.order.served.push({ color: topColor, t: 0, srcX: srcPos.x, srcY: srcPos.y });

    // Cone leans toward the customer's face for a brief moment — the "handing"
    // gesture. Face center is groundY + CUSTOMER_FACE_OFFSET_PX, modulated by
    // their slide-in offset.
    const targetY = this._groundY() + CUSTOMER_FACE_OFFSET_PX + customer.yOff;
    this.player.triggerHandoff(customer.x, targetY);

    // Source burst at the cone for the scoop leaving the tray (presentation).
    this.bus.emit('handoff', { x: srcPos.x, y: srcPos.y, color: topColor });

    if (!result.complete) {
      this.bus.emit('partialServe', { x: customer.x, y: this._groundY() - 60 });
      return;
    }
    this._onOrderComplete(result, customer);
  }

  /**
   * Shared order-completion handling: heal, recipe/challenge tracking, the serve
   * event, tip grant, the combo breaker, and the wave-progress event. Called by
   * every delivery mode.
   * @param {{ gained?: number, colors?: import('../types.js').ScoopColor[], event?: string|null, tip?: (PickupTypeName|'coin'|null) }} result
   * @param {import('../types.js').Customer} customer
   */
  _onOrderComplete(result, customer) {
    const { gained, colors, event } = result;
    const cx = customer.x;
    const cy = this._groundY() - 60;

    const targetY = this._groundY() + CUSTOMER_FACE_OFFSET_PX + customer.yOff;
    this.player.triggerHandoff(customer.x, targetY);

    this.health = Math.min(MAX_HEALTH, this.health + HEAL_PER_SERVE);

    // Recipe book: record the completion. Stash any first-time-unlocked or just-
    // mastered ids for the game-over celebration overlay, then forward to
    // challenges so progress trackers update in real time.
    if (colors && colors.length > 0) {
      const ev = this.recipes.recordComplete(colors);
      if (ev.wasNew) {
        this.sessionRecipeEvents.unlocked.push(ev.id);
        this.challenges.recordDiscover(ev.id);
      }
      if (ev.justMastered) {
        this.sessionRecipeEvents.mastered.push(ev.id);
        this.challenges.recordMaster(ev.id);
      }
    }
    // Regulars: bump this customer's lifetime served count and unlock them on
    // their first completed order (persisted). Done BEFORE the challenge checks
    // so a "serve a regular N times" challenge sees the up-to-date count. The
    // day-end reveal reads regulars.drainPendingReveals().
    this.regulars.recordServed(customer.character);
    // Tutorial only: remember which starters you served, so the day-end reveal
    // can introduce them. `tutorialActive` is set by the coordinator before each
    // step and is still true on the serve that clears Day 0.
    if (this.tutorialActive && customer.character && !this._tutorialServed.includes(customer.character)) {
      this._tutorialServed.push(customer.character);
    }
    this.challenges.recordCustomerServed();
    this.challenges.recordCombo(this.shop.combo);

    // Tip-sourced modes: grant the customer's tip (coin = points, else fire it).
    if (result.tip) this.mode.grantTip(result.tip, cx, cy);

    this.bus.emit('serve', {
      gained: gained ?? 0,
      colors: colors ?? [],
      combo: this.shop.combo,
      x: cx,
      y: cy
    });

    // Combo breaker: the serve event above already showed the combo at its peak;
    // if that pushed the chain to the threshold, break it now into a supercharged
    // power-up (resets the meter). Enabled per mode (default Tipping-only).
    // Skipped on the wave-completing serve: the wave cashes the combo out anyway,
    // and firing here would freeze its pop-text behind the between-wave overlay.
    if (this.comboBreakerEnabled && event !== WAVE_EVENT.WAVE_UP &&
        this.shop.combo >= this.comboBreakerThreshold) {
      this._fireComboBreaker(cx, cy);
    }

    if (event === WAVE_EVENT.PHASE_UP) {
      this.bus.emit('phaseUp', /** @type {any} */ ({}));
    } else if (event === WAVE_EVENT.WAVE_UP) {
      // The sim only announces the wave-up; the coordinator's 'waveUp' handler
      // schedules the cashout flow. Progression bookkeeping stays here.
      this.bus.emit('waveUp', { wave: this.waves.wave });
      // Challenge tracking: new wave reached, and per-wave counters reset.
      this.challenges.recordWaveReached(this.waves.wave);
      this.challenges.recordWaveEnded();
      // Leaving Wave 0 → restore the normal demand bias for the campaign proper.
      if (this.waves.wave === 1) this.field.setDemandBias(SPAWN_DEMAND_BIAS);
    }
  }

  /**
   * Apply a power-up's effect at (x, y): heart heals instantly and is orthogonal
   * (never disturbs a running timed power-up); the three timed types replace
   * whatever is running (mutual exclusion via PowerUps.trigger) and float into the
   * active slot. Driven by tip grants + the combo breaker. The FX/sound/haptics
   * land in the 'powerup' reaction.
   * @param {PickupTypeName} type
   * @param {number} x @param {number} y burst origin (passed through to the event)
   * @param {number} [durationMult] scale the timed power-up's duration (combo
   *   breaker passes > 1). Ignored by the instant heart heal.
   */
  firePower(type, x, y, durationMult = 1) {
    // Single seam for "a power-up was used" — every source (tip, combo-breaker)
    // flows through here, so this is the one place challenge tracking counts it.
    this.challenges.recordPowerupUsed(type);
    if (type === PICKUP_TYPE.HEART) {
      if (!this.flags.invincible) {
        this.health = Math.min(MAX_HEALTH, this.health + HEART_HEAL_AMOUNT);
      }
    } else {
      this._activateBubble(type, x, y);
      this.powerups.trigger(type, durationMult);
    }
    this.bus.emit('powerup', { type, x, y });
  }

  /**
   * Debug cheat (Q/W/E/R): synthesize a power-up firing at the cone. The game
   * gates this on the pickupKeys flag before calling.
   * @param {PickupTypeName} type
   */
  usePower(type) {
    this.firePower(type, this.player.x, this.player.stackTopY());
  }

  /**
   * Combo breaker: the serve chain hit the threshold. Empty the meter and fire a
   * SUPERCHARGED timed power-up (extended duration) as the earned payoff. No new
   * verb — it discharges automatically. The crescendo FX land in 'comboBreak'.
   * @param {number} x @param {number} y burst origin
   */
  _fireComboBreaker(x, y) {
    const type = this._pickSuperchargeType();
    // No unlocked timed power-up to supercharge yet — leave the combo intact so
    // it keeps building until the player unlocks one (via challenges).
    if (!type) return;
    this.shop.breakCombo();
    this.firePower(type, this.player.x, this.player.stackTopY(), COMBO_BREAKER_DURATION_MULT);
    this.bus.emit('comboBreak', { x, y });
  }

  /**
   * Pick which timed power-up the breaker supercharges — weighted by the power-up
   * mix (⚡ speed / ❄️ freeze / 🌈 rainbow), uniform if unset. Only types the
   * player has UNLOCKED are eligible (heart is excluded regardless: it heals
   * instantly, so a duration multiplier is moot). Returns null when none of the
   * timed power-ups are unlocked yet, so the caller can skip the breaker.
   * @returns {PickupTypeName | null}
   */
  _pickSuperchargeType() {
    const w = this.powerupWeights;
    /** @type {Array<{ type: PickupTypeName, weight: number }>} */
    const pool = [
      { type: PICKUP_TYPE.FEATHER, weight: w[1] || 0 },
      { type: PICKUP_TYPE.PAUSE,   weight: w[2] || 0 },
      { type: PICKUP_TYPE.RAINBOW, weight: w[3] || 0 }
    ].filter(p => this.challenges.isPowerupUnlocked(p.type));
    if (pool.length === 0) return null;
    const total = pool.reduce((a, p) => a + p.weight, 0);
    if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].type;
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) return p.type;
    }
    return pool[pool.length - 1].type;
  }

  /** Customers expired (patience ran out): take damage; decide death. @param {number} count */
  onExpire(count) {
    if (!this.flags.invincible) {
      this.health = Math.max(0, this.health - DAMAGE_PER_EXPIRE * count);
    }
    this.bus.emit('expire', { count });
    // The sim only DECIDES death; the game's 'gameOver' handler runs _endGame.
    if (this.health <= 0) this.bus.emit('gameOver', /** @type {any} */ ({}));
  }

  /**
   * Float a freshly-fired timed power-up UP into the active slot. If one is
   * already running, bump it out to the left first (the replace-on-fire read).
   * @param {PickupTypeName} type
   * @param {number} fromX the x the bubble launches from (the cone)
   * @param {number} fromY the y the bubble launches from (the stack top)
   */
  _activateBubble(type, fromX, fromY) {
    if (this.activeBubble) {
      const pos = this.activeSlotPos();
      this.puLeaving.push({ type: this.activeBubble.type, x: pos.x, y: pos.y, r0: pos.r, t: 0 });
    }
    this.activeBubble = { type, fromX, fromY, anim: 0 };
  }

  /**
   * Per-frame active-slot update: float the running power-up's bubble up and
   * advance the slide-off-left animations. The bubble retires (slides left) once
   * its timed power-up ends. @param {number} dt
   */
  _stepActive(dt) {
    for (let i = this.puLeaving.length - 1; i >= 0; i--) {
      this.puLeaving[i].t += dt / PU_LEAVE_S;
      if (this.puLeaving[i].t >= 1) this.puLeaving.splice(i, 1);
    }
    const a = this.activeBubble;
    if (!a) return;
    a.anim = Math.min(1, a.anim + dt / ACTIVE_SLIDE_S);
    if (a.anim >= 1 && !this.powerups.active(PICKUP_TO_POWER[a.type])) {
      const pos = this.activeSlotPos();
      this.puLeaving.push({ type: a.type, x: pos.x, y: pos.y, r0: pos.r, t: 0 });
      this.activeBubble = null;
    }
  }

  /**
   * The active power-up's resting slot: horizontally centered, at the mode's
   * activeSlotY. The renderer's entrance animation rises to a waypoint before
   * settling here. @returns {{ x: number, y: number, r: number }}
   */
  activeSlotPos() {
    // r is the RESTING radius; the entrance peaks larger (≈1.4×) at the waypoint.
    return { x: this.bounds.width / 2, y: this.mode.activeSlotY(this.bounds), r: 40 };
  }

  /**
   * Debug: seconds-between-tips range the tip roller reads (wider/larger = rarer
   * power-ups). @param {number} min @param {number} max
   */
  setTipGap(min, max) {
    const lo = Math.max(0.2, min);
    this.tipGapMin = lo;
    this.tipGapMax = Math.max(lo, max);
  }

  /**
   * Debug: relative power-up mix, aligned to PICKUP order (heart, ⚡, ❄️, 🌈).
   * Negatives clamp to 0; a type weighted 0 never appears as a tip / breaker pick.
   * @param {number[]} weights
   */
  setPowerupWeights(weights) {
    for (let i = 0; i < this.powerupWeights.length; i++) {
      const v = weights[i];
      if (Number.isFinite(v)) this.powerupWeights[i] = Math.max(0, v);
    }
  }
}
