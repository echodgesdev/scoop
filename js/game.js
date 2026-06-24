// @ts-check
// Composition root + coordinator. The codebase is split into layers by folder:
//   engine/ — game-agnostic runtime: loop.js (fixed-timestep), input, touch,
//             audio, haptics, viewport, event bus
//   game/   — simulation + rules + data: world.js (the sim), player, scoops,
//             shop, waves, powerups, recipes, challenges, day cycle, modes,
//             config, tuning
//   ui/     — rendering: renderer.js (the frame), playerView, scoopsView, scene,
//             customers, effects, HUD
//   reactions.js — domain events → sound/haptics/effects/HUD glue
// Dataflow is one-way: input → World.step(dt) → events → presentation. This file
// owns the glue only: it builds the actors, drives the Loop with
// _stepping/_step/_frame, routes input, runs the wave-flow state machine
// (start → cashout → transition → night cycle), and pulls World state to the HUD
// each frame. The sim (game/world.js), drawing (ui/renderer.js), and reactions
// (reactions.js) are delegated.
import {
  MAX_HEALTH,
  COMBO_CASHOUT_PER,
  SPAWN_DEMAND_BIAS,
  CONE_Y
} from './game/config.js';
import { Customers } from './ui/customers.js';
import { Hud } from './ui/hud/hud.js';
import { coinDwellMs } from './ui/hud/coinCarousel.js';
import { Input } from './engine/input.js';
import { Sound } from './engine/audio.js';
import { Haptics } from './engine/haptics.js';
import { Effects } from './ui/effects/effects.js';
import { DebugPanel } from './debug.js';
import { drawFrame } from './ui/renderer.js';
import { PICKUP_RING_COLOR } from './ui/powerupVisuals.js';
import { wireReactions } from './reactions.js';
import { EventBus } from './engine/events.js';
import { Surface } from './engine/surface.js';
import { Loop } from './engine/loop.js';
import { World } from './game/world.js';
import { TouchControls } from './engine/touch.js';

/** @typedef {import('./types.js').GameEventMap} GameEventMap */
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

// Physics step: deterministic per-frame integration. The render loop accumulates
// real time and runs as many fixed steps as fit. Effects are visual-only and
// stay variable-step. Rendering runs at the display's native rate with movers
// interpolated by the loop's alpha — a 60fps render cap was tried and reverted:
// on a 90Hz panel it painted every 2nd vsync (45fps) while the sim stepped at
// 60Hz, so painted frames advanced 1,1,2,1,1,2 steps — visible judder.
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;

// Between-wave reset beat: a sped-up night cycle (sunset→midnight→dawn, crescent
// moon arcing across) that plays after the cashout and before the wave overlay.
const NIGHT_CYCLE_S = 2.8;   // slightly slower: room for the day-start beat (cone recenters, day # rolls over)
// Fresh game start: how long the week's challenges hold in the sky (sim frozen)
// before they dissolve into the round. Between rounds the night sweep covers this.
const INTRO_HOLD_S = 2.2;

// Waffle-cone debris palette for the game-over fracture (tan / caramel / cream chunks).
const CONE_SHARD_COLORS = ['#e8b06a', '#d99a4e', '#c98a3c', '#fff4d6'];

export class Game {
  constructor() {
    // Kick the bundled font (styles.css @font-face) loading immediately so canvas
    // text — bubbles, banners, the countdown — never flashes a fallback before it
    // arrives. The DOM menu would trigger it anyway; this just front-runs it.
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      document.fonts.load("400 16px 'Comic Sans MS'");
      document.fonts.load("700 16px 'Comic Sans MS'");
    }
    // The drawing surface (engine): owns the canvas backing store, the #stage it
    // scales to fill the viewport, and the virtual play-area `bounds`. A viewport
    // change mutates bounds in place and calls back to _relayout (reposition +
    // repaint); the World gets the same bounds reference, so the sim sees size
    // changes for free.
    this.surface = new Surface({
      canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('game')),
      stage: document.getElementById('stage'),
      fullscreenBtn: document.getElementById('fullscreenBtn'),
      onResize: () => this._relayout()
    });
    this.canvas = this.surface.canvas;
    this.ctx = this.surface.ctx;
    /** @type {{ width: number, height: number }} Virtual (logical) play area, shared with the World. */
    this.bounds = this.surface.bounds;
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
      journalOverlayEl: document.getElementById('journalOverlay'),
      settingsOverlayEl: document.getElementById('settingsOverlay'),
      waveTransitionOverlayEl: document.getElementById('waveTransitionOverlay'),
      pauseOverlayEl: document.getElementById('pauseOverlay'),
      challengeToastEl: document.getElementById('challengeToast'),
      recipes:    this.world.recipes,
      challenges: this.world.challenges,
      regulars:   this.world.regulars,
      sound:      this.sound,
      onStart:    () => this.start(),
      onHowToPlay: () => this.start(true),  // replays the tutorial on demand
      getInGame:  () => this.running,       // disables How to Play during an active run
      getVolume:  () => this.sound.volume,
      onSetVolume: v => this.sound.setVolume(v),
      getSensitivity: () => this.touchGain,
      onSetSensitivity: g => this.setTouchGain(g),
      getHaptics: () => this.haptics.enabled,
      onSetHaptics: v => this.haptics.setEnabled(v),
      onResetProgress: () => this._resetProgress(),
      onPauseToggle: () => this._togglePause(),
      onHome: () => this._goHome()
    });

    this.sound   = new Sound();
    this.haptics = new Haptics();
    this.effects = new Effects();
    // Customer view (faces + speech bubbles). Pure presentation; the renderer
    // draws through it and reads its groundY for the miss line.
    this.customers = new Customers();

    // Presentation tutorial, built from the active mode. Rebuilt each start().
    this.tutorial = this.world.mode.makeTutorial();

    // === Game-flow state machine + frame state (coordinator-owned) ============
    // Wave-end cashout animation (combo bank + stack pops). Stepping is frozen
    // while this runs, but effects keep updating so the particles animate.
    this.inCashout = false;
    // Between-day night-cycle reset (runs straight after the cashout — no modal).
    // The sky shows the recap over it; nightT drives the fast sweep + moon arc, and
    // _nightDuration stretches it to fit any coins flipping in.
    this.inNightCycle = false;
    this.nightT = 0;
    this._nightDuration = NIGHT_CYCLE_S;
    // Game-over DEATH sequence: a scripted teardown (pop the tray + field, fracture
    // the cone, walk the angry customers off) that plays with the loop ALIVE but the
    // sim frozen, just before the game-over menu. See _beginDeath.
    this.inDeath = false;
    // True from the moment a day completes (waveUp) until the night sweep lands —
    // while set, the HUD gauge HOLDS the finished day (full) instead of rolling the
    // day number over early. Cleared at night-cycle completion. See _syncHud.
    this._dayRolling = false;
    // Round-start intro: a brief "Week N → 3·2·1·START!" beat that freezes the sim
    // (no scoops/customers) until it ends. Runs at each day's start (after the night
    // sweep) and on the first campaign day; skipped during the scripted tutorial.
    this.inRoundIntro = false;
    this.roundIntroT = 0;
    // Dedicated "Esc" pause menu — separate from the debug-panel pause.
    this.inPauseMenu = false;
    // Set once the game-over panel is up. Stepping is dead, but effects keep
    // updating so the death shake tapers off instead of jittering forever (the
    // loop keeps rendering the ambient scene behind the panel).
    this.inGameOver = false;
    /** @type {{ text: string, t: number } | null} */
    this.banner = null;
    this.running = false;
    this.paused = false;
    // Whether the tutorial "day meter" callout is currently shown + its current
    // text (so we only touch the DOM when the shown-state or text changes).
    this._dayHintShown = false;
    /** @type {string | null} */
    this._dayHintText = null;
    // Fixed-timestep loop (engine). Started in start(), stopped on game over.
    // Renders every animation frame; movers interpolate by the render alpha.
    this.loop = new Loop(FIXED_DT, MAX_FRAME);

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
      // Combo-breaker threshold is fixed (= max combo, COMBO_BREAKER_THRESHOLD);
      // only the on/off toggle remains debug-tunable.
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
      toVirtual: (cx, cy) => this.surface.toVirtual(cx, cy),
      onHold: () => { this.input.lastWasTouch = true; },
      onHoldEnd: () => {},
      onMove: (_vx, dvx) => { this.input.moveDelta += dvx * this.touchGain; },
      onMoveEnd: () => {},
      onTap: () => this._deliver(),
      onSwipeUp: () => this._pop(),
      onSwipeDown: () => {},
      onTossCancel: () => this._tossCancel()
    });

    // Presentation reactions: sound/haptics/effects/HUD subscribe to World events.
    wireReactions(this);

    // Flow timing (game-owned, NOT presentation): the wave-end cashout schedule
    // and the game-over teardown react to the sim's events. The sim only DECIDES
    // (emits waveUp / gameOver); the coordinator runs the timed flow.
    this.bus.on('waveUp', () => {
      // Hold the HUD day number (it rolls over at night-end), let the banner read,
      // then run the cashout, which opens the transition overlay.
      this._dayRolling = true;
      setTimeout(() => this._runWaveCashout(), 700);
    });
    this.bus.on('gameOver', () => this._beginDeath());

    // Resize/fullscreen wiring lives in the Surface; it calls back to _relayout
    // when the viewport actually changes the virtual dims. Lay out the actors and
    // paint the first frame now.
    this._applyAspect();
  }

  /**
   * One-time initial layout: position the actors against the surface bounds and
   * paint the first frame, then fit #stage to the viewport. The Surface has
   * already sized the backing store; ongoing viewport changes run _relayout via
   * the Surface's onResize callback.
   */
  _applyAspect() {
    this._relayout();
    this.surface.fit();
  }

  /**
   * Reposition every actor against the (possibly just-resized) bounds and repaint
   * synchronously. Wired as the Surface's onResize and reused for the initial
   * layout. The synchronous repaint matters on resize: reassigning canvas.width
   * wipes the backing store, so without it the next composite can flash the dark
   * page background ("black frame" on mobile URL-bar / fullscreen changes). It
   * also gives the title overlay a painted dawn beach to sit over before start().
   */
  _relayout() {
    this.world.player.reposition(this.bounds.width / 2, CONE_Y);
    this.customers.layout(this.bounds);
    this.world.shop.layout(this.bounds.width);
    drawFrame(this.ctx, this);
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

  /**
   * Settings: wipe ALL persisted progress back to a fresh save — challenge sets
   * AND the power-up unlocks they grant (both live in the challenges store),
   * recipe completions, and the regulars' unlock + served state. Power-up sources
   * (tips, combo breaker) and the regulars collection read these, so the wipe
   * re-locks power-ups and re-hides unlocked regulars.
   */
  _resetProgress() {
    this.world.challenges.reset();  // challenge progress + power-up/section unlocks
    this.world.recipes.reset();     // recipe completion counts
    this.world.regulars.reset();    // regulars unlock + served counts
  }

  /**
   * Esc: toggle the pause menu. Suppressed during the between-day sky beat (night
   * cycle / round intro) and while the game isn't running (Esc on the start /
   * game-over screen would be confusing).
   */
  _togglePause() {
    if (!this.running) return;
    if (this.inNightCycle || this.inRoundIntro || this.inDeath) return;   // not during the sky beat / death
    if (this.inPauseMenu) {
      this.inPauseMenu = false;
      this.hud.hidePauseMenu();
    } else {
      this.inPauseMenu = true;
      this.hud.showPauseMenu({ onResume: () => this._togglePause() });
    }
  }

  /**
   * Abandon the current run (if any) and return to the title screen — wired to the
   * 🏠 Home buttons on the pause, wave-transition, and game-over menus. The pause /
   * wave-transition buttons confirm first (the run's score is lost); game-over is
   * already ended, so its Home just navigates.
   */
  _goHome() {
    this.running = false;
    this.loop.stop();
    this.inCashout = false;
    this.inNightCycle = false;
    this.inDeath = false;
    this.inPauseMenu = false;
    this.inGameOver = false;
    this._dayHintShown = false;
    this.hud.setDayHint(false);
    // Persist earned-but-uncommitted challenge progress before leaving (mirrors
    // _endGame; commitEarned is idempotent if the run already ended).
    this.world.challenges.commitEarned();
    this.hud.showTitle();
  }

  /** @param {boolean} [forceTutorial] play the tutorial regardless of the flag (How to Play) */
  start(forceTutorial = false) {
    this.sound.resume();
    this.hud.hideOverlay();
    this.effects.reset();
    this.customers.layout(this.bounds);
    // A tutorial REPLAY from Settings (How to Play after the tutorial's already
    // been cleared) is a SANDBOX: freeze challenge progress and restrict tips to
    // coins. A genuine first play (Set 1 not cleared yet) is the real thing.
    const replaySandbox = forceTutorial && this.world.challenges.firstSetCleared();
    this.world.challenges.setFrozen(replaySandbox);
    // Catch-up: the next set normally reveals at game over, but a player can clear a
    // set's goals and then quit (Home / close the tab) without dying. Roll forward
    // here so a fresh game always opens on un-cleared challenges — and so clearing the
    // tutorial set then quitting still graduates past the tutorial. No-op during a
    // frozen tutorial replay (advanceSet guards on `frozen`).
    if (this.world.challenges.isCurrentSetComplete()) this.world.challenges.advanceSet();
    // Day 0 (the tutorial) only plays until the first challenge set is cleared —
    // after that we jump straight to Day 1. "How to Play" and the debug "force
    // tutorial" flag override and replay it.
    const playWave0 = forceTutorial || this.showTutorial || !this.world.challenges.firstSetCleared();
    // Reset the simulation (models + progression-session counters). The mode is
    // rebuilt inside, so re-derive the presentation tutorial from it afterward.
    this.world.reset(playWave0);
    // (The day count is anchored by Waves.reset so the opening day reads as Day 1
    // and then climbs forever — no weekly reset; nothing to set here.)
    // Sandbox flag lives on World (the tip roller reads it); set after reset so a
    // prior run's value never leaks.
    this.world.tutorialSandbox = replaySandbox;
    this.tutorial = this.world.mode.makeTutorial();

    this.banner = null;
    this.running = true;
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = false;
    this.inDeath = false;
    this.nightT = 0;
    this._nightDuration = NIGHT_CYCLE_S;
    this._dayRolling = false;
    this.inRoundIntro = false;

    this._syncHud();

    // Onboarding hints overlay the real Wave 0 (no freeze) — only when Wave 0
    // is actually in play.
    if (playWave0) this.tutorial.start(this);
    this._syncDayHint();
    // Day-start beat for the opening campaign day (skipped while the tutorial runs):
    // the week's challenges hold in the sky, then dissolve into the round.
    this._startRoundIntro();

    this.loop.start({
      shouldStep: () => this._stepping(),
      step: dt => this._step(dt),
      render: (dt, alpha) => this._frame(dt, alpha)
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
      return Number.isFinite(v) ? Math.max(0.5, Math.min(5, v)) : 1.7;
    } catch { return 1.7; }
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
    // Feed the current day so the (dormant) "Complete the Week" goal can track if
    // it's ever reinstated. Harmless no-op otherwise.
    this.world.challenges.setDayInWeek(this.world.waves.day);
    // Deferred day rollover: while a finished day is "rolling over" (cashout → night
    // sweep), HOLD the gauge so the day number doesn't tick over until the night
    // lands. It resumes (showing the new day) at night-end.
    if (!this._dayRolling) {
      this.hud.setGauge(this.world.waves.day, this.world.waves.waveFraction);
    }
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
    // The scripted tutorial drives the gauge callout text (null = hidden). Only
    // touch the DOM when the shown-state or the text actually changes.
    const text = (this.tutorial && this.tutorial.dayHintText) || null;
    const want = !!text;
    if (want === this._dayHintShown && text === this._dayHintText) return;
    this._dayHintShown = want;
    this._dayHintText = text;
    this.hud.setDayHint(want, text);
  }

  /**
   * Gate for the fixed-step pump (the Loop's `shouldStep`). The sim advances only
   * during live play — paused, the between-wave overlay, the pause menu, the
   * cashout, and the night-cycle all freeze it.
   */
  _stepping() {
    return this.running && !this.paused &&
      !this.inPauseMenu && !this.inCashout && !this.inNightCycle && !this.inRoundIntro && !this.inDeath;
  }

  /**
   * Per-frame variable-step work (the Loop's `render`): smoothed FPS, the free
   * clock, presentation-timer decay, the between-wave night-cycle sweep, visual
   * effects, the HUD pull, the tutorial overlay, and the draw.
   * @param {number} frame seconds since the last frame (clamped by the Loop)
   * @param {number} [alpha] leftover sim-step fraction — movers draw interpolated
   */
  _frame(frame, alpha = 1) {
    // Smoothed FPS for the debug overlay (EMA). Guard against the first frame.
    if (frame > 0) this.fps = this.fps * 0.9 + (1 / frame) * 0.1;
    this.clock += frame;

    // The "DAY N!" banner decays on the variable step (game-owned, not part of
    // the deterministic sim). The hurt flash is now an Effects timer.
    if (this.banner && (this.banner.t -= frame) <= 0) this.banner = null;

    // Between-wave night cycle: a fast sunset→midnight→dawn sweep (moon arcs
    // across) that plays after the overlay is dismissed; when it lands the
    // freeze lifts and the next wave resumes.
    if (this.inNightCycle) {
      this.nightT += frame / (this._nightDuration || NIGHT_CYCLE_S);
      if (this.nightT >= 1) {
        this.nightT = 1;
        this.inNightCycle = false;
        // Night sweep done — release the gauge hold so the new day's number shows,
        // and reset the per-day power-up counter. The round starts now: the sky
        // challenges dissolve into it and the in-game HUD fades back in.
        this._dayRolling = false;
        this.world.challenges.recordWaveEnded();
        this.world.shop.resetDayCombo();
        this.hud.dissolveNightSky();
      }
    }

    // Fresh-start intro: hold the sky challenges (sim frozen), then dissolve them
    // into the round — the dissolve IS the start (no countdown).
    if (this.inRoundIntro) {
      this.roundIntroT += frame;
      if (this.roundIntroT >= INTRO_HOLD_S) {
        this.inRoundIntro = false;
        this.hud.dissolveNightSky();
      }
    }
    // Visual-only systems run variable-step — including during the cashout /
    // night-cycle / death-sequence freezes, so particle pops keep animating while
    // play is paused, and during game over so the death shake tapers out.
    if (this._stepping() || this.inCashout || this.inNightCycle || this.inDeath || this.inGameOver) this.effects.update(frame);

    // During the death sequence the sim is frozen, so drive the customer slide-off
    // animation directly — angry customers walk off one by one (see _deathCustomersLeave).
    if (this.inDeath) this.world.shop.animateExit(frame);

    // Numeric HUD is a per-frame PULL from sim state. Then advance the
    // presentation-only tutorial overlay + its DOM callout.
    this._syncHud();
    if (this.tutorial.active) this.tutorial.update(frame, this);
    this._syncDayHint();

    drawFrame(this.ctx, this, alpha);
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
    if (!this.running || this.paused || this.inNightCycle || this.inCashout || this.inDeath || this.world.player.frozen) return;
    this.world.pop();
  }

  /** A too-short up-flick: no toss, just squash the top scoop back as feedback. */
  _tossCancel() {
    if (!this.running || this.paused || this.inNightCycle || this.inCashout || this.inDeath || this.world.player.frozen) return;
    if (this.world.player.stack.length === 0) return;
    this.world.player.bumpToss();
  }

  _deliver() {
    if (!this.running || this.paused || this.inNightCycle || this.inCashout || this.inDeath || this.world.player.frozen) return;
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
   */
  _runWaveCashout() {
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

    setTimeout(() => this._cashoutStack(), combo > 0 ? 500 : 150);
  }

  /** Cashout step 1: pop the tray stack top-to-bottom, then the active power-up. */
  _cashoutStack() {
    if (!this.running) { this.inCashout = false; return; }
    if (this.world.player.stack.length === 0) { this._cashoutActive(); return; }
    const idx = this.world.player.stack.length - 1;
    const pos = this.world.player.scoopPosition(idx);
    const color = this.world.player.stack[idx].color;
    this.world.player.popTop();
    // Leftover tray scoops at wave-end just pop for show now — no points, no "+N"
    // text (that was a vestigial reward; the score never meaningfully moved).
    this.effects.burst(pos.x, pos.y, [this.world.shop.hex(color), '#fff'], 14);
    this.sound.catch_();
    setTimeout(() => this._cashoutStack(), 120);
  }

  /**
   * Cashout step 2: pop the active power-up bubble for show (no points), then
   * open the wave-transition overlay.
   */
  _cashoutActive() {
    if (!this.running) { this.inCashout = false; return; }
    const finish = () => {
      this.inCashout = false;
      this._beginNightHandoff();
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
   * Between-day reset: the night-cycle sweep (sunset → midnight → dawn) that plays
   * straight after the cashout — no modal. The sky shows the recap (checked-off
   * challenges + the day's earned coins) over it, then dissolves into the next day.
   * _frame advances nightT and lifts the freeze when it lands; endCelebration() makes
   * the next day open at dawn. The sweep stretches with the coin count so each flips
   * and reads before the dissolve.
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} [recap]
   */
  _runNightCycle(recap = null) {
    if (!this.running) return;
    this.world.waves.endCelebration();
    // Reset the cone to center for the fresh day — it snaps back during the night
    // sweep so every day opens from the middle.
    this.world.player.reposition(this.bounds.width / 2, CONE_Y);
    // Stretch the sweep so the coin carousel plays out AND the challenges still get a
    // beat before the dissolve. Every coin is shown; the per-coin dwell shortens past a
    // ceiling (coinDwellMs), so the night scales with the list then levels off rather
    // than growing forever. Uses the carousel's own timing so the two stay in lockstep.
    const coinCount = recap
      ? (recap.reveals?.length || 0) + (recap.rewards?.length || 0) + (recap.discoveries?.length || 0)
      : 0;
    const carouselS = coinCount > 0 ? (coinCount * coinDwellMs(coinCount)) / 1000 + 0.8 : 0;
    this._nightDuration = NIGHT_CYCLE_S + carouselS;
    this.nightT = 0;
    this.inNightCycle = true;
    // The day's challenges (checked) + earned coins drift into the sky and the in-game
    // HUD fades out; they dissolve back into the round (HUD fades in) when the sweep lands.
    this.hud.showNightSky(recap);
  }

  /**
   * Fresh game start (no night sweep): hold the week's challenges in the sky with
   * the sim frozen, then _frame dissolves them into the round. Skipped during the
   * scripted tutorial, which paces itself.
   */
  _startRoundIntro() {
    if (this.tutorial.active) { this.inRoundIntro = false; return; }
    this.inRoundIntro = true;
    this.roundIntroT = 0;
    this.hud.showNightSky();
  }

  /**
   * End-of-day / end-of-run stat card: score, the day's best combo, the run's
   * longest combo, and the flavor completed most often. Shared by the wave
   * transition and the game-over screen.
   */
  _dayStats() {
    let fav = null;
    for (const r of this.world.recipes.getAll()) {
      if (r.count > 0 && (!fav || r.count > fav.count)) fav = r;
    }
    return {
      score: this.world.shop.score,
      dayCombo: this.world.shop.dayBestCombo,
      bestCombo: this.world.shop.bestCombo,
      favFlavor: fav ? fav.name : '—'
    };
  }

  /**
   * Between-day handoff — NO modal (the old wave-transition screen tested as
   * distracting). Commit the day's earned challenges (granting any set reward once),
   * then run the night cycle, handing it the coins to flip in the sky: regulars met,
   * the set reward just granted, and recipes discovered today. The sky shows the
   * checked-off challenges + those coins as the day resets into the next. The next
   * SET only ever reveals on death (game over), never here — so finishing a set's
   * goals mid-run doesn't surface the next set until the run ends.
   */
  _beginNightHandoff() {
    if (!this.running) return;
    // Effects are frozen during the night sweep (the loop doesn't update them), so
    // flush any in-flight pop-text / bursts now — otherwise they'd hang motionless.
    this.effects.reset();
    const result = this.world.challenges.commitEarned();
    this._runNightCycle({
      reveals: [
        ...this.world.drainTutorialReveals(),
        ...this.world.regulars.drainPendingReveals()
      ],
      rewards: result.rewards || [],
      discoveries: this.world.drainPendingDiscoveries()
    });
  }

  /**
   * Game over. Instead of freezing instantly, play a scripted teardown with the loop
   * still ALIVE (the sim frozen via inDeath): first the tray scoops pop, then — all
   * overlapping — the falling scoops pop, the customers storm off angry, and the cone
   * fractures; the menu (_endGame) raises once the last customer has left. Guarded
   * against re-entry.
   */
  _beginDeath() {
    if (this.inDeath || this.inGameOver) return;
    this.inDeath = true;
    this._dayHintShown = false;
    this.hud.setDayHint(false);
    this.sound.gameOver();
    this.haptics.gameOver();
    this.effects.addShake(9);
    // A beat to register the loss, then start popping the cone's tray.
    setTimeout(() => this._deathPopStack(), 360);
  }

  /** Death step 2: pop the scoops sitting on the cone, top to bottom. */
  _deathPopStack() {
    if (!this.inDeath) return;
    const stack = this.world.player.stack;
    if (stack.length === 0) { this._deathTeardown(); return; }
    const idx = stack.length - 1;
    const pos = this.world.player.scoopPosition(idx);
    const color = stack[idx].color;
    this.world.player.popTop();
    this.effects.burst(pos.x, pos.y, [this.world.shop.hex(color), '#fff'], 14);
    this.sound.catch_();
    setTimeout(() => this._deathPopStack(), 120);
  }

  /**
   * Death steps 3–5, OVERLAPPING: pop the falling scoops, start the customers
   * storming off right away, and fracture the cone a beat later — so the crowd is
   * already leaving while the sky clears and the cone explodes. The customer walk-off
   * is the long pole and raises the menu when it finishes (_deathCustomersLeave).
   */
  _deathTeardown() {
    if (!this.inDeath) return;
    this._clearFieldFx();                                // pop the scoops still in the air
    this._deathCustomersLeave();                         // customers begin leaving now
    setTimeout(() => this._deathFractureCone(), 220);    // cone explodes mid-exodus
  }

  /** The cone fractures into tumbling waffle chunks and is gone (plays mid-exodus). */
  _deathFractureCone() {
    if (!this.inDeath) return;
    const p = this.world.player;
    this.effects.fracture(p.x, p.y, CONE_SHARD_COLORS, 20);
    this.effects.burst(p.x, p.y, [...CONE_SHARD_COLORS, '#fff'], 12);
    this.effects.addShake(13);
    p.fractured = true;          // the view stops drawing the cone from here
    this.sound.bad();
  }

  /**
   * Death step 5: the remaining customers lose patience and storm off, one by one —
   * each goes angry (shaking) for a beat, then slides away (animated by shop.animateExit
   * in _frame). When the last has gone, raise the game-over menu (step 6).
   */
  _deathCustomersLeave() {
    if (!this.inDeath) return;
    const shop = this.world.shop;
    const remaining = shop.activeCustomers();
    if (remaining.length === 0) { setTimeout(() => this._endGame(), 350); return; }
    const STAGGER = 300, ANGER_HOLD = 520, SLIDE = 760;
    remaining.forEach((c, i) => {
      const t0 = i * STAGGER;
      setTimeout(() => { if (this.inDeath) { shop.angerCustomer(c); this.sound.bad(); } }, t0);
      setTimeout(() => { if (this.inDeath) shop.sendOff(c); }, t0 + ANGER_HOLD);
    });
    const total = (remaining.length - 1) * STAGGER + ANGER_HOLD + SLIDE + 200;
    setTimeout(() => this._endGame(), total);
  }

  /** The death sequence finished — freeze the loop and raise the game-over menu. */
  _endGame() {
    this.running = false;
    this.loop.stop();
    // The death sequence ran with the loop alive; now end it.
    this.inDeath = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = true;
    this._dayHintShown = false;
    this.hud.setDayHint(false);
    // (sound.gameOver / haptics fired at the START of the sequence, in _beginDeath.)
    // Challenges commit INSIDE the game-over recap (so the cross-off animation +
    // reward coins play there); we just hand it the final run's pending reveals /
    // discoveries to flip alongside them. Draining here means they don't linger as a
    // "backlog" into the next run's sky.
    this.hud.showGameOver(
      this._dayStats(),
      () => this.start(),
      this.world.sessionRecipeEvents,
      {
        reveals: [
          ...this.world.drainTutorialReveals(),
          ...this.world.regulars.drainPendingReveals()
        ],
        discoveries: this.world.drainPendingDiscoveries()
      }
    );
  }
}

new Game();
