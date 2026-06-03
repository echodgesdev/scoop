// @ts-check
// Composition root. The codebase is split into layers by folder:
//   engine/ — game-agnostic runtime (loop bits, input, touch, audio, haptics,
//             viewport, event bus)
//   game/   — simulation + rules + data (player, scoops, shop, waves, powerups,
//             recipes, challenges, day cycle, modes, config, tuning)
//   view/   — rendering (scene, stations, effects, HUD)
// This file wires them together: builds the actors, runs the loop, routes input,
// orchestrates the draw, and maps domain events → sound/haptics/effects/HUD.
import {
  MAX_HEALTH,
  DAMAGE_PER_EXPIRE,
  HEAL_PER_SERVE,
  MAX_STACK,
  PERFECT_CATCH_BAND,
  PERFECT_CATCH_BONUS,
  HEART_HEAL_AMOUNT,
  PICKUP_TYPE,
  POWERUP_TYPE,
  PICKUP_ICONS,
  PICKUP_RING_COLOR,
  PICKUP_WEIGHTS,
  PICKUP_SPAWN_MIN_S,
  PICKUP_SPAWN_MAX_S,
  CUSTOMER_FACE_OFFSET_PX,
  SCOOP_RADIUS,
  COMBO_CASHOUT_PER,
  STACK_CASHOUT_PER_SCOOP,
  COMBO_BREAKER_THRESHOLD,
  COMBO_BREAKER_DURATION_MULT,
  SPAWN_DEMAND_BIAS,
  WAVE0_DEMAND_BIAS,
  coneYFor,
  DELIVERY_MODE
} from './game/config.js';
import { Player } from './game/player.js';
import { ScoopField, isCaught } from './game/scoops.js';
import { Shop, REACH } from './game/shop.js';
import { Stations } from './view/stations.js';
import { Waves, WAVE_EVENT } from './game/waves.js';
import { Hud } from './view/hud.js';
import { Input } from './engine/input.js';
import { Sound } from './engine/audio.js';
import { Haptics } from './engine/haptics.js';
import { Effects } from './view/effects.js';
import { DebugPanel } from './debug.js';
import { drawSkyAndSun, drawNightSky, drawSand, drawOcean } from './view/scene.js';
import { drawPlayer } from './view/playerView.js';
import { drawField } from './view/scoopsView.js';
import { dayCycleState, nightCycleState } from './game/dayCycle.js';
import { PowerUps } from './game/powerups.js';
import { EventBus } from './engine/events.js';
import { Recipes } from './game/recipes.js';
import { Challenges } from './game/challenges.js';
import { responsiveDims, fitRect } from './engine/viewport.js';
import { makeMode } from './game/modes/index.js';
import { TouchControls } from './engine/touch.js';

/** @typedef {import('./types.js').GameEventMap} GameEventMap */
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

// Physics step: deterministic per-frame integration. The render loop accumulates
// real time and runs as many fixed steps as fit. Effects are visual-only and
// stay variable-step.
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;

// Between-wave reset beat: a sped-up night cycle (sunset→midnight→dawn, crescent
// moon arcing across) that plays after the cashout and before the wave overlay.
const NIGHT_CYCLE_S = 2.0;

// Active power-up indicator timings. When a timed power-up fires its indicator
// floats UP into the "active" slot (where its countdown lives); when it ends —
// or is replaced by a fresh one — it slides off to the LEFT, taking PU_LEAVE_S.
const PU_LEAVE_S = 0.3;
// Entrance for the active power-up indicator: it ARCS up from the cone (a lobbed
// quadratic), holds briefly + large at a mid waypoint, then settles down to its
// resting slot while shrinking. Phase boundaries are fractions of anim.
const ACTIVE_SLIDE_S = 0.7;
const ACTIVE_ARC_FRAC = 0.45;    // 0..this: arc up-and-over to the mid waypoint
const ACTIVE_PAUSE_FRAC = 0.6;   // arc-frac..this: slight hold at the waypoint
// (this..1: settle down to the resting slot, shrinking)

// Map a power-up type to the timed effect it runs. Heart is absent — it heals
// instantly and never occupies the active slot.
const PICKUP_TO_POWER = {
  [PICKUP_TYPE.FEATHER]: POWERUP_TYPE.SPEED,
  [PICKUP_TYPE.PAUSE]:   POWERUP_TYPE.PAUSE,
  [PICKUP_TYPE.RAINBOW]: POWERUP_TYPE.RAINBOW
};

export class Game {
  constructor() {
    this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    // #stage is the container the canvas + HUD live in; its on-screen rect is
    // recomputed in _resize. The virtual canvas always tracks the viewport
    // aspect (clamped to portrait) so it fills the screen on mobile — there's
    // no forced-aspect / letterbox mode anymore.
    this.stage = document.getElementById('stage');
    const _d = responsiveDims(window.innerWidth, window.innerHeight);
    /** @type {{ width: number, height: number }} Virtual (logical) play area. */
    this.bounds = { width: _d.width, height: _d.height };
    // Smoothed frames-per-second for the debug overlay.
    this.fps = 60;

    this.recipes = new Recipes();
    this.challenges = new Challenges(this.recipes);
    // Toast at bottom-centre whenever a challenge requirement is hit mid-
    // play. Wired before HUD construction so HUD can be the receiver.
    this.challenges.onEarned = ch => this.hud && this.hud.showChallengeToast(ch);
    // Gameplay is paused while the between-wave overlay is animating
    // cross-offs / showing the countdown. See _beginWaveTransition.
    this.inWaveTransition = false;
    // Wave-end cashout animation (combo bank + stack pops). Gameplay stepping
    // is frozen while this runs, but effects keep updating so the particles
    // animate. See _runWaveCashout.
    this.inCashout = false;
    // Between-wave night-cycle reset (runs after the wave overlay is dismissed,
    // right before the next wave). nightT drives the fast sky sweep + moon arc.
    this.inNightCycle = false;
    this.nightT = 0;
    // Dedicated "Esc" pause menu — separate from the debug-panel pause.
    this.inPauseMenu = false;
    this.hud = new Hud({
      scoreEl:    document.getElementById('score'),
      comboEl:    document.getElementById('combo'),
      healthFillEl: document.getElementById('health-fill'),
      overlayEl:  document.getElementById('overlay'),
      gaugeEl:    document.getElementById('gauge'),
      flashEl:    document.getElementById('screen-flash'),
      recipesOverlayEl: document.getElementById('recipesOverlay'),
      challengesOverlayEl: document.getElementById('challengesOverlay'),
      settingsOverlayEl: document.getElementById('settingsOverlay'),
      waveTransitionOverlayEl: document.getElementById('waveTransitionOverlay'),
      pauseOverlayEl: document.getElementById('pauseOverlay'),
      challengeToastEl: document.getElementById('challengeToast'),
      recipes:    this.recipes,
      challenges: this.challenges,
      sound:      this.sound,
      onStart:    () => this.start(),
      onHowToPlay: () => this.start(true),  // replays the tutorial on demand
      getVolume:  () => this.sound.volume,
      onSetVolume: v => this.sound.setVolume(v),
      getSensitivity: () => this.touchGain,
      onSetSensitivity: g => this.setTouchGain(g),
      getHaptics: () => this.haptics.enabled,
      onSetHaptics: v => this.haptics.setEnabled(v),
      onResetProgress: () => this._resetProgress(),
      onPauseToggle: () => this._togglePause()
    });
    this.input   = new Input();
    this.sound   = new Sound();
    this.haptics = new Haptics();
    this.effects = new Effects();
    /** @type {EventBus<GameEventMap>} */
    this.bus = new EventBus();

    // The game mode (Tipping) lives in its own file (modes/tipping.js) and owns
    // board size, the tip-sourced power-ups, the tray verbs, the active slot, and
    // the tutorial. game.js DELEGATES to this.mode — it never branches on a mode
    // id. Resolved below (via makeMode) once the actors it reaches into exist.
    // Delivery method (debug-switchable): how a tray serves an order.
    // 'any' = top scoop fills any remaining color (default); 'sequential' = top
    // must be the next color in order; 'whole' = the whole tray must equal the
    // order, delivered in one action.
    this.deliveryMode = DELIVERY_MODE.ANY;
    /** @type {number | null} */
    this.spawnIntervalOverride = null;
    // Combo breaker: the score combo doubles as a charge meter — at this many
    // chained serves it "breaks" into a supercharged power-up. A per-mode
    // capability (comboBreakerEnabled, set by _applyModeConfig from the mode's
    // `comboBreaker`) defaulted on for Tipping; toggle + threshold are debug-tunable.
    this.comboBreakerThreshold = COMBO_BREAKER_THRESHOLD;
    this.comboBreakerEnabled = false;
    this.maxStack = MAX_STACK;  // re-set per mode by _applyModeConfig below

    this.waves       = new Waves(
      () => this.challenges.unlockedSectionIds(),
      id => this.recipes.isDiscovered(id)
    );
    this.powerups    = new PowerUps();
    this.player      = new Player(0, 0);
    this.field       = new ScoopField();
    this.shop        = new Shop(this.waves);
    this.stations    = new Stations();

    // Power-up economy config (debug-tunable, persists across game starts since
    // it lives on Game, not the rebuilt mode). `powerupWeights` is the relative
    // mix of heart/⚡/❄️/🌈 (aligned to PICKUP order); `tipGap{Min,Max}` is the
    // seconds-between-tips range the tip roller reads. Power-ups arrive as
    // customer tips + the combo breaker — there is no bubble lane.
    this.powerupWeights = PICKUP_WEIGHTS.slice();
    this.tipGapMin = PICKUP_SPAWN_MIN_S;
    this.tipGapMax = PICKUP_SPAWN_MAX_S;

    // Resolve the mode now that the actors it reaches into exist, then its
    // tutorial. _applyModeConfig pushes its board size + breaker capability.
    this.mode        = makeMode(this);
    this.tutorial    = this.mode.makeTutorial();

    // Couple supply to demand: the scoop field biases its incoming queue
    // toward colors the shop still needs.
    this.field.setDemandSource(() => this.shop.demandColors(this.player.colors()));
    // Some customers arrive with a tip (power-up or coin); the mode's roller
    // decides per spawn, reading the tip-gap + mix config above.
    this.shop.setTipRoller(() => this.mode.rollTip());
    this._applyModeConfig();  // apply the active mode's board size + capabilities

    /** @type {{ text: string, t: number } | null} */
    this.banner = null;

    this.input.onPop = () => this._pop();
    this.input.onDeliver = () => this._deliver();
    this.input.onUsePower = type => this._usePower(type);
    this.input.onDebugDamage = () => this._debugDamage();
    this.input.onPause = () => this._togglePause();

    // Relative drag is the only touch-steering scheme: small thumb travel moves
    // the cone far, scaled by touchGain (the "Movement sensitivity" Settings
    // slider). It's the least-fatiguing one-handed control; the discrete verbs
    // (tap to serve, swipe up to toss) are independent of it. Keyboard stays live.
    this.touchGain = this._loadTouchGain();

    // Native touch layer (also handles mouse/pen). Reports raw gestures; the
    // handlers below apply relative steering + map the verbs. The down-swipe is
    // unused in Tipping (no rotate verb), so it's a no-op.
    this.touch = new TouchControls(this.canvas, {
      toVirtual: (cx, cy) => this._toVirtual(cx, cy),
      onHold: () => { this.input.lastWasTouch = true; },
      onHoldEnd: () => {},
      onMove: (_vx, dvx) => { this.input.moveDelta += dvx * this.touchGain; },
      onMoveEnd: () => {},
      onTap: () => this._deliver(),
      onSwipeUp: () => this._pop(),
      onSwipeDown: () => {}
    });

    // Power-ups fire the instant they're granted (a customer tip or the combo
    // breaker). Heart heals on the spot; the three timed power-ups
    // (speed / freeze / rainbow) are mutually exclusive — a new one replaces
    // whatever is currently running. The single "active" indicator below mirrors
    // the running timed power-up (its countdown ring); null when none is up.
    /** @type {{ type: PickupTypeName, fromX: number, fromY: number, anim: number } | null} */
    this.activeBubble = null;
    // Indicators mid-slide-off to the left (a finished or just-replaced power-up).
    /** @type {{ type: PickupTypeName, x: number, y: number, r0: number, t: number }[]} */
    this.puLeaving = [];
    // First-time onboarding flag (persisted). When true, hint overlays play
    // over Wave 0; the "How to Play" button forces them anytime.
    this.showTutorial = this._loadShowTutorial();
    // Free-running clock (seconds) for HUD pulse/flash animations.
    this.clock = 0;
    // Whether the tutorial "day meter" callout is currently shown (so we only
    // toggle the DOM on transitions, not every frame).
    this._dayHintShown = false;

    this.health = MAX_HEALTH;
    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.hurt = 0;

    this.flags = {
      patternTimer: true, invincible: false, pickupKeys: false,
      showHitboxes: false, showFps: false
    };
    // Debug patience override (seconds). null = follow the wave ramp.
    /** @type {number | null} */
    this.patienceOverride = null;
    this.debug = new DebugPanel(this.flags, {
      onPauseChange: open => { this.paused = open; },
      onWaveJump: n => this._jumpToWave(n),
      onTimeJump: f => this._jumpToTime(f),
      getWaveFraction: () => this.waves.waveFraction,
      onDemandBias: v => this.field.setDemandBias(v),
      getDemandBias: () => this.field.demandBias,
      onPatience: sec => { this.patienceOverride = sec; },
      getPatience: () => this.patienceOverride != null
        ? this.patienceOverride
        : Math.round(this.waves.tuning().patience),
      onTipGap: (min, max) => this.setTipGap(min, max),
      getTipGap: () => ({ min: this.tipGapMin, max: this.tipGapMax }),
      onPowerupWeights: weights => this.setPowerupWeights(weights),
      getPowerupWeights: () => this.powerupWeights,
      onTutorialFlag: v => this.setShowTutorial(v),
      getTutorialFlag: () => this.showTutorial,
      onDeliveryMode: name => { this.deliveryMode = name; },
      getDeliveryMode: () => this.deliveryMode,
      onMaxStack: n => { this.maxStack = Math.max(1, Math.round(n)); },
      getMaxStack: () => this.maxStack,
      onMaxLive: n => this.field.setMaxLive(n),
      getMaxLive: () => this.field.maxLive,
      onSpawnInterval: sec => { this.spawnIntervalOverride = sec; },
      getSpawnInterval: () => this.spawnIntervalOverride != null
        ? this.spawnIntervalOverride
        : this.waves.tuning().spawnInterval,
      onFallSpeed: m => this.field.setFallScale(m),
      getFallSpeed: () => this.field.fallScale,
      onComboBreaker: n => { this.comboBreakerThreshold = Math.max(2, Math.round(n)); },
      getComboBreaker: () => this.comboBreakerThreshold,
      onComboBreakerToggle: on => { this.comboBreakerEnabled = on; this._syncComboHud(); },
      getComboBreakerEnabled: () => this.comboBreakerEnabled
    });

    // Recipes unlocked / mastered during this play session — drained on
    // game over to drive the celebration overlay.
    /** @type {{ unlocked: string[], mastered: string[] }} */
    this.sessionRecipeEvents = { unlocked: [], mastered: [] };

    this._wireEvents();

    // Window resize only re-letterboxes the (unchanged) virtual canvas; the
    // backing store is fixed per aspect. Fullscreen is just a bigger viewport.
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('fullscreenchange', () => this._resize());
    const fsBtn = document.getElementById('fullscreenBtn');
    if (fsBtn) fsBtn.addEventListener('click', () => this._toggleFullscreen());

    this._applyAspect();
  }

  /**
   * Size the canvas backing store to the virtual resolution, reposition every
   * actor against the bounds, then fit the stage to the viewport. Called once on
   * construction; ongoing viewport changes go through _resize.
   */
  _applyAspect() {
    this.canvas.width = this.bounds.width;
    this.canvas.height = this.bounds.height;
    this.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
    this.stations.layout(this.bounds);
    this.shop.layout(this.bounds.width);
    this._resize();
  }

  /**
   * Map a screen-space point (clientX/Y) into virtual canvas coordinates,
   * via the live #stage rect. Used by the touch layer to steer the cone.
   * @param {number} clientX @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  _toVirtual(clientX, clientY) {
    const rect = this.stage.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    return {
      x: (clientX - rect.left) / w * this.bounds.width,
      y: (clientY - rect.top) / h * this.bounds.height
    };
  }

  _toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  /**
   * Debug: fast-forward to wave N. Resets phase progress but leaves the
   * shop's existing customers — they'll reconcile against the new wave's
   * active count on the next update tick.
   * @param {number} n
   */
  _jumpToWave(n) {
    if (!this.running) return;
    this.waves.jumpToWave(n);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);
    this.shop.setOrderTime(this.waves.tuning().patience);
    // jumpToWave floors to wave ≥ 1, so leave the Wave 0 bias behind.
    this.field.setDemandBias(SPAWN_DEMAND_BIAS);
  }

  /**
   * Debug: scrub to a wave-fraction (0..1). Updates the gauge so the HUD
   * reflects the jump. The canvas redraws every frame even while paused,
   * so the sun and sky also update live as the slider is dragged.
   * @param {number} fraction
   */
  _jumpToTime(fraction) {
    if (!this.running) return;
    this.waves.jumpToFraction(fraction);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);
  }

  /**
   * Debug (T key): inflict one expire's worth of damage on the player.
   * Gated by the same cheat flag as Q/W/E/R so it doesn't trigger by
   * accident — open the Debug panel and tick "Cheat keys: Q/W/E/R" first.
   */
  _debugDamage() {
    if (!this.running || this.paused) return;
    if (!this.flags.pickupKeys) return;
    if (this.flags.invincible) return;
    this.health = Math.max(0, this.health - DAMAGE_PER_EXPIRE);
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.effects.addShake(10);
    this.hurt = 0.35;
    this.sound.expire();
    if (this.health <= 0) this._endGame('Out of health! 😱');
  }

  /** Settings: wipe challenges + recipes back to a fresh save. */
  _resetProgress() {
    this.challenges.reset();
    this.recipes.reset();
  }

  /**
   * Esc: toggle the pause menu. Suppressed during the wave-transition flow
   * (don't let two pause overlays stack) and while the game isn't running
   * (Esc on the start / game-over screen would be confusing).
   */
  _togglePause() {
    if (!this.running) return;
    if (this.inWaveTransition) return;
    if (this.inPauseMenu) {
      this.inPauseMenu = false;
      this.hud.hidePauseMenu();
    } else {
      this.inPauseMenu = true;
      this.hud.showPauseMenu({ onResume: () => this._togglePause() });
    }
  }

  // All cross-subsystem reactions live here: sound + effects + HUD respond to
  // high-level game events. Game logic just mutates state and emits.
  _wireEvents() {
    this.bus.on('catch', ({ scoop, perfect }) => {
      if (perfect) {
        const top = { x: scoop.x, y: this.player.stackTopY() };
        this.sound.perfect();
        this.haptics.catch_();
        this.effects.burst(top.x, top.y, ['#fff', this.shop.hex(scoop.color)], 10);
        this.effects.popText(top.x, top.y - 24, 'Perfect!', { color: '#ffec5c', size: 22, life: 0.7 });
        this.player.triggerFlash(0.25);
      } else {
        this.sound.catch_();
      }
    });

    this.bus.on('trayFull', () => {
      this.sound.bad();
      this.haptics.error();
      this.effects.addShake(8);
      this.hurt = 0.2;
    });

    this.bus.on('serve', ({ gained, colors, combo, x, y }) => {
      this.effects.burst(x, y, colors.map(c => this.shop.hex(c)));
      this.effects.popText(x, y, `+${gained}`, { color: '#ffec5c', size: 28 });
      if (combo > 1) {
        this.effects.popText(x, y - 30, `${combo}× combo!`, { color: '#ff6fa3', size: 20, life: 0.8 });
      }
      this.player.triggerFlash();
      this.effects.addShake(6);
      this.sound.match();
      this.haptics.serve();
    });

    this.bus.on('serveFail', () => {
      this.sound.bad();
      this.haptics.error();
      this.effects.addShake(4);
    });

    this.bus.on('expire', () => {
      this.sound.expire();
      this.haptics.expire();
      this.effects.addShake(12);
      this.hurt = 0.35;
    });

    this.bus.on('phaseUp', () => {
      this.hud.flashPhaseUp();
      this.sound.phaseUp();
      this.haptics.phaseUp();
      this.effects.addShake(4);
      const c = this.hud.gaugeCenter();
      if (c) this.effects.burst(c.x, c.y, ['#ffd166', '#fff'], 14);
    });

    this.bus.on('waveUp', () => {
      // The "WAVE N!" banner moved to the next-wave START (see the night-cycle
      // completion in _loop) so it lands after the recap modal, not before it.
      this.hud.setGauge(this.waves.wave, 1);
      this.hud.flashWaveUp();
      this.sound.levelUp();
      this.haptics.wave();
      this.effects.addShake(14);
      const c = this.hud.gaugeCenter();
      if (c) this.effects.burst(c.x, c.y, ['#ffec5c', '#ffd166', '#ff6fa3', '#7fe3c4'], 60);
    });
  }

  /**
   * Re-derive the virtual canvas from the viewport aspect (so it fills the
   * screen edge-to-edge on mobile); when the dims change the backing store is
   * resized and actors are repositioned. Then fit #stage over the viewport —
   * fitRect with a matching aspect yields a full-bleed rect; with the portrait
   * cap on a wide desktop it centers the column.
   */
  _resize() {
    if (!this.stage) return;
    const d = responsiveDims(window.innerWidth, window.innerHeight);
    if (d.width !== this.bounds.width || d.height !== this.bounds.height) {
      this.bounds.width = d.width;
      this.bounds.height = d.height;
      this.canvas.width = d.width;
      this.canvas.height = d.height;
      this.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
      this.stations.layout(this.bounds);
      this.shop.layout(this.bounds.width);
    }
    const r = fitRect(window.innerWidth, window.innerHeight, this.bounds.width, this.bounds.height);
    this.stage.style.left = `${r.left}px`;
    this.stage.style.top = `${r.top}px`;
    this.stage.style.width = `${r.width}px`;
    this.stage.style.height = `${r.height}px`;
  }

  /** @param {boolean} [forceTutorial] play the tutorial regardless of the flag (How to Play) */
  start(forceTutorial = false) {
    this.sound.resume();
    this.hud.hideOverlay();
    this.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
    this.player.clearStack();
    this.field.reset();
    this.powerups.reset();
    this.effects.reset();
    this.stations.layout(this.bounds);
    this.shop.layout(this.bounds.width);
    // Wave 0 (the tutorial wave) only plays until the first challenge set is
    // cleared — after that we jump straight to Wave 1. "How to Play" and the
    // debug "force tutorial" flag override and replay it.
    const playWave0 = forceTutorial || this.showTutorial || !this.challenges.firstSetCleared();
    this.waves.reset(playWave0 ? 0 : 1);
    this.shop.setOrderTime(this.waves.tuning().patience);
    this.shop.reset();
    this.health = MAX_HEALTH;
    this.hurt = 0;
    this.running = true;
    this.inWaveTransition = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this.nightT = 0;
    this.activeBubble = null;
    this.puLeaving.length = 0;
    this.input.moveDelta = 0;  // drop any stale touch-steer state
    // Rebuild the mode + its tutorial for a fresh run.
    this.mode = makeMode(this);
    this.mode.reset();
    this.tutorial = this.mode.makeTutorial();
    this._applyModeConfig();  // apply the active mode's board size + capabilities
    // Wave 0 (the opening tutorial wave) leans harder toward demanded colors.
    this.field.setDemandBias(this.waves.wave === 0 ? WAVE0_DEMAND_BIAS : SPAWN_DEMAND_BIAS);
    this.lastTime = 0;
    this.accumulator = 0;
    this.banner = null;
    // Fresh recipe-event slate per session — drained on game over.
    /** @type {{ unlocked: string[], mastered: string[] }} */
    this.sessionRecipeEvents = { unlocked: [], mastered: [] };
    this.challenges.resetSession();

    this.hud.setScore(this.shop.score);
    this._syncComboHud();
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);

    // Onboarding hints overlay the real Wave 0 (no freeze) — only when Wave 0
    // is actually in play.
    this.player.frozen = false;
    if (playWave0) this.tutorial.start(this);
    this._syncDayHint();

    requestAnimationFrame(t => this._loop(t));
  }

  // Debug "force Wave 0 tutorial" override (persisted). Default OFF — whether
  // the tutorial plays is normally decided by challenge progress
  // (challenges.firstSetCleared); this flag just lets a tester force it.
  _loadShowTutorial() {
    try { return localStorage.getItem('scoop.showTutorial') === '1'; } catch { return false; }
  }

  /** @param {boolean} v */
  setShowTutorial(v) {
    this.showTutorial = v;
    try { localStorage.setItem('scoop.showTutorial', v ? '1' : '0'); } catch {}
  }

  // Movement sensitivity = the relative-drag gain, persisted. The Settings
  // slider drives setTouchGain; both clamp to the slider's range.
  _loadTouchGain() {
    try {
      const v = parseFloat(localStorage.getItem('scoop.touchGain') || '');
      return Number.isFinite(v) ? Math.max(0.5, Math.min(5, v)) : 2.0;
    } catch { return 2.0; }
  }

  /** @param {number} g */
  setTouchGain(g) {
    this.touchGain = Math.max(0.5, Math.min(5, g));
    try { localStorage.setItem('scoop.touchGain', String(this.touchGain)); } catch {}
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

  /**
   * Show the "day meter" tutorial callout exactly while the tutorial is active.
   * Guarded so the DOM only changes on transitions, not every frame.
   */
  _syncDayHint() {
    const want = this.tutorial.active;
    if (want === this._dayHintShown) return;
    this._dayHintShown = want;
    this.hud.setDayHint(want);
  }

  /** @param {DOMHighResTimeStamp} t */
  _loop(t) {
    if (!this.lastTime) this.lastTime = t;
    const frame = Math.min(MAX_FRAME, (t - this.lastTime) / 1000);
    this.lastTime = t;

    // Smoothed FPS for the debug overlay (EMA). Guard against the first frame.
    if (frame > 0) this.fps = this.fps * 0.9 + (1 / frame) * 0.1;
    this.clock += frame;

    const stepping = this.running && !this.paused && !this.inWaveTransition &&
      !this.inPauseMenu && !this.inCashout && !this.inNightCycle;
    if (stepping) {
      this.accumulator += frame;
      while (this.accumulator >= FIXED_DT) {
        this._step(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
    }
    // Between-wave night cycle: a fast sunset→midnight→dawn sweep (moon arcs
    // across) that plays after the overlay is dismissed; when it lands the
    // freeze lifts and the next wave resumes.
    if (this.inNightCycle) {
      this.nightT += frame / NIGHT_CYCLE_S;
      if (this.nightT >= 1) {
        this.nightT = 1;
        this.inNightCycle = false;
        // The recap modal + night sweep are done — announce the wave we're now
        // entering. (The banner used to fire on completion, ahead of the modal.)
        this.banner = { text: `WAVE ${this.waves.wave}!`, t: 1.6 };
      }
    }
    // Visual-only systems run variable-step — including during the cashout /
    // night-cycle freezes, so particle pops keep animating while play is paused.
    if (stepping || this.inCashout || this.inNightCycle) this.effects.update(frame);
    this._draw();

    if (this.running) requestAnimationFrame(nt => this._loop(nt));
  }

  /** @param {number} dt */
  _step(dt) {
    this.waves.update(dt);
    this.powerups.update(dt);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;

    const tuning = this.waves.tuning();
    // Debug overrides win over the wave ramp; only affect spawns from here on
    // (in-flight customers/scoops keep their values).
    this.shop.setOrderTime(this.patienceOverride != null ? this.patienceOverride : tuning.patience);
    if (this.spawnIntervalOverride != null) tuning.spawnInterval = this.spawnIntervalOverride;
    this.player.update(dt, this.input, this.bounds, this.powerups.speedMultiplier);
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);

    const hitbox = this.player.catchHitbox();
    // Missed scoops fall past the cone and dissolve down in the sand (below the
    // ground line), so the fizzle reads as the scoop landing/melting into the
    // floor rather than vanishing at the cone tip.
    const missY = this.stations.groundY + SCOOP_RADIUS * 2;

    // The falling field + bubbles run during the tutorial now — Wave 0 is a
    // real, playable wave; the tutorial only overlays hints on top of it.
    this.field.update(dt, this.bounds, tuning, missY, scoop => {
      if (!isCaught(scoop, hitbox)) return false;
      const perfect = Math.abs(scoop.x - hitbox.x) <= PERFECT_CATCH_BAND;
      this._onCatch(scoop, perfect);
      return true;
    });

    if (this.tutorial.active) this.tutorial.update(dt, this);
    this._syncDayHint();

    this._stepActive(dt);

    // Patience is frozen during the tutorial so the staged customer never bails.
    const patienceOn = this.flags.patternTimer && !this.powerups.pauseActive && !this.tutorial.active;
    const { expired, comboLost } = this.shop.update(dt, { patienceOn });
    if (expired > 0) this._onExpire(expired);
    if (comboLost) this.sound.bad();
    this._syncComboHud();
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);
    // The running power-up's countdown lives in the on-canvas "active" slot at
    // the bottom (see _drawActivePowerup).
  }

  /**
   * Apply the mode's load-time settings (board size + combo-breaker capability).
   * The single place mode defaults land; debug sliders can still override
   * afterward. Called on construction and each game start.
   */
  _applyModeConfig() {
    this.maxStack = this.mode.maxStack;
    this.field.setMaxLive(this.mode.maxLive);
    this.comboBreakerEnabled = this.mode.comboBreaker;
  }

  /**
   * Apply a power-up's effect at (x, y): heart heals instantly and is
   * orthogonal (never disturbs a running timed power-up); the three timed types
   * replace whatever is running (mutual exclusion via PowerUps.trigger) and
   * float into the active slot. Driven by tip grants + the combo breaker.
   * @param {import('./types.js').PickupTypeName} type
   * @param {number} x @param {number} y
   * @param {number} [durationMult] scale the timed power-up's duration (combo
   *   breaker passes > 1 to supercharge it). Ignored by the instant heart heal.
   */
  _firePower(type, x, y, durationMult = 1) {
    // Single seam for "a power-up was used" — every source (tip, combo-breaker)
    // flows through here, so this is the one place challenge tracking counts it.
    this.challenges.recordPowerupUsed(type);
    if (type === PICKUP_TYPE.HEART) {
      if (!this.flags.invincible) {
        this.health = Math.min(MAX_HEALTH, this.health + HEART_HEAL_AMOUNT);
        this.hud.setHealth(this.health / MAX_HEALTH);
      }
      this.sound.heart();
    } else {
      this._activateBubble(type, x, y);
      this.powerups.trigger(type, durationMult);
      this.sound.powerupTrigger();
    }
    this.haptics.powerup();
    this._powerupUseFx(type, x, y);
  }

  /**
   * Use FX — type-specific burst + popText, fired at the cone when a power-up
   * triggers on catch.
   * @param {PickupTypeName} type
   * @param {number} x @param {number} y
   */
  _powerupUseFx(type, x, y) {
    switch (type) {
      case PICKUP_TYPE.HEART:
        this.effects.burst(x, y, ['#ff6fa3', '#fff', '#ffd166'], 20);
        this.effects.popText(x, y - 10, `+${HEART_HEAL_AMOUNT} ❤`, { color: '#ff6fa3', size: 24 });
        break;
      case PICKUP_TYPE.FEATHER:
        this.effects.burst(x, y, ['#bfdcff', '#fff'], 16);
        this.effects.popText(x, y - 10, 'Speed!', { color: '#5cb8ff', size: 24 });
        break;
      case PICKUP_TYPE.PAUSE:
        this.effects.burst(x, y, ['#c9b6ff', '#fff'], 16);
        this.effects.popText(x, y - 10, 'Frozen!', { color: '#b69aff', size: 24 });
        break;
      case PICKUP_TYPE.RAINBOW:
        this.effects.burst(x, y, ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'], 30);
        this.effects.popText(x, y - 10, 'Rainbow!', { color: '#ffb703', size: 26 });
        break;
    }
    this.player.triggerFlash(0.2);
  }

  /**
   * Q/W/E/R is a debug-only cheat: synthesizes a pickup catch at the cone so
   * testers can trigger any effect on demand. Gated on the pickupKeys flag —
   * when it's off these keys do nothing (silently, so a player who hits them
   * isn't punished with a "nope" beep for a binding that isn't theirs to use).
   * @param {import('./types.js').PickupTypeName} type
   */
  _usePower(type) {
    if (!this.running || this.paused) return;
    if (!this.flags.pickupKeys) return;
    this._firePower(type, this.player.x, this.player.stackTopY());
  }

  _onCatch(scoop, perfect) {
    if (this.player.stack.length >= this.maxStack) {
      this.bus.emit('trayFull', /** @type {any} */ ({}));
      return;
    }
    this.player.push(scoop.color);

    if (perfect) {
      this.shop.addScore(PERFECT_CATCH_BONUS);
      this.shop.refreshCombo();
      this.hud.setScore(this.shop.score);
      this._syncComboHud();
    }
    this.bus.emit('catch', { scoop, perfect });
  }

  /** Spit out the top scoop (discard) — the Tipping upward gesture. */
  _discardTop() {
    const stack = this.player.stack;
    if (stack.length === 0) { this.sound.bad(); return; }
    const pos = this.player.scoopPosition(stack.length - 1);
    const color = stack[stack.length - 1].color;
    this.player.popTop();
    this.effects.burst(pos.x, pos.y, [this.shop.hex(color), '#fff'], 10);
    this.sound.catch_();
  }

  /** The upward gesture (swipe up / Space): the mode tosses the top scoop. */
  _pop() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.player.frozen) return;
    this.mode.onSwipeUp(this);
  }

  _deliver() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.player.frozen) return;
    const index = this.shop.customerAt(this.player.x);
    if (index < 0) {
      this.sound.bad();
      return;
    }
    this._serve(index);
  }

  /**
   * Top-down per-scoop delivery: hand the top of the tray to the customer.
   * If they take it, pop the top off the tray and play partial-serve FX
   * (or full completion FX if this finished their order). If they refuse,
   * the scoop stays put — no combo penalty, just a "nope" beep.
   */
  _serve(index) {
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
        this.effects.burst(p.x, p.y, [this.shop.hex(stack[i].color), '#fff'], 8);
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

    // Customer took the top scoop — physically remove it from the tray and
    // queue the flying-scoop animation on the customer's mini-cone.
    this.player.popTop();
    customer.order.served.push({ color: topColor, t: 0, srcX: srcPos.x, srcY: srcPos.y });

    // Cone leans toward the customer's face for a brief moment — the
    // "handing" gesture. Face center is groundY + CUSTOMER_FACE_OFFSET_PX,
    // modulated by their slide-in offset.
    const targetY = this.stations.groundY + CUSTOMER_FACE_OFFSET_PX + customer.yOff;
    this.player.triggerHandoff(customer.x, targetY);

    // Source burst at the cone — same family as the pop burst, so "giving"
    // and "letting go" feel like the same kind of action.
    this.effects.burst(srcPos.x, srcPos.y, [this.shop.hex(topColor), '#fff'], 10);

    if (!result.complete) {
      this.sound.catch_();
      const cy = this.stations.groundY - 60;
      this.effects.popText(customer.x, cy, '✓', { color: '#43aa8b', size: 22, life: 0.5 });
      return;
    }
    this._onOrderComplete(result, customer);
  }

  /**
   * Shared order-completion handling: heal, recipe/challenge tracking, serve
   * FX, tip grant, and the wave-progress event. Called by every delivery mode.
   * @param {{ gained?: number, colors?: import('./types.js').ScoopColor[], event?: string|null, tip?: (import('./types.js').PickupTypeName|'coin'|null) }} result
   * @param {import('./types.js').Customer} customer
   */
  _onOrderComplete(result, customer) {
    const { gained, colors, event } = result;
    const cx = customer.x;
    const cy = this.stations.groundY - 60;

    const targetY = this.stations.groundY + CUSTOMER_FACE_OFFSET_PX + customer.yOff;
    this.player.triggerHandoff(customer.x, targetY);

    this.health = Math.min(MAX_HEALTH, this.health + HEAL_PER_SERVE);

    // Recipe book: record the completion. Stash any first-time-unlocked
    // or just-mastered ids for the game-over celebration overlay. Then
    // forward to challenges so progress trackers update in real time.
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

    this.hud.setScore(this.shop.score);
    this._syncComboHud();
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);

    // Combo breaker: the serve event above already showed the combo at its
    // peak; if that pushed the chain to the threshold, break it now into a
    // supercharged power-up (resets the meter + re-syncs the readout). Enabled
    // per mode (default Tipping-only) — see _applyModeConfig + the mode files.
    // Skipped on the wave-completing serve: the wave cashes the combo out anyway,
    // and firing here would freeze its pop-text behind the between-wave overlay.
    if (this.comboBreakerEnabled && event !== WAVE_EVENT.WAVE_UP &&
        this.shop.combo >= this.comboBreakerThreshold) {
      this._fireComboBreaker(cx, cy);
    }

    if (event === WAVE_EVENT.PHASE_UP) {
      this.bus.emit('phaseUp', /** @type {any} */ ({}));
    } else if (event === WAVE_EVENT.WAVE_UP) {
      this.bus.emit('waveUp', { wave: this.waves.wave });
      // Challenge tracking: new wave reached, and per-wave counters reset
      // (e.g. "pop X bubbles in one wave" starts over).
      this.challenges.recordWaveReached(this.waves.wave);
      this.challenges.recordWaveEnded();
      // Leaving Wave 0 → restore the normal demand bias for the campaign proper.
      if (this.waves.wave === 1) this.field.setDemandBias(SPAWN_DEMAND_BIAS);
      // The wave just completed is (waves.wave - 1) since waves.onServed
      // already incremented. Let the wave-up banner read, then run the
      // cashout animation, which opens the transition overlay when it ends.
      const completedWave = Math.max(1, (this.waves.wave || 1) - 1);
      setTimeout(() => this._runWaveCashout(completedWave), 700);
    }
  }

  /**
   * Push the combo readout to the HUD. In Tipping mode the readout reframes as
   * the combo-breaker charge meter ("N / threshold"); other modes show plain
   * "N× combo". Single seam so every combo change updates consistently.
   */
  _syncComboHud() {
    const target = this.comboBreakerEnabled ? this.comboBreakerThreshold : 0;
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction, target);
  }

  /**
   * Combo breaker: the serve chain hit the threshold. Empty the meter and fire
   * a SUPERCHARGED timed power-up (extended duration) as the earned payoff — a
   * crescendo on a hot streak, not a random pop. No new verb: it discharges
   * automatically. Gated by comboBreakerEnabled (default Tipping-only).
   * @param {number} x @param {number} y burst origin
   */
  _fireComboBreaker(x, y) {
    this.shop.breakCombo();
    const type = this._pickSuperchargeType();
    this._firePower(type, this.player.x, this.player.stackTopY(), COMBO_BREAKER_DURATION_MULT);
    // Crescendo over the normal power-up FX: extra ding, shake, confetti burst.
    this.sound.perfect();
    this.effects.addShake(12);
    this.effects.burst(x, y, ['#ffec5c', '#ff6fa3', '#7fe3c4', '#6a8cff', '#fff'], 36);
    this.effects.popText(x, y - 46, '⚡ SUPERCHARGED!', { color: '#ffec5c', size: 30, life: 1.2 });
    this._syncComboHud();
  }

  /**
   * Pick which timed power-up the breaker supercharges — weighted by the bubble
   * mix (debug weights for ⚡ speed / ❄️ freeze / 🌈 rainbow), uniform if unset.
   * Heart is excluded: it heals instantly, so a duration multiplier is moot.
   * @returns {import('./types.js').PickupTypeName}
   */
  _pickSuperchargeType() {
    const w = this.powerupWeights;
    /** @type {import('./types.js').PickupTypeName[]} */
    const types = [PICKUP_TYPE.FEATHER, PICKUP_TYPE.PAUSE, PICKUP_TYPE.RAINBOW];
    const weights = [w[1] || 0, w[2] || 0, w[3] || 0];
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return types[Math.floor(Math.random() * types.length)];
    let r = Math.random() * total;
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) return types[i];
    }
    return types[types.length - 1];
  }

  /**
   * Wave-end cashout. Freezes gameplay (effects keep animating) and runs a
   * payout chain: bank the combo → pop the tray stack top-to-bottom (+scoop
   * each) → pop the banked queue back-to-front (+3 scoops each) → pop the
   * active bubble for show (no points) → open the wave-transition overlay.
   * @param {number} completedWave
   */
  _runWaveCashout(completedWave) {
    if (!this.running) return;
    this.inCashout = true;

    // Clear the board: pop every scoop still falling and every bubble drifting,
    // so the wave ends on an empty field before the night-cycle reset.
    this._clearFieldFx();

    // Combo bank.
    const combo = this.shop.bankCombo();
    if (combo > 0) {
      const gain = combo * COMBO_CASHOUT_PER;
      this.shop.addScore(gain);
      const c = this.hud.gaugeCenter() || { x: this.bounds.width / 2, y: this.bounds.height * 0.3 };
      this.effects.popText(c.x, c.y, `Combo ×${combo} → +${gain}`, { color: '#ff6fa3', size: 30, life: 1.3 });
      this.effects.burst(c.x, c.y, ['#ff6fa3', '#ffd166', '#fff'], 24);
      this.sound.perfect();
    }
    this._syncComboHud();
    this.hud.setScore(this.shop.score);

    setTimeout(() => this._cashoutStack(completedWave), combo > 0 ? 500 : 150);
  }

  /** Cashout step 1: pop the tray stack top-to-bottom, then the active power-up. */
  _cashoutStack(completedWave) {
    if (!this.running) { this.inCashout = false; return; }
    if (this.player.stack.length === 0) { this._cashoutActive(completedWave); return; }
    const idx = this.player.stack.length - 1;
    const pos = this.player.scoopPosition(idx);
    const color = this.player.stack[idx].color;
    this.player.popTop();
    this.shop.addScore(STACK_CASHOUT_PER_SCOOP);
    this.effects.burst(pos.x, pos.y, [this.shop.hex(color), '#fff'], 14);
    this.effects.popText(pos.x, pos.y - 10, `+${STACK_CASHOUT_PER_SCOOP}`, { color: '#ffec5c', size: 20, life: 0.6 });
    this.hud.setScore(this.shop.score);
    this.sound.catch_();
    setTimeout(() => this._cashoutStack(completedWave), 120);
  }

  /**
   * Cashout step 2: pop the active power-up bubble for show (no points), then
   * open the wave-transition overlay.
   */
  _cashoutActive(completedWave) {
    if (!this.running) { this.inCashout = false; return; }
    const finish = () => {
      this.inCashout = false;
      this._beginWaveTransition(completedWave);
    };
    if (this.activeBubble) {
      const pos = this._activeSlotPos();
      this.effects.burst(pos.x, pos.y, [PICKUP_RING_COLOR[this.activeBubble.type], '#fff'], 22);
      this.sound.bubblePop();
      this.activeBubble = null;
      this.powerups.reset();
      setTimeout(finish, 220);
      return;
    }
    finish();
  }

  /**
   * Pop every falling scoop for the wave-end board clear. Visual only (no
   * points) — the cashout already paid out the tray + combo.
   */
  _clearFieldFx() {
    for (const s of this.field.scoops) {
      if (s.dissolve !== undefined) continue;  // already fizzling out
      this.effects.burst(s.x, s.y, [this.shop.hex(s.color), '#fff'], 10);
    }
    this.field.scoops.length = 0;
    this.sound.bubblePop();
  }

  /**
   * Between-wave reset: the night-cycle sweep that plays AFTER the wave overlay
   * is dismissed (countdown done / Play pressed), right before the next wave
   * resumes. The _loop advances nightT and lifts the freeze when it lands;
   * endCelebration() makes the next wave open at dawn rather than the previous
   * sunset.
   */
  _runNightCycle() {
    if (!this.running) return;
    this.waves.endCelebration();
    this.nightT = 0;
    this.inNightCycle = true;
  }

  /**
   * Pauses gameplay and asks the HUD to run the between-wave overlay:
   * cross-off animation for any earned challenges, optional fade-in of a
   * newly-unlocked set, then a countdown / Play button. Resumes when the
   * HUD calls back.
   * @param {number} completedWave
   */
  _beginWaveTransition(completedWave) {
    if (!this.running) return;
    this.inWaveTransition = true;
    // Effects are frozen during the transition (the loop doesn't update them),
    // so flush any in-flight pop-text / bursts now — otherwise they'd hang
    // motionless behind the overlay until the next wave resumes.
    this.effects.reset();
    this.hud.showWaveTransition({
      completedWave,
      onResume: () => this._endWaveTransition()
    });
  }

  _endWaveTransition() {
    // The countdown expired or the player hit Play — commit any earned
    // challenges, close the overlay, then run the night-cycle reset, which
    // hands off to the next wave when it finishes.
    this.challenges.commitEarned();
    this.inWaveTransition = false;
    this.hud.hideWaveTransition();
    this._runNightCycle();
  }

  _onExpire(count) {
    if (!this.flags.invincible) {
      this.health = Math.max(0, this.health - DAMAGE_PER_EXPIRE * count);
      this.hud.setHealth(this.health / MAX_HEALTH);
    }
    this.bus.emit('expire', { count });
    this._syncComboHud();
    if (this.health <= 0) this._endGame('Out of health! 😱');
  }

  _endGame(title = 'Game Over') {
    this.running = false;
    // Reset transition state in case the player died mid-pause (shouldn't
    // happen, but defensive).
    this.inWaveTransition = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this._dayHintShown = false;
    this.hud.setDayHint(false);
    this.sound.gameOver();
    this.haptics.gameOver();
    this.bus.emit('gameOver', /** @type {any} */ ({}));
    // Commit any earned-but-uncommitted challenges so the game-over screen
    // shows the player's final state. Cross-off animation on the game-over
    // card is a future polish — for now the inline challenges just render
    // their completed state.
    this.challenges.commitEarned();
    this.hud.showGameOver(
      title,
      this.shop.score,
      this.shop.bestCombo,
      this.waves.wave,
      () => this.start(),
      this.sessionRecipeEvents
    );
  }

  _draw() {
    const ctx = this.ctx;
    const { x, y } = this.effects.offset();
    ctx.save();
    ctx.translate(x, y);

    const rainbow = this.powerups.rainbowActive;

    // Background: sky + sun (or the between-wave night cycle: moon + fast sky),
    // then sand on top. Everything after this draws over the floor — actors stay
    // visible even when their positions overlap the sand region.
    if (this.inNightCycle) {
      const nightState = nightCycleState(this.nightT, this.bounds);
      drawNightSky(ctx, this.bounds, nightState);
      drawSand(ctx, this.bounds, nightState);
      drawOcean(ctx, this.bounds, nightState, this.clock);
    } else {
      const dayState = dayCycleState(this.waves.waveFraction, this.bounds);
      drawSkyAndSun(ctx, this.bounds, dayState);
      drawSand(ctx, this.bounds, dayState);
      drawOcean(ctx, this.bounds, dayState, this.clock);
    }

    drawField(ctx, this.field, rainbow);
    drawPlayer(ctx, this.player, rainbow);
    const pausePatience = this.powerups.pauseActive || !this.flags.patternTimer;
    this.stations.draw(ctx, this.shop.list, {
      activeIndex:    this.shop.customerAt(this.player.x),
      canServe:       i => this.shop.canServe(i, this.player.colors(), rainbow, this.deliveryMode),
      hex:            c => this.shop.hex(c),
      pausePatience,
      rainbow,
      time:           this.clock,
      tipLabel:       this.tutorial.active
    });
    // Tutorial hint pills — over the scene but under the effect bursts.
    if (this.tutorial.active) this.tutorial.draw(ctx, this);
    this.effects.draw(ctx);

    if (this.flags.showHitboxes) this._drawHitboxes(ctx);

    if (this.banner) {
      const f = Math.min(1, this.banner.t / 0.4);
      ctx.save();
      ctx.globalAlpha = f;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "bold 64px 'Comic Sans MS', sans-serif";
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.fillStyle = '#fff3c0';
      const bx = this.bounds.width / 2 - x;
      const by = this.bounds.height * 0.32 - y;
      ctx.strokeText(this.banner.text, bx, by);
      ctx.fillText(this.banner.text, bx, by);
      ctx.restore();
    }

    if (this.hurt > 0) {
      ctx.fillStyle = `rgba(230, 57, 70, ${0.35 * (this.hurt / 0.3)})`;
      ctx.fillRect(-x, -y, this.bounds.width, this.bounds.height);
    }

    if (this.paused && this.running) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(-x, -y, this.bounds.width, this.bounds.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⏸ PAUSED', this.bounds.width / 2 - x, this.bounds.height / 2 - y);
    }
    ctx.restore();

    // The active running-power-up indicator (screen-fixed).
    this._drawActivePowerup(ctx);

    // FPS overlay is screen-fixed (drawn after the shake transform is popped).
    if (this.flags.showFps) {
      ctx.save();
      ctx.font = "bold 20px 'Consolas', monospace";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const label = `${Math.round(this.fps)} fps  scoops:${this.field.scoops.length}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(label, 12, 12);
      ctx.fillStyle = '#39ff14';
      ctx.fillText(label, 12, 12);
      ctx.restore();
    }
  }

  /**
   * Float a freshly-caught timed power-up UP into the active slot. If one is
   * already running, bump it out to the left first (the replace-on-catch read).
   * @param {PickupTypeName} type
   * @param {number} fromX  the x the bubble launches from (the cone)
   * @param {number} fromY  the y the bubble launches from (the stack top)
   */
  _activateBubble(type, fromX, fromY) {
    if (this.activeBubble) {
      const pos = this._activeSlotPos();
      this.puLeaving.push({ type: this.activeBubble.type, x: pos.x, y: pos.y, r0: pos.r, t: 0 });
    }
    this.activeBubble = { type, fromX, fromY, anim: 0 };
  }

  /**
   * Per-frame active-slot update: float the running power-up's bubble up and
   * advance the slide-off-left animations. The bubble retires (slides left)
   * once its timed power-up ends.
   * @param {number} dt
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
      const pos = this._activeSlotPos();
      this.puLeaving.push({ type: a.type, x: pos.x, y: pos.y, r0: pos.r, t: 0 });
      this.activeBubble = null;
    }
  }

  /**
   * Active power-up indicator (screen-space, scales with the letterboxed stage):
   * a single bubble at bottom-center showing the running timed power-up with its
   * countdown ring. Nothing is drawn while idle — the indicator only appears
   * when a timed power-up is up. A finished / replaced bubble slides off LEFT.
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawActivePowerup(ctx) {
    if (!this.activeBubble && this.puLeaving.length === 0) return;
    const aslot = this._activeSlotPos();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Bubbles sliding off to the left (finished / replaced).
    for (const lv of this.puLeaving) {
      ctx.globalAlpha = 1 - lv.t;
      this._drawPowerupBubble(ctx, lv.x - lv.t * 70, lv.y, lv.r0 * (1 - 0.5 * lv.t), lv.type, false, -1);
    }
    ctx.globalAlpha = 1;

    // The running power-up's entrance: a lobbed ARC up from the catch point to a
    // mid waypoint (large, with a slight hold), then a settle DOWN to the resting
    // slot while shrinking. The waypoint is ~10% above the rest.
    if (this.activeBubble) {
      const a = this.activeBubble;
      const cx = aslot.x;
      const restY = aslot.y;                              // final rest
      const midY = restY - this.bounds.height * 0.10;     // pause waypoint
      let bx, by, grow;
      if (a.anim < ACTIVE_ARC_FRAC) {
        // Quadratic Bézier with a control point lifted above both ends → a toss.
        const t = a.anim / ACTIVE_ARC_FRAC;
        const e = 1 - (1 - t) * (1 - t);                  // easeOut along the arc
        const u = 1 - e;
        const ctrlX = (a.fromX + cx) / 2;
        const ctrlY = Math.min(a.fromY, midY) - this.bounds.height * 0.15;
        bx = u * u * a.fromX + 2 * u * e * ctrlX + e * e * cx;
        by = u * u * a.fromY + 2 * u * e * ctrlY + e * e * midY;
        grow = 0.5 + 0.9 * e;                             // → ~1.4× by the waypoint
      } else if (a.anim < ACTIVE_PAUSE_FRAC) {
        bx = cx; by = midY; grow = 1.4;                   // slight hold, large
      } else {
        const p = (a.anim - ACTIVE_PAUSE_FRAC) / (1 - ACTIVE_PAUSE_FRAC);
        const e = p * p * (3 - 2 * p);                    // smoothstep settle
        bx = cx;
        by = midY + (restY - midY) * e;
        grow = 1.4 - 0.4 * e;                             // shrink 1.4× → 1.0×
      }
      const pulse = 1 + 0.08 * Math.sin(this.clock * 6);
      const radius = aslot.r * grow * pulse;
      const frac = this.powerups.fraction(PICKUP_TO_POWER[a.type]);
      this._drawPowerupBubble(ctx, bx, by, radius, a.type, true, frac);
    }
    ctx.restore();
  }

  /**
   * The active power-up's resting slot: horizontally centered, at the mode's
   * activeSlotY (~25% up from the bottom). The entrance rises to screen-center
   * before settling here.
   * @returns {{ x: number, y: number, r: number }}
   */
  _activeSlotPos() {
    // r is the RESTING radius; the entrance peaks larger (≈1.4×) at the waypoint.
    return { x: this.bounds.width / 2, y: this.mode.activeSlotY(this.bounds), r: 40 };
  }

  /**
   * One power-up bubble: dark well + colored ring + icon, optional glow and a
   * run-timer arc (ringFrac >= 0 shows the power-up's remaining duration).
   * Assumes textAlign/baseline already centered and globalAlpha set by caller.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y @param {number} radius
   * @param {import('./types.js').PickupTypeName} type
   * @param {boolean} glow
   * @param {number} ringFrac  0..1 to draw the run-timer ring; < 0 to skip it
   */
  _drawPowerupBubble(ctx, x, y, radius, type, glow, ringFrac) {
    const ring = PICKUP_RING_COLOR[type];
    if (glow) { ctx.shadowColor = ring; ctx.shadowBlur = 16; }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (ringFrac >= 0) {
      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = ring;
      ctx.arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + ringFrac * Math.PI * 2);
      ctx.stroke();
    }

    ctx.font = `${Math.floor(radius * 1.05)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(PICKUP_ICONS[type], x, y + 1);
  }

  /**
   * Debug overlay: red collision shapes for falling scoops, the cone (catch +
   * pickup hitboxes), pickups, the dissolve/miss line, and each customer's
   * serve-reach band + face box. Drawn inside the shake transform so it tracks
   * the actors. Toggled via the "Show hitboxes" debug flag.
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawHitboxes(ctx) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff2d2d';

    // Falling scoops — collision circle (skip dissolving ones; uncatchable).
    for (const s of this.field.scoops) {
      if (s.dissolve !== undefined) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, SCOOP_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cone: catch hitbox (solid AABB).
    const cb = this.player.catchHitbox();
    ctx.strokeRect(cb.x - cb.halfW, cb.y - cb.r, cb.halfW * 2, cb.r * 2);

    // Miss / dissolve line.
    const missY = this.stations.groundY + SCOOP_RADIUS * 2;
    ctx.strokeStyle = 'rgba(255,45,45,0.45)';
    ctx.beginPath();
    ctx.moveTo(0, missY);
    ctx.lineTo(this.bounds.width, missY);
    ctx.stroke();

    // Customers: face box + serve-reach band (serve test is x-distance only).
    const groundY = this.stations.groundY;
    for (const c of this.shop.list) {
      const faceY = groundY + CUSTOMER_FACE_OFFSET_PX + c.yOff;
      ctx.strokeStyle = '#ff2d2d';
      ctx.strokeRect(c.x - 46, faceY - 46, 92, 92);
      ctx.strokeStyle = 'rgba(255,45,45,0.4)';
      ctx.strokeRect(c.x - REACH, faceY - 70, REACH * 2, 150);
    }

    ctx.restore();
  }
}

new Game();
