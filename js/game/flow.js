// @ts-check
// The run's flow state machine. Owns the phase flags (cashout / night cycle /
// round intro / death / game over / pause menu), the between-state timing, and
// the scripted sequences that play between live gameplay — the wave-end cashout,
// the between-day night sweep, and the game-over teardown.
//
// The coordinator (game.js) owns construction, run-init (start), input routing,
// the HUD pull, and the Loop; it drives this from the loop callbacks (stepping()
// + tick()) and routes input through its gates (blocksPlay). The master run
// switches `running` (lifecycle) and `paused` (debug pause) stay on the
// coordinator — this reads them via the back-reference. The scripted sequences
// reach into the World + presentation, so this holds a `game` ref rather than a
// long list of dependencies: it IS the part of the coordinator that choreographs
// between-state beats.
//
// All timed steps run on a Scheduler, so a single cancelAll() on teardown
// (reset / goHome / game over) stops any chain mid-flight — no per-step "am I
// still in this phase?" guards, and no orphan timer landing in the next run.
import { SCORING, CONE } from './config.js';
import { coinDwellMs } from '../ui/hud/coinCarousel.js';
import { PICKUP_RING_COLOR } from '../ui/powerupVisuals.js';
import { Scheduler } from '../engine/scheduler.js';

// Between-wave reset beat: a sped-up night cycle (sunset→midnight→dawn, crescent
// moon arcing across) that plays after the cashout and before the next day.
const NIGHT_CYCLE_S = 2.8;   // slightly slower: room for the day-start beat (cone recenters, day # rolls over)
// Fresh game start: how long the week's challenges hold in the sky (sim frozen)
// before they dissolve into the round. Between rounds the night sweep covers this.
const INTRO_HOLD_S = 2.2;
// Waffle-cone debris palette for the game-over fracture (tan / caramel / cream chunks).
const CONE_SHARD_COLORS = ['#e8b06a', '#d99a4e', '#c98a3c', '#fff4d6'];

// Title "attract" screen: the scoop trio (bottom→top) that plops onto the centered
// cone before the title fades in, plus the plop timing.
const ATTRACT_SCOOPS = ['choco', 'pink', 'mint'];
// Attract beat order: the logo SIGN fades in FIRST, holds, THEN the scoops plop
// onto the cone (the sign's arrow points at them), and finally the tap-to-begin +
// buttons fade in. Each fade is a slow opacity transition — see styles.css.
const ATTRACT_LOGO_HOLD_MS = 850;  // sign fade-in beat before the first scoop drops
const ATTRACT_PLOP_GAP_MS  = 360;  // gap between successive plops
const ATTRACT_BUTTONS_MS   = 300;  // beat after the last plop before tap-to-begin + buttons fade in
const ATTRACT_LAUNCH_MS = 160;  // beat after the last pop before start() (→ the challenge list)

export class GameFlow {
  /** @param {import('../game.js').Game} game the coordinator back-reference */
  constructor(game) {
    this.game = game;
    // All scripted timing runs here; cancelAll() on teardown stops any chain.
    this.sched = new Scheduler();

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
    // day number over early. Cleared at night-cycle completion. See game._syncHud.
    this.dayRolling = false;
    // Round-start intro: a brief beat that freezes the sim (no scoops/customers)
    // until it ends. Runs at each day's start (after the night sweep) and on the
    // first campaign day; skipped during the scripted tutorial.
    this.inRoundIntro = false;
    this.roundIntroT = 0;
    // Dedicated "Esc" pause menu — separate from the debug-panel pause.
    this.inPauseMenu = false;
    // Set once the game-over panel is up. Stepping is dead, but effects keep
    // updating so the death shake tapers off instead of jittering forever (the
    // loop keeps rendering the ambient scene behind the panel).
    this.inGameOver = false;
    // Title "attract" screen (the resting state between runs): the ambient beach
    // keeps animating with the sim frozen, the cone sits centered + frozen with
    // its ghost scoops, and the loop renders so clouds/ocean/effects move. Set by
    // enterAttract, cleared by exitAttract (when a run starts).
    this.inAttract = false;
    // Guards the tap-to-play handoff so a double tap can't start two runs.
    this._launching = false;
  }

  /**
   * Clear all phase state for a fresh run and cancel any orphaned timers from a
   * prior run (a chain abandoned via goHome would otherwise fire into this one).
   * Called by game.start(); `running` is flipped on by the coordinator.
   */
  reset() {
    this.sched.cancelAll();
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = false;
    this.inDeath = false;
    this.nightT = 0;
    this._nightDuration = NIGHT_CYCLE_S;
    this.dayRolling = false;
    this.inRoundIntro = false;
    this.inPauseMenu = false;
    this.inAttract = false;
    this._launching = false;
  }

  /**
   * Gate for the fixed-step pump (the Loop's `shouldStep`). The sim advances only
   * during live play — paused, the pause menu, the cashout, the night-cycle, the
   * round intro, and the death sequence all freeze it.
   * @returns {boolean}
   */
  stepping() {
    const g = this.game;
    return g.running && !g.paused &&
      !this.inPauseMenu && !this.inCashout && !this.inNightCycle && !this.inRoundIntro && !this.inDeath;
  }

  /**
   * Phases that freeze the discrete play verbs (pop / serve / toss-cancel).
   * @returns {boolean}
   */
  get blocksPlay() {
    return this.inNightCycle || this.inCashout || this.inDeath;
  }

  /**
   * Per-frame variable-step advancement (driven from game._frame): the between-
   * wave night-cycle sweep and the fresh-start round intro. Both lift their freeze
   * and dissolve the sky when their timer lands.
   * @param {number} frame seconds since the last frame (clamped by the Loop)
   */
  tick(frame) {
    const g = this.game;
    // Title attract screen: the sim is frozen (running=false), so tick the cone
    // directly — its passive timers run the ghost-scoop plop squash + slosh settle
    // while it stays centered and frozen (no movement).
    if (this.inAttract) g.world.player.update(frame, g.input, g.bounds);

    // Between-wave night cycle: a fast sunset→midnight→dawn sweep (moon arcs
    // across); when it lands the freeze lifts and the next day resumes.
    if (this.inNightCycle) {
      this.nightT += frame / (this._nightDuration || NIGHT_CYCLE_S);
      if (this.nightT >= 1) {
        this.nightT = 1;
        this.inNightCycle = false;
        // Night sweep done — release the gauge hold so the new day's number shows,
        // and reset the per-day power-up counter. The round starts now: the sky
        // challenges dissolve into it and the in-game HUD fades back in.
        this.dayRolling = false;
        g.world.challenges.recordWaveEnded();
        g.world.shop.resetDayCombo();
        g.hud.dissolveNightSky();
      }
    }

    // Fresh-start intro: hold the sky challenges (sim frozen), then dissolve them
    // into the round — the dissolve IS the start (no countdown).
    if (this.inRoundIntro) {
      this.roundIntroT += frame;
      if (this.roundIntroT >= INTRO_HOLD_S) {
        this.inRoundIntro = false;
        g.hud.dissolveNightSky();
      }
    }
  }

  /**
   * Esc: toggle the pause menu. Suppressed during the between-day sky beat (night
   * cycle / round intro) and while the game isn't running (Esc on the start /
   * game-over screen would be confusing).
   */
  togglePause() {
    const g = this.game;
    if (!g.running) return;
    if (this.inNightCycle || this.inRoundIntro || this.inDeath) return;   // not during the sky beat / death
    if (this.inPauseMenu) {
      this.inPauseMenu = false;
      g.hud.hidePauseMenu();
    } else {
      this.inPauseMenu = true;
      g.hud.showPauseMenu({ onResume: () => this.togglePause() });
    }
  }

  /**
   * Abandon the current run (if any) and return to the title screen — wired to the
   * 🏠 Home buttons on the pause and game-over menus. cancelAll() kills any cashout
   * / death chain in flight so it can't fire into the title or the next run.
   */
  goHome() {
    const g = this.game;
    // Persist earned-but-uncommitted challenge progress before leaving (mirrors
    // _endGame; commitEarned is idempotent if the run already ended).
    g.world.challenges.commitEarned();
    // Drop into the title attract screen — it cancels any in-flight chain, stops
    // the run loop, clears every phase, and replays the ghost-scoop intro.
    this.enterAttract();
  }

  // === Title / attract screen =================================================

  /**
   * True while the canvas title sign (ui/view/titleLogoView.js) should be visible:
   * on the attract screen and not yet launching a run. Flips false the instant a
   * tap starts play, so the sign fades out as the scoops pop.
   */
  get showAttractLogo() { return this.inAttract && !this._launching; }

  /**
   * Enter the title "attract" screen — the resting state between runs and the
   * first thing shown on boot. The ambient beach keeps animating (clouds, ocean)
   * with the sim FROZEN; the cone sits centered + frozen. The logo sign fades in
   * FIRST, then three ghost scoops plop onto the cone one by one (the sign's arrow
   * points at them), then the tap-to-begin + buttons fade in. Tapping to play
   * (beginPlay) bursts the scoops and starts the run. Idempotent.
   */
  enterAttract() {
    const g = this.game;
    // Wake the audio context now so the ghost-scoop plops are audible — nothing
    // else resumes it before they fire on the title screen (it's otherwise only
    // unlocked on a gesture / at run start). On a cold first load the browser may
    // still hold it suspended until the first tap; the global first-gesture unlock
    // (game.js) then covers any plops still in flight.
    g.sound.resume();
    this.sched.cancelAll();
    g.loop.stop();
    g.running = false;
    g.paused = false;
    // Clear every run phase — this IS the between-runs resting state.
    this.inCashout = false;
    this.inNightCycle = false;
    this.inDeath = false;
    this.inGameOver = false;
    this.inPauseMenu = false;
    this.inRoundIntro = false;
    this.dayRolling = false;
    this.nightT = 0;
    this._launching = false;
    // Clear any leftover actors from a finished run so the title shows a clean
    // beach (the loop now renders live, so stale customers / falling scoops /
    // power-up indicators would otherwise linger).
    g.world.field.reset();
    g.world.shop.customers.length = 0;
    g.world.activeBubble = null;
    g.world.puLeaving.length = 0;
    g.world.powerups.reset();
    // Cone: centered, frozen, empty, no death debris.
    const p = g.world.player;
    p.reposition(g.bounds.width / 2, CONE.Y);
    p.clearStack();
    p.frozen = true;
    p.fractured = false;
    g.effects.reset();
    g.input.moveDelta = 0;
    this.inAttract = true;
    // Everything starts faded out; the menu HUD fade stays on.
    g._dayHintShown = false;
    g.hud.setDayHint(false);
    g.hud.beginAttract();
    // Render-only loop: shouldStep() is false (running=false), so the sim never
    // advances — but _frame keeps painting the moving scene and ticking the cone
    // (tick) + effects so the plops animate.
    g.loop.start({
      shouldStep: () => this.stepping(),
      step: dt => g._step(dt),
      render: (dt, alpha) => g._frame(dt, alpha)
    });
    // Sign FIRST: the canvas logo (titleLogoView, gated by showAttractLogo) fades
    // itself in now; revealHomeTitle just turns on tap-to-play. Hold a beat so the
    // sign reads before the scoops, THEN start plopping them onto the cone.
    g.hud.revealHomeTitle();
    this.sched.after(ATTRACT_LOGO_HOLD_MS, () => this._attractPlop(0));
  }

  /**
   * Plop ghost scoop `i` onto the cone (it lands with the squash-pop), then chain
   * to the next — or, once all three are on, fade in the tap-to-begin + buttons.
   * @param {number} i
   */
  _attractPlop(i) {
    const g = this.game;
    if (!this.inAttract) return;
    if (i >= ATTRACT_SCOOPS.length) { this._revealHome(); return; }
    const color = /** @type {import('../types.js').ScoopColor} */ (ATTRACT_SCOOPS[i]);
    g.world.player.push(color);
    // Same springy recoil as a real catch — no fall speed for a ghost, so let it
    // default to the reference heft (a gentle, "normal" plop).
    g.world.player.triggerRecoil();
    const pos = g.world.player.scoopPosition(i);
    g.effects.burst(pos.x, pos.y, [g.world.shop.hex(color), '#fff'], 9);
    g.sound.catch_();
    this.sched.after(ATTRACT_PLOP_GAP_MS, () => this._attractPlop(i + 1));
  }

  /** Scoops are on — fade in the tap-to-begin + buttons (the sign is already up). */
  _revealHome() {
    const g = this.game;
    if (!this.inAttract) return;
    this.sched.after(ATTRACT_BUTTONS_MS, () => {
      if (this.inAttract) g.hud.revealHomeButtons();
    });
  }

  /**
   * Tap-to-play from the attract screen: fade the title out, pop the scoops off the
   * cone one at a time (the same beat + sounds as the end-of-round cashout), then
   * start the run — which raises the round's challenge list right as the cone
   * empties. Cancels any pending plops/reveal and guards against a double tap. Off
   * the attract screen, starts the run directly.
   */
  beginPlay() {
    const g = this.game;
    if (!this.inAttract) { g.start(); return; }
    if (this._launching) return;
    this._launching = true;
    g.sound.resume();          // unlock audio (within the tap gesture) so the pops sound
    this.sched.cancelAll();    // stop any queued plops / reveal stages
    g.hud.fadeHomeOut();       // title + buttons fade out
    // Pop the first scoop NOW — synchronously inside the tap gesture — so its sound
    // actually fires (a setTimeout'd first pop plays outside the gesture and gets
    // dropped by the autoplay policy). The rest chain on the cashout beat.
    this._attractPopStack();
  }

  /**
   * Tap-to-play pop step: pop the cone's top scoop with a burst + the cashout sound,
   * then chain down (the end-of-round teardown beat). Empty → start the run.
   */
  _attractPopStack() {
    const g = this.game;
    if (!this._launching) return;
    const stack = g.world.player.stack;
    if (stack.length === 0) { this.sched.after(ATTRACT_LAUNCH_MS, () => g.start()); return; }
    const idx = stack.length - 1;
    const pos = g.world.player.scoopPosition(idx);
    const color = stack[idx].color;
    g.world.player.popTop();
    g.effects.burst(pos.x, pos.y, [g.world.shop.hex(color), '#fff'], 14);
    g.sound.catch_();
    this.sched.after(120, () => this._attractPopStack());
  }

  /**
   * Leave the attract screen as a run starts (called by game.start). Clears the
   * attract flags; start() drives the rest of the reset.
   */
  exitAttract() {
    this.inAttract = false;
    this._launching = false;
  }

  // === Wave-end cashout =======================================================

  /** Day complete (sim emitted waveUp): hold the HUD day number, then cash out. */
  onWaveUp() {
    // Hold the HUD day number (it rolls over at night-end), let the banner read,
    // then run the cashout, which hands off to the night sweep.
    this.dayRolling = true;
    this.sched.after(700, () => this._runWaveCashout());
  }

  /**
   * Wave-end cashout. Freezes gameplay (effects keep animating) and runs a
   * payout chain: bank the combo → pop the tray stack top-to-bottom → pop the
   * active bubble for show (no points) → hand off to the night sweep. Reaches into
   * World models — it's a scripted presentation sequence, not part of the sim step.
   */
  _runWaveCashout() {
    const g = this.game;
    if (!g.running) return;
    this.inCashout = true;

    // Clear the board: pop every scoop still falling, so the wave ends on an
    // empty field before the night-cycle reset.
    this._clearFieldFx();

    // Combo bank.
    const combo = g.world.shop.bankCombo();
    if (combo > 0) {
      const gain = combo * SCORING.COMBO_CASHOUT_PER;
      g.world.shop.addScore(gain);
      const c = g.hud.gaugeCenter() || { x: g.bounds.width / 2, y: g.bounds.height * 0.3 };
      g.effects.popText(c.x, c.y, `Combo ×${combo} → +${gain}`, { color: '#ff6fa3', size: 30, life: 1.3 });
      g.effects.burst(c.x, c.y, ['#ff6fa3', '#ffd166', '#fff'], 24);
      g.sound.perfect();
    }
    g._syncComboHud();

    this.sched.after(combo > 0 ? 500 : 150, () => this._cashoutStack());
  }

  /** Cashout step 1: pop the tray stack top-to-bottom, then the active power-up. */
  _cashoutStack() {
    const g = this.game;
    if (!g.running) { this.inCashout = false; return; }
    if (g.world.player.stack.length === 0) { this._cashoutActive(); return; }
    const idx = g.world.player.stack.length - 1;
    const pos = g.world.player.scoopPosition(idx);
    const color = g.world.player.stack[idx].color;
    g.world.player.popTop();
    // Leftover tray scoops at wave-end just pop for show now — no points, no "+N"
    // text (that was a vestigial reward; the score never meaningfully moved).
    g.effects.burst(pos.x, pos.y, [g.world.shop.hex(color), '#fff'], 14);
    g.sound.catch_();
    this.sched.after(120, () => this._cashoutStack());
  }

  /**
   * Cashout step 2: pop the active power-up bubble for show (no points), then
   * hand off to the night sweep.
   */
  _cashoutActive() {
    const g = this.game;
    if (!g.running) { this.inCashout = false; return; }
    const finish = () => {
      this.inCashout = false;
      this._beginNightHandoff();
    };
    if (g.world.activeBubble) {
      const pos = g.world.activeSlotPos();
      g.effects.burst(pos.x, pos.y, [PICKUP_RING_COLOR[g.world.activeBubble.type], '#fff'], 22);
      g.sound.bubblePop();
      g.world.activeBubble = null;
      g.world.powerups.reset();
      this.sched.after(220, finish);
      return;
    }
    finish();
  }

  /**
   * Pop every falling scoop for the wave-end board clear. Visual only (no
   * points) — the cashout already paid out the tray + combo.
   */
  _clearFieldFx() {
    const g = this.game;
    for (const s of g.world.field.scoops) {
      if (s.dissolve !== undefined) continue;  // already fizzling out
      g.effects.burst(s.x, s.y, [g.world.shop.hex(s.color), '#fff'], 10);
    }
    g.world.field.scoops.length = 0;
    g.sound.bubblePop();
  }

  // === Between-day night cycle ================================================

  /**
   * Between-day reset: the night-cycle sweep (sunset → midnight → dawn) that plays
   * straight after the cashout — no modal. The sky shows the recap (checked-off
   * challenges + the day's earned coins) over it, then dissolves into the next day.
   * tick() advances nightT and lifts the freeze when it lands; endCelebration()
   * makes the next day open at dawn. The sweep stretches with the coin count so
   * each flips and reads before the dissolve.
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} [recap]
   */
  _runNightCycle(recap = null) {
    const g = this.game;
    if (!g.running) return;
    g.world.waves.endCelebration();
    // Reset the cone to center for the fresh day — it snaps back during the night
    // sweep so every day opens from the middle.
    g.world.player.reposition(g.bounds.width / 2, CONE.Y);
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
    g.hud.showNightSky(recap);
  }

  /**
   * Fresh game start (no night sweep): hold the week's challenges in the sky with
   * the sim frozen, then tick() dissolves them into the round. Skipped during the
   * scripted tutorial, which paces itself.
   */
  startRoundIntro() {
    const g = this.game;
    if (g.tutorial.active) { this.inRoundIntro = false; return; }
    this.inRoundIntro = true;
    this.roundIntroT = 0;
    g.hud.showNightSky();
  }

  /**
   * End-of-day / end-of-run stat card: score, the day's best combo, the run's
   * longest combo, and the flavor completed most often. Used by the game-over screen.
   */
  _dayStats() {
    const g = this.game;
    let fav = null;
    for (const r of g.world.recipes.getAll()) {
      if (r.count > 0 && (!fav || r.count > fav.count)) fav = r;
    }
    return {
      score: g.world.shop.score,
      dayCombo: g.world.shop.dayBestCombo,
      bestCombo: g.world.shop.bestCombo,
      favFlavor: fav ? fav.name : '—'
    };
  }

  /**
   * Between-day handoff — NO modal (the old wave-transition screen tested as
   * distracting). Commit the day's earned challenges (granting any set reward once),
   * then run the night cycle, handing it the coins to flip in the sky: regulars met,
   * the set reward just granted, and recipes discovered today. The next SET only ever
   * reveals on death (game over), never here — so finishing a set's goals mid-run
   * doesn't surface the next set until the run ends.
   */
  _beginNightHandoff() {
    const g = this.game;
    if (!g.running) return;
    // Effects are frozen during the night sweep (the loop doesn't update them), so
    // flush any in-flight pop-text / bursts now — otherwise they'd hang motionless.
    g.effects.reset();
    const result = g.world.challenges.commitEarned();
    this._runNightCycle({
      reveals: [
        ...g.world.drainTutorialReveals(),
        ...g.world.regulars.drainPendingReveals()
      ],
      rewards: result.rewards || [],
      discoveries: g.world.drainPendingDiscoveries()
    });
  }

  // === Game-over teardown =====================================================

  /** Sim emitted gameOver: start the scripted death teardown. */
  onGameOver() {
    this._beginDeath();
  }

  /**
   * Game over. Instead of freezing instantly, play a scripted teardown with the loop
   * still ALIVE (the sim frozen via inDeath): first the tray scoops pop, then — all
   * overlapping — the falling scoops pop, the customers storm off angry, and the cone
   * fractures; the menu (_endGame) raises once the last customer has left. Guarded
   * against re-entry.
   */
  _beginDeath() {
    const g = this.game;
    if (this.inDeath || this.inGameOver) return;
    this.inDeath = true;
    g._dayHintShown = false;
    g.hud.setDayHint(false);
    g.sound.gameOver();
    g.haptics.gameOver();
    g.effects.addShake(9);
    // A beat to register the loss, then start popping the cone's tray.
    this.sched.after(360, () => this._deathPopStack());
  }

  /** Death step 2: pop the scoops sitting on the cone, top to bottom. */
  _deathPopStack() {
    const g = this.game;
    if (!this.inDeath) return;
    const stack = g.world.player.stack;
    if (stack.length === 0) { this._deathTeardown(); return; }
    const idx = stack.length - 1;
    const pos = g.world.player.scoopPosition(idx);
    const color = stack[idx].color;
    g.world.player.popTop();
    g.effects.burst(pos.x, pos.y, [g.world.shop.hex(color), '#fff'], 14);
    g.sound.catch_();
    this.sched.after(120, () => this._deathPopStack());
  }

  /**
   * Death steps 3–5, OVERLAPPING: pop the falling scoops, start the customers
   * storming off right away, and fracture the cone a beat later — so the crowd is
   * already leaving while the sky clears and the cone explodes. The customer walk-off
   * is the long pole and raises the menu when it finishes (_deathCustomersLeave).
   */
  _deathTeardown() {
    if (!this.inDeath) return;
    this._clearFieldFx();                                       // pop the scoops still in the air
    this._deathCustomersLeave();                                // customers begin leaving now
    this.sched.after(220, () => this._deathFractureCone());     // cone explodes mid-exodus
  }

  /** The cone fractures into tumbling waffle chunks and is gone (plays mid-exodus). */
  _deathFractureCone() {
    const g = this.game;
    if (!this.inDeath) return;
    const p = g.world.player;
    g.effects.fracture(p.x, p.y, CONE_SHARD_COLORS, 20);
    g.effects.burst(p.x, p.y, [...CONE_SHARD_COLORS, '#fff'], 12);
    g.effects.addShake(13);
    p.fractured = true;          // the view stops drawing the cone from here
    g.sound.bad();
  }

  /**
   * Death step 5: the remaining customers lose patience and storm off, one by one —
   * each goes angry (shaking) for a beat, then slides away (animated by shop.animateExit
   * in game._frame). When the last has gone, raise the game-over menu (step 6).
   */
  _deathCustomersLeave() {
    const g = this.game;
    if (!this.inDeath) return;
    const shop = g.world.shop;
    const remaining = shop.activeCustomers();
    if (remaining.length === 0) { this.sched.after(350, () => this._endGame()); return; }
    const STAGGER = 300, ANGER_HOLD = 520, SLIDE = 760;
    remaining.forEach((c, i) => {
      const t0 = i * STAGGER;
      this.sched.after(t0, () => { if (this.inDeath) { shop.angerCustomer(c); g.sound.bad(); } });
      this.sched.after(t0 + ANGER_HOLD, () => { if (this.inDeath) shop.sendOff(c); });
    });
    const total = (remaining.length - 1) * STAGGER + ANGER_HOLD + SLIDE + 200;
    this.sched.after(total, () => this._endGame());
  }

  /** The death sequence finished — freeze the loop and raise the game-over menu. */
  _endGame() {
    const g = this.game;
    g.running = false;
    g.loop.stop();
    // The death sequence ran with the loop alive; now end it.
    this.inDeath = false;
    this.inCashout = false;
    this.inNightCycle = false;
    this.inGameOver = true;
    g._dayHintShown = false;
    g.hud.setDayHint(false);
    // (sound.gameOver / haptics fired at the START of the sequence, in _beginDeath.)
    // Challenges commit INSIDE the game-over recap (so the cross-off animation +
    // reward coins play there); we just hand it the final run's pending reveals /
    // discoveries to flip alongside them. Draining here means they don't linger as a
    // "backlog" into the next run's sky.
    g.hud.showGameOver(
      this._dayStats(),
      () => g.start(),
      g.world.sessionRecipeEvents,
      {
        reveals: [
          ...g.world.drainTutorialReveals(),
          ...g.world.regulars.drainPendingReveals()
        ],
        discoveries: g.world.drainPendingDiscoveries()
      }
    );
  }
}
