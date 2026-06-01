// @ts-check
import {
  PICKUP_TYPE,
  POWERUP_TYPE,
  SPEED_DURATION_S,
  SPEED_MULT_BOOST,
  PAUSE_DURATION_S,
  RAINBOW_DURATION_S
} from './config.js';

/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./types.js').PowerUpTypeName} PowerUpTypeName */

/** @type {Record<PowerUpTypeName, number>} */
const DURATIONS = {
  [POWERUP_TYPE.SPEED]:   SPEED_DURATION_S,
  [POWERUP_TYPE.PAUSE]:   PAUSE_DURATION_S,
  [POWERUP_TYPE.RAINBOW]: RAINBOW_DURATION_S
};

/**
 * Mutual-exclusion timed power-ups. Only one can be active at any moment;
 * catching a new timed pickup *replaces* whatever's running. Catching the
 * same type while it's active refreshes the timer to full.
 *
 * Heart is not a timed power-up — game.js handles the instant heal at
 * catch time and never calls trigger() with PICKUP_TYPE.HEART.
 */
export class PowerUps {
  constructor() { this.reset(); }

  reset() {
    /** @type {{ type: PowerUpTypeName, t: number, duration: number } | null} */
    this.current = null;
  }

  /**
   * Activate (or refresh / replace) a power-up from a pickup catch.
   * @param {PickupTypeName} pickupType
   * @param {number} [durationMult] scales the base duration (combo-breaker
   *   supercharge passes > 1 for a longer-running power-up). Default 1.
   */
  trigger(pickupType, durationMult = 1) {
    const powerType = pickupToPower(pickupType);
    if (!powerType) return;
    const duration = DURATIONS[powerType] * durationMult;
    this.current = { type: powerType, t: duration, duration };
  }

  /** @param {number} dt */
  update(dt) {
    if (!this.current) return;
    this.current.t = Math.max(0, this.current.t - dt);
    if (this.current.t === 0) this.current = null;
  }

  /** @param {PowerUpTypeName} type */
  active(type) {
    return this.current != null && this.current.type === type;
  }

  /**
   * Remaining 0..1 for the HUD ring.
   * @param {PowerUpTypeName} type
   */
  fraction(type) {
    if (!this.current || this.current.type !== type) return 0;
    return this.current.t / this.current.duration;
  }

  get speedMultiplier() { return this.active(POWERUP_TYPE.SPEED)   ? SPEED_MULT_BOOST : 1; }
  get pauseActive()     { return this.active(POWERUP_TYPE.PAUSE); }
  get rainbowActive()   { return this.active(POWERUP_TYPE.RAINBOW); }
}

/** @param {PickupTypeName} pickupType */
function pickupToPower(pickupType) {
  if (pickupType === PICKUP_TYPE.FEATHER) return POWERUP_TYPE.SPEED;
  if (pickupType === PICKUP_TYPE.PAUSE)   return POWERUP_TYPE.PAUSE;
  if (pickupType === PICKUP_TYPE.RAINBOW) return POWERUP_TYPE.RAINBOW;
  return null;
}
