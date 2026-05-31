// @ts-check
import {
  PHASE_ACTIVE,
  PHASE_GOAL,
  PHASES_PER_WAVE,
  WAVE_CELEBRATE_S,
  WAVE_RAMP,
  SPAWN_INTERVAL_START,
  SPAWN_INTERVAL_END,
  FALL_SPEED_MULT_END,
  PATTERN_TIME_START,
  PATTERN_TIME_END,
  COLOR_KEYS,
  lerp
} from './config.js';
import { recipesForWave } from './recipes.js';

// Wave 0 (the tutorial wave) clears once the player has served one of each of
// the base colors — a fixed, count-based goal rather than the phase arithmetic
// the campaign waves use.
const WAVE0_GOAL = COLOR_KEYS.length;

/** @typedef {import('./types.js').ScoopColor} ScoopColor */
/** @typedef {import('./types.js').WaveEventName} WaveEventName */
/** @typedef {import('./types.js').Tuning} Tuning */

export const WAVE_EVENT = Object.freeze({
  PHASE_UP: 'phaseUp',
  WAVE_UP:  'waveUp'
});

/**
 * Campaign director. The run is a progression of WAVES; each wave has 4 PHASES
 * with increasing customer count (1 -> 2 -> 3 -> 5) and serve goals
 * (3 -> 5 -> 8 -> 13). The pool of recipes grows with the wave number.
 *
 * onServed() is called by the shop on every successful delivery and returns
 * 'phaseUp' or 'waveUp' when a threshold is crossed, so the game can fire the
 * gauge animations.
 */
export class Waves {
  /**
   * @param {() => (Set<string> | null | undefined)} [getUnlockedSections]
   *   Returns the set of section ids the player has unlocked via
   *   challenges. If omitted, all wave-pool sections are available
   *   (legacy behaviour).
   */
  constructor(getUnlockedSections) {
    this.getUnlockedSections = getUnlockedSections || (() => null);
    /** @type {Set<ScoopColor>} Colors served in Wave 0 (completion + no-repeat). */
    this.servedColors = new Set();
    this.reset();
  }

  /** @param {number} [startWave] 0 = tutorial wave; 1 = skip straight to the campaign. */
  reset(startWave = 0) {
    this.wave = startWave;       // 0 = the tutorial wave; campaign proper is 1+
    this.phase = 1;              // 1-based, 1..PHASES_PER_WAVE
    this.servedInPhase = 0;
    this.completedPhases = 0;    // 0..PHASES_PER_WAVE — phases cleared this wave
    this.celebrating = 0;        // seconds left in the wave-up freeze
    // Colors served so far in Wave 0 — drives completion (one of each) and the
    // no-repeat-served-color spawn filter. Unused in waves 1+.
    this.servedColors = new Set();
  }

  /**
   * Force-end the wave-up celebration (used when the between-wave night cycle
   * takes over the reset): drop the gauge back to the start of the new wave so
   * it opens at dawn instead of holding on the previous sunset.
   */
  endCelebration() {
    this.celebrating = 0;
    this.completedPhases = 0;
  }

  get activeCount()    { return PHASE_ACTIVE[this.phase - 1]; }
  get phaseGoal()      { return PHASE_GOAL[this.phase - 1]; }
  get phaseFraction()  {
    // Keep the ring full through the celebration so it doesn't snap to 0.
    if (this.celebrating > 0) return 1;
    return Math.min(1, this.servedInPhase / this.phaseGoal);
  }
  get isCelebrating()  { return this.celebrating > 0; }

  /**
   * Wave-wide gauge fraction (0..1). Each phase contributes an equal slice of
   * the ring, so the earlier phases — with their smaller serve goals — push
   * the gauge up faster per serve. Capped during the celebration window.
   */
  get waveFraction() {
    if (this.celebrating > 0) return 1;
    if (this.wave === 0) return Math.min(1, this.servedColors.size / WAVE0_GOAL);
    return Math.min(1, (this.completedPhases + this.phaseFraction) / PHASES_PER_WAVE);
  }

  /**
   * Called by the shop after each successful serve. `colors` is the completed
   * order's color list (used by Wave 0 to track which flavors have been served).
   * @param {ScoopColor[]} [colors]
   * @returns {WaveEventName | null}
   */
  onServed(colors = []) {
    if (this.celebrating > 0) return null;

    // Wave 0 (tutorial): no phase arithmetic — clear once one of each color has
    // been served, then advance into Wave 1.
    if (this.wave === 0) {
      for (const c of colors) this.servedColors.add(c);
      if (this.servedColors.size < WAVE0_GOAL) return null;
      this.wave = 1;
      this.phase = 1;
      this.servedInPhase = 0;
      this.completedPhases = 0;
      this.celebrating = WAVE_CELEBRATE_S;
      return WAVE_EVENT.WAVE_UP;
    }

    this.servedInPhase += 1;
    if (this.servedInPhase < this.phaseGoal) return null;

    if (this.phase < PHASES_PER_WAVE) {
      this.completedPhases = this.phase;   // bank credit for the phase we just cleared
      this.phase += 1;
      this.servedInPhase = 0;
      return WAVE_EVENT.PHASE_UP;
    }
    // Wave cleared — celebrate, then reset to phase 1 of the next wave.
    this.completedPhases = PHASES_PER_WAVE;
    this.wave += 1;
    this.phase = 1;
    this.servedInPhase = 0;
    this.celebrating = WAVE_CELEBRATE_S;
    return WAVE_EVENT.WAVE_UP;
  }

  /**
   * Debug helper: jump straight to wave N, phase 1. Used by the debug panel
   * for fast-forwarding through the campaign during testing. Shop reconciles
   * its active customer count on the next update tick.
   * @param {number} n
   */
  jumpToWave(n) {
    this.wave = Math.max(1, Math.floor(n));
    this.phase = 1;
    this.servedInPhase = 0;
    this.completedPhases = 0;
    this.celebrating = 0;
  }

  /**
   * Debug helper: jump to a specific time-of-day fraction (0..1) within the
   * current wave. 0 = dawn (start of phase 1), 1 ≈ sunset (just before wave
   * completes). Recomputes phase / completedPhases / servedInPhase so both
   * the wave-progress gauge and the day-cycle sun land at the requested
   * position.
   * @param {number} fraction
   */
  jumpToFraction(fraction) {
    const f = Math.max(0, Math.min(0.999, fraction));
    const phaseIdx = Math.min(PHASES_PER_WAVE - 1, Math.floor(f * PHASES_PER_WAVE));
    const remaining = f * PHASES_PER_WAVE - phaseIdx;
    this.completedPhases = phaseIdx;
    this.phase = phaseIdx + 1;
    this.servedInPhase = Math.floor(remaining * PHASE_GOAL[phaseIdx]);
    this.celebrating = 0;
  }

  /**
   * Pips reset after the celebration window so the next wave starts fresh.
   * @param {number} dt
   */
  update(dt) {
    if (this.celebrating > 0) {
      this.celebrating = Math.max(0, this.celebrating - dt);
      if (this.celebrating === 0) this.completedPhases = 0;
    }
  }

  /**
   * Roll a random recipe from this wave's pool of *active* recipes. Each
   * recipe brings its own point value and combo weight (from its group).
   * @returns {{ recipe: string, colors: ScoopColor[], value: number, weight: number }}
   */
  pickOrder() {
    const unlocked = this.getUnlockedSections() || undefined;
    let pool = recipesForWave(/** @type {number} */ (this.wave), unlocked);
    // Wave 0: never hand out a color the player has already served, so each of
    // the five junior flavors comes up exactly once.
    if (this.wave === 0 && this.servedColors.size > 0) {
      const filtered = pool.filter(r => !r.colors.every(c => this.servedColors.has(c)));
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) {
      // Defensive fallback — at minimum the Junior Scoop section is always
      // unlocked, so this branch should only fire if WAVE_GROUPS is broken.
      return { recipe: 'pink', colors: ['pink'], value: 60, weight: 1 };
    }
    const r = pool[Math.floor(Math.random() * pool.length)];
    return {
      recipe: r.id,
      colors: r.colors.slice(),
      value:  r.value,
      weight: r.weight
    };
  }

  /**
   * Per-wave difficulty for the falling-scoop field and customer patience.
   * @param {boolean} [escalate]
   * @returns {Tuning}
   */
  tuning(escalate = true) {
    const s = escalate ? Math.min(1, (this.wave - 1) / WAVE_RAMP) : 0;
    return {
      spawnInterval: lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, s),
      fallMult:      lerp(1, FALL_SPEED_MULT_END, s),
      patience:      lerp(PATTERN_TIME_START, PATTERN_TIME_END, s)
    };
  }
}

// Per-recipe color generation lives in recipes.js now — orders carry their
// own pre-baked color list, so the template-based helpers that used to live
// here are no longer needed.
