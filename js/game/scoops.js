// @ts-check
import {
  COLOR_KEYS,
  SCOOP,
  TRAY,
  WAVES
} from './config.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../types.js').Scoop} Scoop */
/** @typedef {import('../types.js').Bounds} Bounds */
/** @typedef {import('../types.js').Hitbox} Hitbox */
/** @typedef {import('../types.js').Tuning} Tuning */

// Dissolve animation (a missed scoop sinking into the sand): it crosses the miss
// line, takes an instant velocity cut, then keeps drifting at a fraction of its
// fall speed until culled — a soft sink rather than streaming off-screen.
const DISSOLVE_IMPACT_DAMP = 0.4;   // velocity kept the instant dissolve starts
const DISSOLVE_DRIFT_MULT = 0.25;   // fraction of fall speed kept while dissolving

/** @returns {ScoopColor} */
function randomColor() {
  return COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
}

export class ScoopField {
  constructor() {
    /** @type {Scoop[]} */
    this.scoops = [];
    this.spawnTimer = 0;
    /** @type {ScoopColor[]} */
    this.upcoming = [];
    /**
     * Demand source: returns the net colors waiting customers still need
     * (after subtracting tray). With probability WAVES.SPAWN_DEMAND_BIAS, the next
     * spawn picks from this multi-set instead of uniform random — supply
     * tilts toward what the player actually needs.
     * @type {() => ScoopColor[]}
     */
    this.demandSource = () => [];
    // Probability a spawn is biased toward demand. Seeded from the tuning
    // constant but overridable live via the debug panel — lowering it is the
    // main "make the tray bind" scarcity knob. Persists across reset().
    this.demandBias = WAVES.SPAWN_DEMAND_BIAS;
    // Hard cap on simultaneously-falling scoops; live-overridable via the debug
    // panel. Persists across reset().
    this.maxLive = SCOOP.MAX_LIVE;
    // Fall-speed multiplier on top of the wave ramp — the live "how fast do
    // scoops arrive" knob (debug slider). 1 = the tuned base. Persists across
    // reset().
    this.fallScale = 1;
    // Hard stop on the RANDOM sky spawner (scripted drops still work). The
    // tutorial pauses it for its guided beats so only scripted scoops fall.
    // Cleared by reset() so normal play always spawns.
    this.spawnPaused = false;
    this._refill();
  }

  /** @param {boolean} b pause/resume the random sky spawner (scripted drops unaffected) */
  setSpawnPaused(b) {
    this.spawnPaused = b;
  }

  /** @param {() => ScoopColor[]} fn */
  setDemandSource(fn) {
    this.demandSource = fn;
  }

  /** @param {number} n debug override for the max simultaneous falling scoops */
  setMaxLive(n) {
    this.maxLive = Math.max(1, Math.round(n));
  }

  /** @param {number} m debug fall-speed multiplier (× the wave ramp) */
  setFallScale(m) {
    this.fallScale = Math.max(0.1, m);
  }

  /** @param {number} v probability 0..1 */
  setDemandBias(v) {
    this.demandBias = Math.max(0, Math.min(1, v));
  }

  reset() {
    this.scoops = [];
    this.spawnTimer = 0;
    this.upcoming = [];
    this.spawnPaused = false;
    this._refill();
  }

  /**
   * Drop ONE scripted scoop of a chosen color at a chosen x — the tutorial's
   * "catch this" beat. Same shape as a normal spawn so it falls and is catchable.
   * Bypasses the spawn timer / maxLive cap. @param {number} x @param {ScoopColor} color
   * @returns {Scoop} the pushed scoop (so the caller can watch its y)
   */
  spawnScripted(x, color) {
    const speedMult = this.fallScale;
    /** @type {Scoop} */
    const s = {
      x,
      y: -SCOOP.RADIUS,
      prevY: -SCOOP.RADIUS,
      vy: (SCOOP.FALL_MIN + Math.random() * SCOOP.FALL_RANGE) * speedMult,
      speedMult,
      color
    };
    this.scoops.push(s);
    return s;
  }

  /** @returns {ScoopColor} */
  _pickColor() {
    const demand = this.demandSource();
    if (demand.length > 0 && Math.random() < this.demandBias) {
      return demand[Math.floor(Math.random() * demand.length)];
    }
    return randomColor();
  }

  /** Scoops that are still catchable (not mid-dissolve). */
  _liveCount() {
    let n = 0;
    for (const s of this.scoops) if (s.dissolve === undefined) n += 1;
    return n;
  }

  /**
   * @param {number} dt
   * @param {Bounds} bounds
   * @param {Tuning} tuning supplied per-frame
   * @param {number} missY y past which an uncaught scoop is unreachable and
   *   begins to dissolve (the cone's lowest possible catch line + a margin)
   * @param {(scoop: Scoop) => boolean} onCatch return true to consume the scoop
   */
  update(dt, bounds, tuning, missY, onCatch) {
    // Random sky spawner (paused during the scripted tutorial; scripted drops in
    // spawnScripted bypass this entirely).
    if (!this.spawnPaused) {
      this.spawnTimer += dt;
      if (this.spawnTimer >= tuning.spawnInterval) {
        this.spawnTimer = 0;
        // Idle at the cap — the spawner just retries next interval once a slot
        // frees up. Dissolving scoops don't count against the cap.
        if (this._liveCount() < this.maxLive) this._spawn(bounds, tuning.fallMult);
      }
    }

    for (let i = this.scoops.length - 1; i >= 0; i--) {
      const s = this.scoops[i];
      // Stamp the pre-step position — the view lerps prevY→y by the render
      // alpha so falling motion stays smooth at any display refresh rate.
      s.prevY = s.y;

      // Dissolving: drift gently while fading, then cull. Not catchable.
      if (s.dissolve !== undefined) {
        s.dissolve += dt;
        s.y += s.vy * dt * DISSOLVE_DRIFT_MULT;
        if (s.dissolve >= SCOOP.DISSOLVE_S) this.scoops.splice(i, 1);
        continue;
      }

      s.y += s.vy * dt;

      if (onCatch(s)) {
        this.scoops.splice(i, 1);
        continue;
      }
      // Past the catch line into the ground — begin the dissolve instead of
      // letting it stream off the bottom of the screen.
      if (s.y > missY) {
        s.dissolve = 0;
        s.vy *= DISSOLVE_IMPACT_DAMP;
        continue;
      }
      // Safety net for any scoop that somehow slips past (e.g. an off-screen
      // missY on a tiny aspect): cull below the floor.
      if (s.y > bounds.height + 40) this.scoops.splice(i, 1);
    }
  }

  _refill() {
    while (this.upcoming.length < TRAY.UPCOMING_COUNT) this.upcoming.push(this._pickColor());
  }

  /**
   * @param {Bounds} bounds
   * @param {number} fallMult
   */
  _spawn(bounds, fallMult) {
    const color = this.upcoming.shift();
    if (!color) return;
    this._refill();
    // Effective fall multiplier over the default (1.0): the wave ramp × the debug
    // fall-speed knob. Stamped on the scoop so the view can pick its sprite tier.
    const speedMult = fallMult * this.fallScale;
    this.scoops.push({
      x: Math.random() * (bounds.width - 80) + 40,
      y: -SCOOP.RADIUS,
      prevY: -SCOOP.RADIUS,
      vy: (SCOOP.FALL_MIN + Math.random() * SCOOP.FALL_RANGE) * speedMult,
      speedMult,
      color
    });
  }
}

/**
 * @param {Scoop} scoop
 * @param {Hitbox} hitbox
 */
export function isCaught(scoop, hitbox) {
  // Vertical extent comes from the scoop body's half-height (circle radius or
  // rect height/2); horizontal is the cone's reach band (hitbox.halfW already
  // folds in the body's half-width). For a circle body these are equal.
  const verticalOverlap =
    scoop.y + SCOOP.HALF_H >= hitbox.y - hitbox.r &&
    scoop.y - SCOOP.HALF_H <= hitbox.y + hitbox.r;
  const horizontalOverlap = Math.abs(scoop.x - hitbox.x) < hitbox.halfW;
  return verticalOverlap && horizontalOverlap;
}
