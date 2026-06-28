// @ts-check
// Composition root + coordinator. The codebase is split into layers by folder:
//   engine/ — game-agnostic runtime: loop.js (fixed-timestep), input, touch,
//             audio, haptics, viewport, surface, scheduler, event bus
//   game/   — simulation + rules + data: world.js (the sim), player, scoops,
//             shop, waves, powerups, recipes, challenges, day cycle, modes,
//             config, tuning; flow.js — the run state machine + scripted beats
//   ui/     — rendering: renderer.js (the frame), playerView, scoopsView, scene,
//             customers, effects, HUD
//   reactions.js — domain events → sound/haptics/effects/HUD glue
// Dataflow is one-way: input → World.step(dt) → events → presentation. This file
// owns the glue only: it builds the actors, drives the Loop (stepping/step/frame),
// routes input, runs the run lifecycle (start), and pulls World state to the HUD
// each frame. The sim (game/world.js), the flow state machine + scripted beats
// (game/flow.js), drawing (ui/renderer.js), and reactions (reactions.js) are delegated.
import {
  HEALTH,
  WAVES,
  CONE
} from './game/config.js';
import { Customers } from './ui/customers.js';
import { Hud } from './ui/hud/hud.js';
import { Input } from './engine/input.js';
import { Sound } from './engine/audio.js';
import { Haptics } from './engine/haptics.js';
import { Effects } from './ui/effects/effects.js';
import { DebugPanel } from './debug.js';
import { drawFrame } from './ui/renderer.js';
import { wireReactions } from './reactions.js';
import { EventBus } from './engine/events.js';
import { Surface } from './engine/surface.js';
import { Loop } from './engine/loop.js';
import { World } from './game/world.js';
import { GameFlow } from './game/flow.js';
import { TouchControls } from './engine/touch.js';
import { installPaletteVars } from './ui/palette.js';

/** @typedef {import('./types.js').GameEventMap} GameEventMap */
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

// Mirror the shared colour palette (js/ui/palette.js) into the document :root as
// CSS custom properties, so the HUD stylesheets and the canvas draw from ONE source.
// Runs at module load, before the Game is constructed or anything paints.
installPaletteVars();

// Physics step: deterministic per-frame integration. The render loop accumulates
// real time and runs as many fixed steps as fit. Effects are visual-only and
// stay variable-step. Rendering runs at the display's native rate with movers
// interpolated by the loop's alpha — a 60fps render cap was tried and reverted:
// on a 90Hz panel it painted every 2nd vsync (45fps) while the sim stepped at
// 60Hz, so painted frames advanced 1,1,2,1,1,2 steps — visible judder.
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;

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
      onStart:    () => this.flow.beginPlay(),  // attract: burst the ghost scoops, then start
      onHowToPlay: () => this.start(true),  // replays the tutorial on demand
      getInGame:  () => this.running,       // disables How to Play during an active run
      getVolume:  () => this.sound.volume,
      onSetVolume: v => this.sound.setVolume(v),
      getSensitivity: () => this.touchGain,
      onSetSensitivity: g => this.setTouchGain(g),
      getHaptics: () => this.haptics.enabled,
      onSetHaptics: v => this.haptics.setEnabled(v),
      onResetProgress: () => this._resetProgress(),
      onPauseToggle: () => this.flow.togglePause(),
      onHome: () => this.flow.goHome()
    });

    this.sound   = new Sound();
    // Unlock WebAudio on the FIRST user gesture anywhere (autoplay policy needs a
    // gesture). The title screen's tap-to-play fires its cashout pops immediately,
    // so the context must already be live by then — pointerdown precedes the click,
    // giving it a head start. One-shot; removes itself once fired.
    const unlockAudio = () => {
      this.sound.resume();
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    this.haptics = new Haptics();
    this.effects = new Effects();
    // Customer view (faces + speech bubbles). Pure presentation; the renderer
    // draws through it and reads its groundY for the miss line.
    this.customers = new Customers();

    // Presentation tutorial, built from the active mode. Rebuilt each start().
    this.tutorial = this.world.mode.makeTutorial();

    // The run's flow state machine (game/flow.js): owns the phase flags (cashout /
    // night cycle / round intro / death / game over / pause menu) and the scripted
    // between-state sequences, all on a cancelable Scheduler. game.js drives it from
    // the loop callbacks (stepping/tick) and routes input through its gates.
    this.flow = new GameFlow(this);

    /** @type {{ text: string, t: number } | null} The "DAY N!" banner (decays in _frame). */
    this.banner = null;
    // Master run gates, read pervasively by input + the loop: `running` is the run
    // lifecycle switch; `paused` is the debug-panel pause (the Esc pause menu is a
    // flow phase). Both stay on the coordinator.
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
      // Combo-breaker threshold is fixed (= max combo, SCORING.COMBO_BREAKER_THRESHOLD);
      // only the on/off toggle remains debug-tunable.
      onComboBreakerToggle: on => { this.world.comboBreakerEnabled = on; this._syncComboHud(); },
      getComboBreakerEnabled: () => this.world.comboBreakerEnabled
    });

    // Input routing: discrete verbs are guarded here, then handed to the World.
    this.input.onPop = () => this._pop();
    this.input.onDeliver = () => this._deliver();
    this.input.onUsePower = type => this._usePower(type);
    this.input.onDebugDamage = () => this._debugDamage();
    this.input.onPause = () => this.flow.togglePause();

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

    // The sim only DECIDES (emits waveUp / gameOver); the flow machine runs the
    // timed beats — the wave-end cashout schedule and the game-over teardown.
    this.bus.on('waveUp', () => this.flow.onWaveUp());
    this.bus.on('gameOver', () => this.flow.onGameOver());

    // Resize/fullscreen wiring lives in the Surface; it calls back to _relayout
    // when the viewport actually changes the virtual dims. Lay out the actors and
    // paint the first frame now.
    this._applyAspect();

    // Open on the title "attract" screen: the ambient beach animates, the cone
    // plops its ghost scoops, then the title fades in (the loop runs; the sim
    // stays frozen until the player taps to play).
    this.flow.enterAttract();
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
    this.world.player.reposition(this.bounds.width / 2, CONE.Y);
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
    this.world.field.setDemandBias(WAVES.SPAWN_DEMAND_BIAS);
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

  /** @param {boolean} [forceTutorial] play the tutorial regardless of the flag (How to Play) */
  start(forceTutorial = false) {
    this.sound.resume();
    // Leave the title attract screen (clears its flags + the cone's ghost tint);
    // the world reset below drives the rest of the fresh-run state.
    this.flow.exitAttract();
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
    this.flow.reset();   // clear phase flags + cancel any orphaned timers from a prior run

    this._syncHud();

    // Onboarding hints overlay the real Wave 0 (no freeze) — only when Wave 0
    // is actually in play.
    if (playWave0) this.tutorial.start(this);
    this._syncDayHint();
    // Day-start beat for the opening campaign day (skipped while the tutorial runs):
    // the week's challenges hold in the sky, then dissolve into the round.
    this.flow.startRoundIntro();

    this.loop.start({
      shouldStep: () => this.flow.stepping(),
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
    this.hud.setHealth(this.world.health / HEALTH.MAX);
    // Feed the current day so the (dormant) "Complete the Week" goal can track if
    // it's ever reinstated. Harmless no-op otherwise.
    this.world.challenges.setDayInWeek(this.world.waves.day);
    // Deferred day rollover: while a finished day is "rolling over" (cashout → night
    // sweep), HOLD the gauge so the day number doesn't tick over until the night
    // lands. It resumes (showing the new day) at night-end.
    if (!this.flow.dayRolling) {
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
   * Per-frame variable-step work (the Loop's `render`): smoothed FPS, the free
   * clock, presentation-timer decay, the between-state sky beats (delegated to the
   * flow machine), visual effects, the HUD pull, the tutorial overlay, and the draw.
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

    // Advance the between-state sky beats (night-cycle sweep + round intro); each
    // lifts its own freeze and dissolves the sky when its timer lands.
    const f = this.flow;
    f.tick(frame);

    // Visual-only systems run variable-step — including during the cashout /
    // night-cycle / death-sequence freezes, so particle pops keep animating while
    // play is paused, during game over so the death shake tapers out, and on the
    // title attract screen so the ghost-scoop plops + tap-to-play bursts animate.
    if (f.stepping() || f.inCashout || f.inNightCycle || f.inDeath || f.inGameOver || f.inAttract) this.effects.update(frame);

    // During the death sequence the sim is frozen, so drive the customer slide-off
    // animation directly — angry customers walk off one by one (see flow._deathCustomersLeave).
    if (f.inDeath) this.world.shop.animateExit(frame);

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
    if (!this.running || this.paused || this.flow.blocksPlay || this.world.player.frozen) return;
    this.world.pop();
  }

  /** A too-short up-flick: no toss, just squash the top scoop back as feedback. */
  _tossCancel() {
    if (!this.running || this.paused || this.flow.blocksPlay || this.world.player.frozen) return;
    if (this.world.player.stack.length === 0) return;
    this.world.player.bumpToss();
  }

  _deliver() {
    if (!this.running || this.paused || this.flow.blocksPlay || this.world.player.frozen) return;
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
}

new Game();
