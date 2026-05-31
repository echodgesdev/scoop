// @ts-check
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
  CUSTOMER_FACE_OFFSET_PX,
  PROJECTILE_SPEED,
  SCOOP_RADIUS,
  PICKUP_RADIUS,
  PICKUP_BUBBLE_RADIUS_MULT,
  COMBO_CASHOUT_PER,
  STACK_CASHOUT_PER_SCOOP,
  HEAL_COST,
  coneYFor
} from './config.js';
import { Player } from './player.js';
import { ScoopField, isCaught } from './scoops.js';
import { Shop, REACH } from './shop.js';
import { Stations } from './stations.js';
import { Waves, WAVE_EVENT } from './waves.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Effects } from './effects.js';
import { DebugPanel } from './debug.js';
import { drawSkyAndSun, drawSand } from './scene.js';
import { dayCycleState } from './dayCycle.js';
import { PowerUps } from './powerups.js';
import { PickupField, pickupCaught, PICKUP_ICONS, PICKUP_RING_COLOR } from './pickups.js';
import { ProjectileField, projectileHits } from './projectiles.js';
import { EventBus } from './events.js';
import { Recipes } from './recipes.js';
import { Challenges } from './challenges.js';
import { virtualDims, fitRect, DEFAULT_ASPECT } from './viewport.js';
import { Tutorial } from './tutorial.js';

/** @typedef {import('./types.js').GameEventMap} GameEventMap */
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

// Physics step: deterministic per-frame integration. The render loop accumulates
// real time and runs as many fixed steps as fit. Effects are visual-only and
// stay variable-step.
const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;

// Power-up indicator animation timings. Catching a timed bubble floats it UP
// into the "active" slot at the bottom (where its countdown lives); when it
// ends — or is replaced by a fresh catch — it slides off to the LEFT.
// A departing bubble takes PU_LEAVE_S to clear.
const PU_LEAVE_S = 0.3;
const ACTIVE_SLIDE_S = 0.18;

// Map a caught bubble type to the timed power-up it runs. Heart is absent — it
// heals instantly and never occupies the active slot (see _onPickup).
const PICKUP_TO_POWER = {
  [PICKUP_TYPE.FEATHER]: POWERUP_TYPE.SPEED,
  [PICKUP_TYPE.PAUSE]:   POWERUP_TYPE.PAUSE,
  [PICKUP_TYPE.RAINBOW]: POWERUP_TYPE.RAINBOW
};

class Game {
  constructor() {
    this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    // #stage is the letterbox container the canvas + HUD live in. Its on-screen
    // rect is recomputed in _resize; the canvas backing store stays at the
    // fixed virtual resolution of the chosen aspect.
    this.stage = document.getElementById('stage');
    this.aspect = DEFAULT_ASPECT;
    const _d = virtualDims(this.aspect);
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
      onResetProgress: () => this._resetProgress(),
      onPauseToggle: () => this._togglePause()
    });
    this.input   = new Input();
    this.sound   = new Sound();
    this.effects = new Effects();
    /** @type {EventBus<GameEventMap>} */
    this.bus = new EventBus();

    this.waves       = new Waves(() => this.challenges.unlockedSectionIds());
    this.powerups    = new PowerUps();
    this.player      = new Player(0, 0);
    this.field       = new ScoopField();
    this.pickups     = new PickupField(() => this.challenges.unlockedPowerupTypes());
    this.projectiles = new ProjectileField();
    this.shop        = new Shop(this.waves);
    this.stations    = new Stations();
    this.tutorial    = new Tutorial();

    // Couple supply to demand: the scoop field biases its incoming queue
    // toward colors the shop still needs.
    this.field.setDemandSource(() => this.shop.demandColors(this.player.colors()));

    /** @type {{ text: string, t: number } | null} */
    this.banner = null;

    this.input.onPop = () => this._pop();
    this.input.onDeliver = () => this._deliver();
    this.input.onRotate = () => this._rotate();
    this.input.onUsePower = type => this._usePower(type);
    this.input.onDebugDamage = () => this._debugDamage();
    this.input.onPause = () => this._togglePause();

    // Power-ups fire the instant a bubble is caught (no banking, no manual
    // spend). Heart heals on the spot; the three timed power-ups
    // (speed / freeze / rainbow) are mutually exclusive — catching one replaces
    // whatever is currently running. The single "active" bubble below mirrors
    // the running timed power-up (its countdown ring); null when none is up.
    /** @type {{ type: PickupTypeName, fromX: number, anim: number } | null} */
    this.activeBubble = null;
    // Bubbles mid-slide-off to the left (a finished or just-replaced power-up).
    /** @type {{ type: PickupTypeName, x: number, y: number, r0: number, t: number }[]} */
    this.puLeaving = [];
    // First-time onboarding flag (persisted). When true the scripted tutorial
    // plays at the start of wave 1; the "How to Play" button forces it anytime.
    this.showTutorial = this._loadShowTutorial();
    // Free-running clock (seconds) for HUD pulse/flash animations.
    this.clock = 0;

    this.health = MAX_HEALTH;
    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.hurt = 0;

    this.flags = {
      patternTimer: true, speedRamp: true, invincible: false, pickupKeys: false,
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
      onAspectChange: name => this._setAspect(name),
      getAspect: () => this.aspect,
      onDemandBias: v => this.field.setDemandBias(v),
      getDemandBias: () => this.field.demandBias,
      onPatience: sec => { this.patienceOverride = sec; },
      getPatience: () => this.patienceOverride != null
        ? this.patienceOverride
        : Math.round(this.waves.tuning(this.flags.speedRamp).patience),
      onBubbleRange: (min, max) => this.pickups.setSpawnRange(min, max),
      getBubbleRange: () => ({ min: this.pickups.spawnMin, max: this.pickups.spawnMax }),
      onBubbleWeights: weights => this.pickups.setWeights(weights),
      getBubbleWeights: () => this.pickups.weights,
      onTutorialFlag: v => this.setShowTutorial(v),
      getTutorialFlag: () => this.showTutorial
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
   * Size the canvas backing store to the current aspect's virtual resolution,
   * reposition every actor against the new bounds, then re-letterbox. Called
   * on construction and whenever the debug aspect selector changes.
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
   * Debug: switch the locked aspect ratio live (4:3 ⇄ 3:4).
   * @param {string} name
   */
  _setAspect(name) {
    const d = virtualDims(name);
    this.aspect = name;
    this.bounds.width = d.width;
    this.bounds.height = d.height;
    this._applyAspect();
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
    this.shop.setOrderTime(this.waves.tuning(this.flags.speedRamp).patience);
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
        this.effects.burst(top.x, top.y, ['#fff', this.shop.hex(scoop.color)], 10);
        this.effects.popText(top.x, top.y - 24, 'Perfect!', { color: '#ffec5c', size: 22, life: 0.7 });
        this.player.triggerFlash(0.25);
      } else {
        this.sound.catch_();
      }
    });

    this.bus.on('trayFull', () => {
      this.sound.bad();
      this.effects.addShake(8);
      this.hurt = 0.2;
    });

    this.bus.on('pickup', ({ pickup }) => this._pickupCatchFx(pickup));

    this.bus.on('serve', ({ gained, colors, combo, x, y }) => {
      this.effects.burst(x, y, colors.map(c => this.shop.hex(c)));
      this.effects.popText(x, y, `+${gained}`, { color: '#ffec5c', size: 28 });
      if (combo > 1) {
        this.effects.popText(x, y - 30, `${combo}× combo!`, { color: '#ff6fa3', size: 20, life: 0.8 });
      }
      this.player.triggerFlash();
      this.effects.addShake(6);
      this.sound.match();
    });

    this.bus.on('serveFail', () => {
      this.sound.bad();
      this.effects.addShake(4);
    });

    this.bus.on('expire', () => {
      this.sound.expire();
      this.effects.addShake(12);
      this.hurt = 0.35;
    });

    this.bus.on('phaseUp', () => {
      this.hud.flashPhaseUp();
      this.sound.phaseUp();
      this.effects.addShake(4);
      const c = this.hud.gaugeCenter();
      if (c) this.effects.burst(c.x, c.y, ['#ffd166', '#fff'], 14);
    });

    this.bus.on('waveUp', ({ wave }) => {
      this.hud.setGauge(this.waves.wave, 1);
      this.hud.flashWaveUp();
      this.sound.levelUp();
      this.effects.addShake(14);
      const c = this.hud.gaugeCenter();
      if (c) this.effects.burst(c.x, c.y, ['#ffec5c', '#ffd166', '#ff6fa3', '#7fe3c4'], 60);
      this.banner = { text: `WAVE ${wave}!`, t: 1.6 };
    });
  }

  /**
   * Letterbox: fit the fixed-aspect virtual canvas inside the current viewport,
   * centered, and position #stage over that rect. The backing-store size and
   * all actor positions are untouched — only the CSS display rect changes — so
   * gameplay is byte-identical at any window size.
   */
  _resize() {
    if (!this.stage) return;
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
    this.pickups.reset();
    this.projectiles.reset();
    this.powerups.reset();
    this.effects.reset();
    this.stations.layout(this.bounds);
    this.shop.layout(this.bounds.width);
    this.waves.reset();
    this.shop.setOrderTime(this.waves.tuning(this.flags.speedRamp).patience);
    this.shop.reset();
    this.health = MAX_HEALTH;
    this.hurt = 0;
    this.running = true;
    this.inWaveTransition = false;
    this.inCashout = false;
    this.activeBubble = null;
    this.puLeaving.length = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.banner = null;
    // Fresh recipe-event slate per session — drained on game over.
    /** @type {{ unlocked: string[], mastered: string[] }} */
    this.sessionRecipeEvents = { unlocked: [], mastered: [] };
    this.challenges.resetSession();

    this.hud.setScore(this.shop.score);
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);

    // Scripted onboarding: freezes the player, stages a customer + order,
    // floats the coin, then hands control over. Plays only the first time
    // (persisted flag) or when forced via the "How to Play" button.
    this.player.frozen = false;
    if (forceTutorial || this.showTutorial) this.tutorial.start(this);

    requestAnimationFrame(t => this._loop(t));
  }

  _loadShowTutorial() {
    try { return localStorage.getItem('scoop.showTutorial') !== '0'; } catch { return true; }
  }

  /** @param {boolean} v */
  setShowTutorial(v) {
    this.showTutorial = v;
    try { localStorage.setItem('scoop.showTutorial', v ? '1' : '0'); } catch {}
  }

  /** Called by the tutorial on completion so it won't auto-play again. */
  markTutorialSeen() {
    this.setShowTutorial(false);
  }

  /** @param {DOMHighResTimeStamp} t */
  _loop(t) {
    if (!this.lastTime) this.lastTime = t;
    const frame = Math.min(MAX_FRAME, (t - this.lastTime) / 1000);
    this.lastTime = t;

    // Smoothed FPS for the debug overlay (EMA). Guard against the first frame.
    if (frame > 0) this.fps = this.fps * 0.9 + (1 / frame) * 0.1;
    this.clock += frame;

    const stepping = this.running && !this.paused && !this.inWaveTransition && !this.inPauseMenu && !this.inCashout;
    if (stepping) {
      this.accumulator += frame;
      while (this.accumulator >= FIXED_DT) {
        this._step(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
    }
    // Visual-only systems run variable-step — including during the cashout
    // freeze, so its particle pops animate while gameplay is paused.
    if (stepping || this.inCashout) this.effects.update(frame);
    this._draw();

    if (this.running) requestAnimationFrame(nt => this._loop(nt));
  }

  /** @param {number} dt */
  _step(dt) {
    this.waves.update(dt);
    this.powerups.update(dt);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;

    const tuning = this.waves.tuning(this.flags.speedRamp);
    // Debug override wins over the wave ramp; only affects orders spawned from
    // here on (in-flight customers keep their duration).
    this.shop.setOrderTime(this.patienceOverride != null ? this.patienceOverride : tuning.patience);
    this.player.update(dt, this.input, this.bounds, this.powerups.speedMultiplier);
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);

    const hitbox = this.player.catchHitbox();
    // Missed scoops fall past the cone and dissolve down in the sand (below the
    // ground line), so the fizzle reads as the scoop landing/melting into the
    // floor rather than vanishing at the cone tip.
    const missY = this.stations.groundY + SCOOP_RADIUS * 2;
    // While the cone is rotating, scoops pass through — the player is "busy"
    // and can't intercept. This is the second half of the rotate cost:
    // bad scoops keep falling while you can't dodge.
    const locked = this.player.locked;

    // The scripted intro suppresses the falling field and random bubbles — it
    // stages its own customer, scoops, and coin. Projectiles still fly so the
    // player can shoot the tutorial coin.
    if (!this.tutorial.active) {
      this.field.update(dt, this.bounds, tuning, missY, scoop => {
        if (locked) return false;
        if (!isCaught(scoop, hitbox)) return false;
        const perfect = Math.abs(scoop.x - hitbox.x) <= PERFECT_CATCH_BAND;
        this._onCatch(scoop, perfect);
        return true;
      });

      // Pickup collision uses the *expanded* hitbox — cone + every scoop in
      // the tray. Tall stack = more vertical reach for high-floating bubbles.
      const pickupBox = this.player.pickupHitbox();
      this.pickups.update(dt, this.bounds, pickup => {
        if (locked) return false;
        if (!pickupCaught(pickup, pickupBox)) return false;
        this._onPickup(pickup);
        return true;
      });
    }

    // Slingshot projectiles fly upward. Each one pops the first bubble it
    // touches (same _onPickup path as a normal catch) and is consumed by
    // the collision; misses cull when they leave the top of the screen.
    this.projectiles.update(dt, this.bounds, proj => {
      const hit = this.pickups.tryHit(p => projectileHits(proj, p));
      if (!hit) return false;
      this._onPickup(hit, true);
      return true;
    });

    if (this.tutorial.active) this.tutorial.update(dt, this);

    this._stepActive(dt);

    // Patience is frozen during the tutorial so the staged customer never bails.
    const patienceOn = this.flags.patternTimer && !this.powerups.pauseActive && !this.tutorial.active;
    const { expired, comboLost } = this.shop.update(dt, { patienceOn });
    if (expired > 0) this._onExpire(expired);
    if (comboLost) this.sound.bad();
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);
    // The running power-up's countdown lives in the on-canvas "active" slot at
    // the bottom (see _drawActivePowerup).
  }

  /**
   * Catching a bubble fires its power-up immediately — no banking, no manual
   * spend. Heart heals on the spot and is *orthogonal* (it never disturbs a
   * running timed power-up). The three timed types replace whatever is
   * currently running (mutual exclusion via PowerUps.trigger) and float up into
   * the active slot.
   * @param {{ type: import('./types.js').PickupTypeName, x: number, y: number }} pickup
   * @param {boolean} [viaShot] true when popped by a slingshot projectile
   */
  _onPickup(pickup, viaShot = false) {
    // Challenge tracking: every popped bubble counts (catch hitbox OR slingshot
    // projectile both route here).
    this.challenges.recordBubblePop(pickup.type);
    const type = pickup.type;
    const x = this.player.x;
    const y = this.player.stackTopY();

    this.bus.emit('pickup', { pickup });  // white burst at the catch point

    if (type === PICKUP_TYPE.HEART) {
      if (!this.flags.invincible) {
        this.health = Math.min(MAX_HEALTH, this.health + HEART_HEAL_AMOUNT);
        this.hud.setHealth(this.health / MAX_HEALTH);
      }
      this.sound.heart();
    } else {
      this._activateBubble(type, x);
      this.powerups.trigger(type);
      this.sound.powerupTrigger();
    }
    this._powerupUseFx(type, x, y);
  }

  /** Catch FX — just the bubble bursting at the catch point. */
  _pickupCatchFx(pickup) {
    const { x, y } = pickup;
    this.effects.burst(x, y, ['#ffffff', '#cfe9ff', '#e8f4ff'], 14);
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
    this._onPickup({ type, x: this.player.x, y: this.player.stackTopY(), vy: 0, spin: 0 });
  }

  _onCatch(scoop, perfect) {
    if (this.player.stack.length >= MAX_STACK) {
      this.bus.emit('trayFull', /** @type {any} */ ({}));
      return;
    }
    this.player.push(scoop.color);

    if (perfect) {
      this.shop.addScore(PERFECT_CATCH_BONUS);
      this.shop.refreshCombo();
      this.hud.setScore(this.shop.score);
      this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    }
    this.bus.emit('catch', { scoop, perfect });
  }

  /**
   * Down arrow: rotate the tray one slot. Top wraps to bottom; everything
   * else shifts up. The cone locks (no movement, no catches, no other verbs)
   * for ROTATE_LOCK_S — that's the cost of reordering.
   */
  _rotate() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.player.frozen) return;
    if (this.player.locked) return;
    if (this.player.rotateDown()) {
      // Light "whoosh" — reuse the catch chime so it sits in the same audio
      // family as the other tray-manipulation verbs.
      this.sound.catch_();
    } else {
      // Too few scoops to rotate.
      this.sound.bad();
    }
  }

  /**
   * Slingshot. Space launches the bottom tray scoop straight up as a
   * projectile — it can pop bubbles the cone+stack can't otherwise reach.
   * The bottom scoop is consumed regardless of whether the shot hits.
   * Empty tray → no-op with a "nope" beep so the player isn't fighting
   * silent input.
   */
  _pop() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.player.frozen) return;
    if (this.player.locked) return;
    // During the tutorial the slingshot is gated to the shoot step so the
    // player can't fire away scoops they still need to serve (no falling-field
    // recovery while the tutorial is active).
    if (this.tutorial.active && !this.tutorial.allowsShoot()) { this.sound.bad(); return; }
    if (this.player.stack.length === 0) {
      this.sound.bad();
      return;
    }
    const bottom = this.player.stack[0];
    const pos = this.player.scoopPosition(0);
    this.player.popBottom();
    this.projectiles.launch(pos.x, pos.y, -PROJECTILE_SPEED, bottom.color);
    this.sound.shoot();
    // Small burst at the launch point — same color family as the projectile
    // so the "fired" beat reads cleanly.
    this.effects.burst(pos.x, pos.y, [this.shop.hex(bottom.color), '#fff'], 8);
  }

  _deliver() {
    if (!this.running || this.paused || this.inWaveTransition || this.inCashout || this.player.frozen) return;
    if (this.player.locked) return;
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
    const topColor = stack[stack.length - 1].color;
    // Capture the cone-top position BEFORE popping so the flying scoop
    // animation knows where to launch from.
    const srcPos = this.player.scoopPosition(stack.length - 1);

    const result = this.shop.serveOne(index, topColor, rainbow);
    if (!result.accepted) {
      this.bus.emit('serveFail', /** @type {any} */ ({}));
      return;
    }

    // Customer took the top scoop — physically remove it from the tray and
    // queue the flying-scoop animation on the customer's mini-cone.
    this.player.popTop();
    const customer = this.shop.list[index];
    customer.order.served.push({ color: topColor, t: 0, srcX: srcPos.x, srcY: srcPos.y });

    // Cone leans toward the customer's face for a brief moment — the
    // "handing" gesture. Face center is groundY + CUSTOMER_FACE_OFFSET_PX,
    // modulated by their slide-in offset.
    const targetY = this.stations.groundY + CUSTOMER_FACE_OFFSET_PX + customer.yOff;
    this.player.triggerHandoff(customer.x, targetY);

    // Source burst at the cone — same family as the pop burst, so "giving"
    // and "letting go" feel like the same kind of action.
    this.effects.burst(srcPos.x, srcPos.y, [this.shop.hex(topColor), '#fff'], 10);

    const cx = customer.x;
    const cy = this.stations.groundY - 60;

    if (!result.complete) {
      this.sound.catch_();
      this.effects.popText(cx, cy, '✓', { color: '#43aa8b', size: 22, life: 0.5 });
      return;
    }

    // Final scoop — full completion FX (matches old serve() behavior).
    const { gained, colors, event } = result;
    this.health = Math.min(MAX_HEALTH, this.health + HEAL_PER_SERVE);

    // Recipe book: record the completion. Stash any first-time-unlocked
    // or just-mastered ids for the game-over celebration overlay. Then
    // forward to challenges so progress on discover/master/serve trackers
    // updates in real time.
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

    this.bus.emit('serve', {
      gained: gained ?? 0,
      colors: colors ?? [],
      combo: this.shop.combo,
      x: cx,
      y: cy
    });

    this.hud.setScore(this.shop.score);
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.hud.setGauge(this.waves.wave, this.waves.waveFraction);

    if (event === WAVE_EVENT.PHASE_UP) {
      this.bus.emit('phaseUp', /** @type {any} */ ({}));
    } else if (event === WAVE_EVENT.WAVE_UP) {
      this.bus.emit('waveUp', { wave: this.waves.wave });
      // Challenge tracking: new wave reached, and per-wave counters reset
      // (e.g. "pop X bubbles in one wave" starts over).
      this.challenges.recordWaveReached(this.waves.wave);
      this.challenges.recordWaveEnded();
      // The wave just completed is (waves.wave - 1) since waves.onServed
      // already incremented. Let the wave-up banner read, then run the
      // cashout animation, which opens the transition overlay when it ends.
      const completedWave = Math.max(1, (this.waves.wave || 1) - 1);
      setTimeout(() => this._runWaveCashout(completedWave), 700);
    }
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
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
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

  /** Cashout step 2: pop the active power-up bubble for show (no points), then finish. */
  _cashoutActive(completedWave) {
    if (!this.running) { this.inCashout = false; return; }
    if (this.activeBubble) {
      const pos = this._activeSlotPos();
      this.effects.burst(pos.x, pos.y, [PICKUP_RING_COLOR[this.activeBubble.type], '#fff'], 22);
      this.sound.bubblePop();
      this.activeBubble = null;
      this.powerups.reset();
      setTimeout(() => { this.inCashout = false; this._beginWaveTransition(completedWave); }, 220);
      return;
    }
    this.inCashout = false;
    this._beginWaveTransition(completedWave);
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
    this.hud.showWaveTransition({
      completedWave,
      onResume: () => this._endWaveTransition(),
      // Between-wave store: spend score (the windfall the cashout just paid out)
      // on survival. Lootboxes are off for now — heal is the only item.
      store: {
        healCost: HEAL_COST,
        getScore: () => this.shop.score,
        getHealthFull: () => this.health >= MAX_HEALTH,
        onBuyHeal: () => this._buyHeal()
      }
    });
  }

  /** Store: spend score to refill health. @returns {{ ok: boolean, score: number, healthFull: boolean }} */
  _buyHeal() {
    const full = this.health >= MAX_HEALTH;
    if (this.shop.score < HEAL_COST || full) return { ok: false, score: this.shop.score, healthFull: full };
    this.shop.score -= HEAL_COST;
    this.health = MAX_HEALTH;
    this.hud.setScore(this.shop.score);
    this.hud.setHealth(this.health / MAX_HEALTH);
    this.sound.heart();
    return { ok: true, score: this.shop.score, healthFull: true };
  }

  _endWaveTransition() {
    // Animation has finished and either the countdown expired or the
    // player hit Play — commit any earned-but-uncommitted challenges
    // and resume the loop.
    this.challenges.commitEarned();
    this.inWaveTransition = false;
    this.hud.hideWaveTransition();
  }

  _onExpire(count) {
    if (!this.flags.invincible) {
      this.health = Math.max(0, this.health - DAMAGE_PER_EXPIRE * count);
      this.hud.setHealth(this.health / MAX_HEALTH);
    }
    this.bus.emit('expire', { count });
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    if (this.health <= 0) this._endGame('Out of health! 😱');
  }

  _endGame(title = 'Out of health! 😱') {
    this.running = false;
    // Reset transition state in case the player died mid-pause (shouldn't
    // happen, but defensive).
    this.inWaveTransition = false;
    this.inCashout = false;
    this.sound.gameOver();
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
    const dayState = dayCycleState(this.waves.waveFraction, this.bounds);

    // Background: sky + sun, then sand on top of the sky. Everything after
    // this point draws over the floor — actors stay fully visible even
    // when their positions overlap the sand region.
    drawSkyAndSun(ctx, this.bounds, dayState);
    drawSand(ctx, this.bounds, dayState);

    this.field.draw(ctx, rainbow);
    this.pickups.draw(ctx);
    this.player.draw(ctx, rainbow);
    // Projectiles drawn after the cone so they look like they just left it.
    this.projectiles.draw(ctx);
    const pausePatience = this.powerups.pauseActive || !this.flags.patternTimer;
    this.stations.draw(ctx, this.shop.list, {
      activeIndex:    this.shop.customerAt(this.player.x),
      canServe:       i => this.shop.canServe(i, this.player.colors(), rainbow),
      hex:            c => this.shop.hex(c),
      pausePatience,
      rainbow
    });
    // Tutorial coin, plopping scoops, and control hints — over the scene but
    // under the effect bursts so a coin-collect pop reads on top.
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

    // Active power-up: screen-fixed indicator at bottom-center (when one runs).
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
   */
  _activateBubble(type, fromX) {
    if (this.activeBubble) {
      const pos = this._activeSlotPos();
      this.puLeaving.push({ type: this.activeBubble.type, x: pos.x, y: pos.y, r0: pos.r, t: 0 });
    }
    this.activeBubble = { type, fromX, anim: 0 };
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

    // The running power-up: floats up into the slot with its countdown ring + pulse.
    if (this.activeBubble) {
      const a = this.activeBubble;
      const e = 1 - (1 - a.anim) * (1 - a.anim);  // easeOut
      const startY = aslot.y + 70;
      const bx = a.fromX + (aslot.x - a.fromX) * e;
      const by = startY + (aslot.y - startY) * e;
      const pulse = 1 + 0.1 * a.anim * Math.sin(this.clock * 6);  // big pulse, ramps in
      const radius = aslot.r * (0.4 + 0.6 * e) * pulse;
      const frac = this.powerups.fraction(PICKUP_TO_POWER[a.type]);
      this._drawPowerupBubble(ctx, bx, by, radius, a.type, true, frac);
    }
    ctx.restore();
  }

  /**
   * The active power-up slot, centered along the bottom of the stage.
   * @returns {{ x: number, y: number, r: number }}
   */
  _activeSlotPos() {
    return { x: this.bounds.width / 2, y: this.bounds.height - 80, r: 40 };
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

    // Pickup bubbles — collision circle.
    for (const p of this.pickups.items) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PICKUP_RADIUS * PICKUP_BUBBLE_RADIUS_MULT, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cone: catch hitbox (solid AABB) + pickup hitbox (dashed, taller).
    const cb = this.player.catchHitbox();
    ctx.strokeRect(cb.x - cb.halfW, cb.y - cb.r, cb.halfW * 2, cb.r * 2);
    const pb = this.player.pickupHitbox();
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(pb.x - pb.halfW, pb.y - pb.r, pb.halfW * 2, pb.r * 2);
    ctx.setLineDash([]);

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
