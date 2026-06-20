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
  ORDER_SIZE_WEIGHTS,
  DISCOVERY_BIAS_START,
  DISCOVERY_BIAS_END,
  lerp,
  pickWeighted
} from './config.js';
import { recipesForWave, ALL_RECIPES, GROUP } from './recipes.js';

// Wave 0 (the scripted tutorial day) clears after a fixed number of SERVES. The
// scripted tutorial guides 7 of them (move, patience demo, a pop lesson, a two-
// customer serve, a tip) then hands off to 4 free-play customers, so the day-meter
// fills ~one slice per serve and lands on a complete day right as the tutorial
// ends. Count-based (not the phase arithmetic the campaign waves use).
const WAVE0_GOAL = 11;

// A week is this many days. The per-week DAY (1..WEEK_DAYS) drives difficulty and
// the recipe-complexity ramp, so both reset every week; the absolute `wave` keeps
// climbing for sim continuity. Keep in step with WEEK_DAYS in challenges.js.
const WEEK_DAYS = 7;

// Always-available order used only if the section/wave pool somehow resolves
// empty (Junior Scoop is never gated, so this should never fire). Pulled from the
// catalog instead of a hand-typed recipe so its id/colors/value can't drift from
// the real Junior Scoop single.
const FALLBACK_RECIPE = ALL_RECIPES.find(r => r.group === GROUP.JUNIOR_SCOOP) || ALL_RECIPES[0];

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../types.js').WaveEventName} WaveEventName */
/** @typedef {import('../types.js').Tuning} Tuning */

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
   * @param {(recipeId: string) => boolean} [isDiscovered]
   *   True if the player has already completed the given recipe at least once.
   *   Drives the new-recipe discovery bias in pickOrder. Defaults to "nothing
   *   discovered" (so the bias, if it fires, simply picks among all candidates).
   */
  constructor(getUnlockedSections, isDiscovered) {
    this.getUnlockedSections = getUnlockedSections || (() => null);
    this.isDiscovered = isDiscovered || (() => false);
    // Declared here (not just in reset) so checkJs infers plain `number` rather
    // than `number | undefined` — reset() is called below but TS doesn't trace it.
    this.wave = 0;            // 0 = the tutorial wave; campaign proper is 1+ (absolute, climbs)
    this.weekStartWave = 0;   // absolute `wave` the current week began at — dayInWeek = wave − this
    this.phase = 1;           // 1-based, 1..PHASES_PER_WAVE
    this.servedInPhase = 0;
    this.completedPhases = 0; // 0..PHASES_PER_WAVE — phases cleared this wave
    this.celebrating = 0;     // seconds left in the wave-up freeze
    /** @type {Set<ScoopColor>} Colors served in Wave 0 (no-repeat spawn filter). */
    this.servedColors = new Set();
    this.servedCount = 0;     // Wave 0 only: total serves toward WAVE0_GOAL.
    this.reset();
  }

  /** @param {number} [startWave] 0 = tutorial wave; 1 = skip straight to the campaign. */
  reset(startWave = 0) {
    this.wave = startWave;       // 0 = the tutorial wave; campaign proper is 1+
    this.weekStartWave = startWave - 1;  // so the opening day reads as dayInWeek 1
    this.phase = 1;              // 1-based, 1..PHASES_PER_WAVE
    this.servedInPhase = 0;
    this.completedPhases = 0;    // 0..PHASES_PER_WAVE — phases cleared this wave
    this.celebrating = 0;        // seconds left in the wave-up freeze
    // Wave 0 only: total serves toward WAVE0_GOAL (drives the day meter + day
    // end), and the set of colors served so far (the no-repeat spawn filter).
    this.servedCount = 0;
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
   * Per-week day (1..WEEK_DAYS). Difficulty (tuning) and the recipe-complexity
   * ramp key off this rather than the absolute `wave`, so both restart each week.
   * The tutorial (wave 0) reads as Day 1.
   */
  get dayInWeek() {
    return Math.max(1, Math.min(WEEK_DAYS, this.wave - this.weekStartWave));
  }

  /** Days in a week (the meter denominator). */
  get weekDays() { return WEEK_DAYS; }

  /** Per-week day (1..WEEK_DAYS) for an arbitrary absolute wave (e.g. a completed day). */
  dayInWeekFor(absWave) {
    return Math.max(1, Math.min(WEEK_DAYS, absWave - this.weekStartWave));
  }

  /**
   * Re-anchor the week to the current day so dayInWeek reads 1 again and the
   * difficulty/recipe ramp restarts from the easiest. Called by the coordinator
   * once a Week is completed (challenges done + the 7th day reached).
   */
  startNewWeek() {
    this.weekStartWave = this.wave - 1;
  }

  /**
   * Wave-wide gauge fraction (0..1). Each phase contributes an equal slice of
   * the ring, so the earlier phases — with their smaller serve goals — push
   * the gauge up faster per serve. Capped during the celebration window.
   */
  get waveFraction() {
    if (this.celebrating > 0) return 1;
    if (this.wave === 0) return Math.min(1, this.servedCount / WAVE0_GOAL);
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

    // Wave 0 (scripted tutorial): no phase arithmetic — count serves until
    // WAVE0_GOAL, then advance into Wave 1.
    if (this.wave === 0) {
      this.servedCount += 1;
      for (const c of colors) this.servedColors.add(c);
      if (this.servedCount < WAVE0_GOAL) return null;
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
   * Roll the next customer order. Two-stage, so the order-SIZE mix is controlled
   * independently of how many recipes of each size exist:
   *   1. Roll a size by the per-wave ORDER_SIZE_WEIGHTS, restricted to the sizes
   *      actually present in this wave's (section-gated) pool, then renormalized.
   *   2. Among recipes of that size, apply the wave-scaled discovery bias —
   *      with probability DISCOVERY_BIAS_*(wave), prefer one the player has not
   *      yet discovered — then pick uniformly. Each recipe carries its own point
   *      value and combo weight (from its group).
   * @returns {{ recipe: string, colors: ScoopColor[], value: number, weight: number }}
   */
  pickOrder() {
    const wave = this.wave;          // absolute — only the tutorial (wave 0) special-cases
    const day = this.dayInWeek;      // per-week day — drives the complexity ramp (resets weekly)
    const unlocked = this.getUnlockedSections() || undefined;
    let pool = recipesForWave(day, unlocked);
    // Wave 0: never hand out a color the player has already served, so each of
    // the five junior flavors comes up exactly once.
    if (wave === 0 && this.servedColors.size > 0) {
      const filtered = pool.filter(r => !r.colors.every(c => this.servedColors.has(c)));
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) {
      // Defensive fallback — at minimum the Junior Scoop section is always
      // unlocked, so this branch should only fire if WAVE_GROUPS is broken.
      return {
        recipe: FALLBACK_RECIPE.id,
        colors: FALLBACK_RECIPE.colors.slice(),
        value:  FALLBACK_RECIPE.value,
        weight: FALLBACK_RECIPE.weight
      };
    }

    // 1. Bucket the pool by size and roll a size by the per-wave weights,
    //    considering only sizes that have recipes available right now.
    /** @type {Map<number, typeof pool>} */
    const bySize = new Map();
    for (const r of pool) {
      const bucket = bySize.get(r.size);
      if (bucket) bucket.push(r);
      else bySize.set(r.size, [r]);
    }
    const sizes = [...bySize.keys()];
    const weights = ORDER_SIZE_WEIGHTS[Math.min(day, ORDER_SIZE_WEIGHTS.length - 1)] || {};
    const sizePool = sizes.map(s => ({ size: s, weight: Math.max(0, weights[s] != null ? weights[s] : 1) }));
    const pickedSize = pickWeighted(sizePool);
    const chosenSize = pickedSize ? pickedSize.size : sizes[0];
    let candidates = bySize.get(chosenSize) || pool;

    // 2. Discovery bias (waves 1+): bigger waves favor surfacing recipes the
    //    player hasn't made yet, so the catalog keeps opening up.
    if (wave > 0) {
      const bias = lerp(DISCOVERY_BIAS_START, DISCOVERY_BIAS_END, Math.min(1, (day - 1) / WAVE_RAMP));
      if (bias > 0 && Math.random() < bias) {
        const undiscovered = candidates.filter(r => !this.isDiscovered(r.id));
        if (undiscovered.length > 0) candidates = undiscovered;
      }
    }

    const r = candidates[Math.floor(Math.random() * candidates.length)];
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
    // Ramp keys off the per-week day, so difficulty resets to easiest each week.
    const s = escalate ? Math.min(1, (this.dayInWeek - 1) / WAVE_RAMP) : 0;
    return {
      spawnInterval: lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, s),
      fallMult:      lerp(1, FALL_SPEED_MULT_END, s),
      patience:      lerp(PATTERN_TIME_START, PATTERN_TIME_END, s)
    };
  }
}
