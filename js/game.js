// @ts-check
// Composition root + coordinator. The codebase is split into layers by folder:
//   engine/ — game-agnostic runtime: loop.js (fixed-timestep), input, touch,
//             audio, haptics, viewport, event bus
//   game/   — simulation + rules + data: world.js (the sim), player, scoops,
//             shop, waves, powerups, recipes, challenges, day cycle, modes,
//             config, tuning
//   view/   — rendering: renderer.js (the frame), playerView, scoopsView, scene,
//             stations, effects, HUD
//   reactions.js — domain events → sound/haptics/effects/HUD glue
// Dataflow is one-way: input → World.step(dt) → events → presentation. This file
// owns the glue only: it builds the actors, drives the Loop with
// _stepping/_step/_frame, routes input, runs the wave-flow state machine
// (start → cashout → transition → night cycle), and pulls World state to the HUD
// each frame. The sim (game/world.js), drawing (view/renderer.js), and reactions
// (reactions.js) are delegated.
import {
  MAX_HEALTH,
  COMBO_CASHOUT_PER,
  STACK_CASHOUT_PER_SCOOP,
  SPAWN_DEMAND_BIAS,
  coneYFor
} from './game/config.js';
import { Stations } from './view/stations.js';
import { Hud } from './view/hud.js';
import { Input } from './engine/input.js';
import { Sound } from './engine/audio.js';
import { Haptics } from './engine/haptics.js';
import { Effects } from './view/effects.js';
import { DebugPanel } from './debug.js';
import { drawFrame } from './view/renderer.js';
import { PICKUP_RING_COLOR } from './view/powerupVisuals.js';
import { wireReactions } from './reactions.js';
import { EventBus } from './engine/events.js';
import { responsiveDims, fitRect } from './engine/viewport.js';
import { Loop } from './engine/loop.js';
import { World } from './game/world.js';
import { TouchControls } from './engine/touch.js';

/** @typedef {import('./types.js').GameEventMap} GameEventMap */
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

// Physics step: deterministic per-frame integration. The render loop accumulates
// real time and runs as many fixed steps as fit. Effects are visual-only and
// stay variable-step.
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;
// Cap the RENDER rate. The sim is fixed-step at FIXED_DT (60Hz); on a 90/120Hz
// phone, painting at the display rate just burns GPU/battery for no gameplay gain,
// so the loop throttles rendering to this.
const RENDER_FPS = 60;

// Between-wave reset beat: a sped-up night cycle (sunset→midnight→dawn, crescent
// moon arcing across) that plays after the cashout and before the wave overlay.
const NIGHT_CYCLE_S = 2.0;

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
    // Free-running clock (seconds) for HUD pulse/flash animations.
    this.clock = 0;

    /** @type {EventBus<GameEventMap>} */
    this.bus = new EventBus();

    // Debug cheat/display flags. Shared by reference into the World for the few
    // it reads (invincible, patternTimer); the rest gate debug input here.
    this.flags = {
      patternTimer: true, invincible: false, pickupKeys: false,
      showHitboxes: false, showFps: false
    };

    // Persisted onboarding + control prefs (presentation). Loaded before the HUD
    // and touch layer that read them.
    this.showTutorial = this._loadShowTutorial();
    // Relative drag is the only touch-steering scheme: small thumb travel moves
    // the cone far, scaled by touchGain (the "Movement sensitivity" Settings
    // slider). The discrete verbs (tap to serve, swipe up to toss) are
    // independent of it. Keyboard stays live.
    this.touchGain = this._loadTouchGain();

    // Engine input (keyboard) — the World reads its steering state during step,
    // so it's built before the World.
    this.input = new Input();

    // The simulation: owns the models + progression + sim state, advances them
    // with step(dt), and emits domain events on the shared bus. game.js never
    // reaches into the sim's rules — it reads World state and routes verbs to it.
    this.world = new World(this.bus, this.bounds, this.flags, this.input);

    // HUD reads recipes/challenges (from the World) for its modals. Built before
    // the audio singletons to match the original wiring (the HUD's optional
    // cross-off sound stays off); its volume/haptics/sensitivity getters are lazy.
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
      recipes:    this.world.recipes,
      challenges: this.world.challenges,
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

    this.sound   = new Sound();
    this.haptics = new Haptics();
    this.effects = new Effects();
    // Customer view (faces + speech bubbles). Pure presentation; the renderer
    // draws through it and reads its groundY for the miss line.
    this.stations = new Stations();

    // Presentation tutorial, built from the active mode. Rebuilt each start().
    this.tutorial = this.world.mode.makeTutorial();

    // === Game-flow state machine + frame state (coordinator-owned) ============
    // Gameplay is paused while the between-wave overlay is animating cross-offs /
    // showing the countdown. See _beginWaveTransition.
    this.inWaveTransition = false;
    // Wave-end cashout animation (combo bank + stack pops). Stepping is frozen
    // while this runs, but effects keep updating so the particles animate.
    this.inCashout = false;
    // Between-wave night-cycle reset (runs after the wave overlay is dismissed,
    // right before the next wave). nightT drives the fast sky sweep + moon arc.
    this.inNightCycle = false;
    this.nightT = 0;
    // Dedicated "Esc" pause menu — separate from the debug-panel pause.
    this.inPauseMenu = false;
    // Set once the game-over panel is up. Stepping is dead, but effects keep
    // updating so the death shake tapers off instead of jittering forever (the
    // loop keeps rendering the ambient scene behind the panel).
    this.inGameOver = false;
    /** @type {{ text: string, t: number } | null} */
    this.banner = null;
    this.hurt = 0;
    this.running = false;
    this.paused = false;
    // Whether the tutorial "day meter" callout is currently shown (so we only
    // toggle the DOM on transitions, not every frame).
    this._dayHintShown = false;
    // Fixed-timestep loop (engine). Started in start(), stopped on game over.
    // Render throttled to RENDER_FPS so high-refresh phones don't over-paint.
    this.loop = new Loop(FIXED_DT, MAX_FRAME, RENDER_FPS);

    // Debug panel — its tuning controls forward straight to the World.
    this.debug = new DebugPanel(this.flags, {
      onPauseChange: open => { this.paused = open; },
      onWaveJump: n => this._jumpToWave(n),
      onTimeJump: f => this._jumpToTime(f),
      getWaveFraction: () => this.world.waves.waveFraction,
      onDemandBias: v => this.world.field.setDemandBias(v),
      getDemandBias: () => this.world.field.demandBias,
      onPatience: sec => { this.world.patienceOverride = sec; },
      getPatience: () => this.world.patienceOverride != null
        ? this.world.patienceOverride
        : Math.round(this.world.waves.tuning().patience),
      onTipGap: (min, max) => this.world.setTipGap(min, max),
      getTipGap: () => ({ min: this.world.tipGapMin, max: this.world.tipGapMax }),
      onPowerupWeights: weights => this.world.setPowerupWeights(weights),
      getPowerupWeights: () => this.world.powerupWeights,
      onTutorialFlag: v => this.setShowTutorial(v),
      getTutorialFlag: () => this.showTutorial,
      onDeliveryMode: name => { this.world.deliveryMode = name; },
      getDeliveryMode: () => this.world.deliveryMode,
      onMaxStack: n => { this.world.maxStack = Math.max(1, Math.round(n)); },
      getMaxStack: () => this.world.maxStack,
      onMaxLive: n => this.world.field.setMaxLive(n),
      getMaxLive: () => this.world.field.maxLive,
      onSpawnInterval: sec => { this.world.spawnIntervalOverride = sec; },
      getSpawnInterval: () => this.world.spawnIntervalOverride != null
        ? this.world.spawnIntervalOverride
        : this.world.waves.tuning().spawnInterval,
      onFallSpeed: m => this.world.field.setFallScale(m),
      getFallSpeed: () => this.world.field.fallScale,
      onComboBreaker: n => { this.world.comboBreakerThreshold = Math.max(2, Math.round(n)); },
      getComboBreaker: () => this.world.comboBreakerThreshold,
      onComboBreakerToggle: on => { this.world.comboBreakerEnabled = on; this._syncComboHud(); },
      getComboBreakerEnabled: () => this.world.comboBreakerEnabled
    });

    // Input routing: discrete verbs are guarded here, then handed to the World.
    this.input.onPop = () => this._pop();
    this.input.onDeliver = () => this._deliver();
    this.input.onUsePower = type => this._usePower(type);
    this.input.onDebugDamage = () => this._debugDamage();
    this.input.onPause = () => this._togglePause();

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

    // Presentation reactions: sound/haptics/effects/HUD subscribe to World events.
    wireReactions(this);

    // Flow timing (game-owned, NOT presentation): the wave-end cashout schedule
    // and the game-over teardown react to the sim's events. The sim only DECIDES
    // (emits waveUp / gameOver); the coordinator runs the timed flow.
    this.bus.on('waveUp', ({ wave }) => {
      // The wave just completed is (wave - 1) since waves.onServed already
      // incremented. Let the wave-up banner read, then run the cashout, which
      // opens the transition overlay when it ends.
      const completedWave = Math.max(1, (wave || 1) - 1);
      setTimeout(() => this._runWaveCashout(completedWave), 700);
    });
    this.bus.on('gameOver', () => this._endGame('Out of health! 😱'));

    // Window resize only re-letterboxes the (unchanged) virtual canvas; the
    // backing store is fixed per aspect. Fullscreen is just a bigger viewport.
    // Debounce resize: a mobile URL-bar show/hide fires a burst of resize events,
    // and each dim change reallocates the canvas backing store (a black flash) +
    // repositions actors. Coalesce the burst into a single resize once it settles.
    let _resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = /** @type {any} */ (setTimeout(() => this._resize(), 150));
    });
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
    this.world.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
    this.stations.layout(this.bounds);
    this.world.shop.layout(this.bounds.width);
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
   * Debug: fast-forward to wave N. Resets phase progress but leaves the shop's
   * existing customers — they'll reconcile against the new wave's active count
   * on the next update tick. The HUD catches up on the next frame's _syncHud.
   * @param {number} n
   */
  _jumpToWave(n) {
    if (!this.running) return;
    this.world.waves.jumpToWave(n);
    this.world.shop.setOrderTime(this.world.waves.tuning().patience);
    // jumpToWave floors to wave ≥ 1, so leave the Wave 0 bias behind.
    this.world.field.setDemandBias(SPAWN_DEMAND_BIAS);
  }

  /**
   * Debug: scrub to a wave-fraction (0..1). The canvas redraws every frame even
   * while paused, so the sun, sky, and gauge update live as the slider is dragged.
   * @param {number} fraction
   */
  _jumpToTime(fraction) {
    if (!this.running) return;
    this.world.waves.jumpToFraction(fraction);
  }

  /**
   * Debug (T key): inflict one expire's worth of damage on the player. Gated by
   * the same cheat flag as Q/W/E/R so it doesn't trigger by accident. Routes
   * through the real expire path so damage, the expire reaction, and the
   * game-over decision all live in one place.
   */
  _debugDamage() {
    if (!this.running || this.paused) return;
    if (!this.flags.pickupKeys) return;
    if (this.flags.invincible) return;
    this.world.onExpire(1);
  }

  /** Settings: wipe challenges + recipes back to a fresh save. */
  _resetProgress() {
    this.world.challenges.reset();
    this.world.recipes.reset();
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

  /**
   * Re-derive the virtual canvas from the viewport aspect (so it fills the
   * screen edge-to-edge on mobile); when the dims change the backing store is
   * resized and actors are repositioned. Then fit #stage over the viewport —
   * fitRect with a matching aspect yields a full-bleed rect; with the portrait
   * cap on a wide desktop it centers the column. `bounds` is shared with the
   * World, so resizing it here updates the sim's view of the play area too.
   */
  _resize() {
    if (!this.stage) return;
    const d = responsiveDims(window.innerWidth, window.innerHeight);
    if (d.width !== this.bounds.width || d.height !== this.bounds.height) {
      this.bounds.width = d.width;
      this.bounds.height = d.height;
      this.canvas.width = d.width;
      this.canvas.height = d.height;
      this.world.player.reposition(this.bounds.width / 2, coneYFor(this.bounds.height));
      this.stations.layout(this.bounds);
      this.world.shop.layout(this.bounds.width);
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
    this.effects.reset();
    this.stations.layout(this.bounds);
    // Wave 0 (the tutorial wave) only plays until the first challenge set is
    // cleared — after that we jump straight to Wave 1. "How to Play" and the
    // debug "force tutorial" flag override and replay it.
    const playWave0 = forceTutorial || this.showTutorial || !this.world.challenges.firstSetCleared();
    // Reset the simulation (models + progression-session counters). The mode is
    // rebuilt inside, so re-derive the presentation tutorial from it afterward.
    this.world.reset(playWave0);
    this.tutorial = this.world.mode.makeTutorial();

    this.banner = null;
    this.hurt = 0;
    this.running = true;
    this.inWaveTransition = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = false;
    this.nightT = 0;

    this._syncHud();

    // Onboarding hints overlay the real Wave 0 (no freeze) — only when Wave 0
    // is actually in play.
    if (playWave0) this.tutorial.start(this);
    this._syncDayHint();

    this.loop.start({
      shouldStep: () => this._stepping(),
      step: dt => this._step(dt),
      render: dt => this._frame(dt)
    });
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
   * Per-frame HUD pull: push live sim numbers (score, health, gauge, combo) to
   * the HUD. Numeric HUD is a PULL from World state rather than event-driven, so
   * the readouts stay correct through cashout / debug jumps without event churn.
   */
  _syncHud() {
    this.hud.setScore(this.world.shop.score);
    this.hud.setHealth(this.world.health / MAX_HEALTH);
    this.hud.setGauge(this.world.waves.wave, this.world.waves.waveFraction);
    this._syncComboHud();
  }

  /**
   * Push the combo readout to the HUD. In Tipping mode the readout reframes as
   * the combo-breaker charge meter ("N / threshold"). Single seam so every combo
   * change updates consistently.
   */
  _syncComboHud() {
    const target = this.world.comboBreakerEnabled ? this.world.comboBreakerThreshold : 0;
    this.hud.setCombo(this.world.shop.combo, this.world.shop.comboFraction, target);
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

  /**
   * Gate for the fixed-step pump (the Loop's `shouldStep`). The sim advances only
   * during live play — paused, the between-wave overlay, the pause menu, the
   * cashout, and the night-cycle all freeze it.
   */
  _stepping() {
    return this.running && !this.paused && !this.inWaveTransition &&
      !this.inPauseMenu && !this.inCashout && !this.inNightCycle;
  }

  /**
   * Per-frame variable-step work (the Loop's `render`): smoothed FPS, the free
   * clock, presentation-timer decay, the between-wave night-cycle sweep, visual
   * effects, the HUD pull, the tutorial overlay, and the draw.
   * @param {number} frame seconds since the last frame (clamped by the Loop)
   */
  _frame(frame) {
    // Smoothed FPS for the debug overlay (EMA). Guard against the first frame.
    if (frame > 0) this.fps = this.fps * 0.9 + (1 / frame) * 0.1;
    this.clock += frame;

    // Presentation timers decay on the variable step (they're game-owned, not
    // part of the deterministic sim): the "WAVE N!" banner and the hurt flash.
    if (this.banner && (this.banner.t -= frame) <= 0) this.banner = null;
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - frame);

    // Between-wave night cycle: a fast sunset→midnight→dawn sweep (moon arcs
    // across) that plays after the overlay is dismissed; when it lands the
    // freeze lifts and the next wave resumes.
    if (this.inNightCycle) {
      this.nightT += frame / NIGHT_CYCLE_S;
      if (this.nightT >= 1) {
        this.nightT = 1;
        this.inNightCycle = false;
        // The recap modal + night sweep are done — announce the wave we're now
        // entering.
        this.banner = { text: `WAVE ${this.world.waves.wave}!`, t: 1.6 };
      }
    }
    // Visual-only systems run variable-step — including during the cashout /
    // night-cycle freezes, so particle pops keep animating while play is paused,
    // and during game over so the death shake gently tapers out under the panel.
    if (this._stepping() || this.inCashout || this.inNightCycle || this.inGameOver) this.effects.update(frame);

    // Numeric HUD is a per-frame PULL from sim state. Then advance the
    // presentation-only tutorial overlay + its DOM callout.
    this._syncHud();
    if (this.tutorial.active) this.tutorial.update(frame, this);
    this._syncDayHint();

    drawFrame(this.ctx, this);
  }

  /** @param {number} dt */
  _step(dt) {
    // The tutorial freezes patience; it's presentation, so hand the sim that one
    // boolean each step rather than letting the sim reach the tutorial.
    this.world.tutorialActive = this.tutorial.active;
    this.world.step(dt);
  }

  /** The upward gesture (swipe up / Space): the mode tosses the top scoop. */
  _pop() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.world.player.frozen) return;
    this.world.pop();
  }

  _deliver() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.world.player.frozen) return;
    const index = this.world.shop.customerAt(this.world.player.x);
    if (index < 0) {
      this.sound.bad();
      return;
    }
    this.world.serve(index);
  }

  /**
   * Q/W/E/R is a debug-only cheat: fires any power-up at the cone so testers can
   * trigger an effect on demand. Gated on the pickupKeys flag — when it's off
   * these keys do nothing (silently, so a player who hits them isn't punished).
   * @param {PickupTypeName} type
   */
  _usePower(type) {
    if (!this.running || this.paused) return;
    if (!this.flags.pickupKeys) return;
    this.world.usePower(type);
  }

  /**
   * Wave-end cashout. Freezes gameplay (effects keep animating) and runs a
   * payout chain: bank the combo → pop the tray stack top-to-bottom (+scoop
   * each) → pop the active bubble for show (no points) → open the
   * wave-transition overlay. Reaches into World models — it's a scripted
   * presentation sequence, not part of the deterministic sim step.
   * @param {number} completedWave
   */
  _runWaveCashout(completedWave) {
    if (!this.running) return;
    this.inCashout = true;

    // Clear the board: pop every scoop still falling, so the wave ends on an
    // empty field before the night-cycle reset.
    this._clearFieldFx();

    // Combo bank.
    const combo = this.world.shop.bankCombo();
    if (combo > 0) {
      const gain = combo * COMBO_CASHOUT_PER;
      this.world.shop.addScore(gain);
      const c = this.hud.gaugeCenter() || { x: this.bounds.width / 2, y: this.bounds.height * 0.3 };
      this.effects.popText(c.x, c.y, `Combo ×${combo} → +${gain}`, { color: '#ff6fa3', size: 30, life: 1.3 });
      this.effects.burst(c.x, c.y, ['#ff6fa3', '#ffd166', '#fff'], 24);
      this.sound.perfect();
    }
    this._syncComboHud();

    setTimeout(() => this._cashoutStack(completedWave), combo > 0 ? 500 : 150);
  }

  /** Cashout step 1: pop the tray stack top-to-bottom, then the active power-up. */
  _cashoutStack(completedWave) {
    if (!this.running) { this.inCashout = false; return; }
    if (this.world.player.stack.length === 0) { this._cashoutActive(completedWave); return; }
    const idx = this.world.player.stack.length - 1;
    const pos = this.world.player.scoopPosition(idx);
    const color = this.world.player.stack[idx].color;
    this.world.player.popTop();
    this.world.shop.addScore(STACK_CASHOUT_PER_SCOOP);
    this.effects.burst(pos.x, pos.y, [this.world.shop.hex(color), '#fff'], 14);
    this.effects.popText(pos.x, pos.y - 10, `+${STACK_CASHOUT_PER_SCOOP}`, { color: '#ffec5c', size: 20, life: 0.6 });
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
    if (this.world.activeBubble) {
      const pos = this.world.activeSlotPos();
      this.effects.burst(pos.x, pos.y, [PICKUP_RING_COLOR[this.world.activeBubble.type], '#fff'], 22);
      this.sound.bubblePop();
      this.world.activeBubble = null;
      this.world.powerups.reset();
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
    for (const s of this.world.field.scoops) {
      if (s.dissolve !== undefined) continue;  // already fizzling out
      this.effects.burst(s.x, s.y, [this.world.shop.hex(s.color), '#fff'], 10);
    }
    this.world.field.scoops.length = 0;
    this.sound.bubblePop();
  }

  /**
   * Between-wave reset: the night-cycle sweep that plays AFTER the wave overlay
   * is dismissed (countdown done / Play pressed), right before the next wave
   * resumes. _frame advances nightT and lifts the freeze when it lands;
   * endCelebration() makes the next wave open at dawn rather than the previous
   * sunset.
   */
  _runNightCycle() {
    if (!this.running) return;
    this.world.waves.endCelebration();
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
    this.world.challenges.commitEarned();
    this.inWaveTransition = false;
    this.hud.hideWaveTransition();
    this._runNightCycle();
  }

  _endGame(title = 'Game Over') {
    this.running = false;
    this.loop.stop();
    // Reset transition state in case the player died mid-pause (shouldn't
    // happen, but defensive).
    this.inWaveTransition = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = true;
    this._dayHintShown = false;
    this.hud.setDayHint(false);
    this.sound.gameOver();
    this.haptics.gameOver();
    // Commit any earned-but-uncommitted challenges so the game-over screen
    // shows the player's final state.
    this.world.challenges.commitEarned();
    this.hud.showGameOver(
      title,
      this.world.shop.score,
      this.world.shop.bestCombo,
      this.world.waves.wave,
      () => this.start(),
      this.world.sessionRecipeEvents
    );
  }
}

new Game();
