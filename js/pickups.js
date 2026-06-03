// @ts-check
import {
  PICKUP_TYPES,
  PICKUP_WEIGHTS,
  PICKUP_RADIUS,
  PICKUP_SPAWN_MIN_S,
  PICKUP_SPAWN_MAX_S,
  PICKUP_FLOAT_MIN_SPEED,
  PICKUP_FLOAT_MAX_SPEED,
  PICKUP_MIN_Y_RATIO,
  PICKUP_MAX_Y_RATIO,
  PICKUP_BUBBLE_RADIUS_MULT
} from './config.js';

/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./types.js').Pickup} Pickup */
/** @typedef {import('./types.js').Bounds} Bounds */
/** @typedef {import('./types.js').Hitbox} Hitbox */

// Note: pickup type names stay as "feather"/"pause" for code stability, but
// the rendered icons are chosen for legibility — feather (🪶) doesn't render
// reliably across systems; lightning (⚡) is universally drawn and reads as
// "fast". A snowflake (❄️) reads as "frozen", matching the 🥶 face customers
// make when their patience is frozen.
// 'coin' is a tutorial-only pseudo power-up — not in PICKUP_TYPES, so it never
// random-spawns, but it banks into the queue, so it needs an icon + ring color.
// A '$' glyph renders everywhere (the coin emoji does not).
export const PICKUP_ICONS = {
  heart:   '❤️',
  feather: '⚡',
  pause:   '❄️',
  rainbow: '🌈',
  coin:    '$'
};

export const PICKUP_RING_COLOR = {
  heart:   '#ff6fa3',
  feather: '#bfdcff',
  pause:   '#c9b6ff',
  rainbow: '#ffd166',
  coin:    '#ffd700'
};

/** @param {number} min @param {number} max */
function rand(min, max) { return min + Math.random() * (max - min); }

/** @param {number[]} weights */
function weightedPick(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Pickups drift horizontally across the screen as bubbles. Each picks a
 * random direction, speed, and y-band on spawn — so different power-ups
 * cross the play area at different "altitudes" and "periodicities". Low-
 * floating bubbles can be popped by the cone alone; high-floating ones
 * need a tall stack to reach.
 */
export class PickupField {
  /**
   * @param {() => PickupTypeName[]} [getUnlockedTypes]
   *   Returns the set of pickup types the player has unlocked. When the
   *   result is empty, no bubbles spawn — early game has no power-ups
   *   until the first challenge set is cleared.
   */
  constructor(getUnlockedTypes) {
    this.getUnlockedTypes = getUnlockedTypes || (() => /** @type {PickupTypeName[]} */ (PICKUP_TYPES.slice()));
    // Spawn cadence + per-type weights seed from the tuning constants but are
    // live-overridable via the debug panel. Both persist across reset() so a
    // debug value survives a new game. Weights align to PICKUP_TYPES order.
    this.spawnMin = PICKUP_SPAWN_MIN_S;
    this.spawnMax = PICKUP_SPAWN_MAX_S;
    this.weights = PICKUP_WEIGHTS.slice();
    this.reset();
  }

  reset() {
    /** @type {Pickup[]} */
    this.items = [];
    this.spawnTimer = rand(this.spawnMin, this.spawnMax);
  }

  /** @param {number} min @param {number} max seconds between bubble spawns */
  setSpawnRange(min, max) {
    const lo = Math.max(0.2, min);
    this.spawnMin = lo;
    this.spawnMax = Math.max(lo, max);
  }

  /**
   * Relative spawn weights, aligned to PICKUP_TYPES (heart, feather, pause,
   * rainbow). Negatives clamp to 0; a type weighted 0 never spawns.
   * @param {number[]} weights
   */
  setWeights(weights) {
    for (let i = 0; i < this.weights.length; i++) {
      const v = weights[i];
      if (Number.isFinite(v)) this.weights[i] = Math.max(0, v);
    }
  }

  /**
   * @param {number} dt
   * @param {Bounds} bounds
   * @param {(p: Pickup) => boolean} onCatch
   */
  update(dt, bounds, onCatch) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawn(bounds);
      this.spawnTimer = rand(this.spawnMin, this.spawnMax);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.x += p.vx * dt;
      p.bobPhase += dt * 1.8;
      p.spin += dt * 1.2;
      if (onCatch(p)) {
        this.items.splice(i, 1);
        continue;
      }
      // Cull when fully off-screen on the side the bubble is travelling toward.
      const margin = PICKUP_RADIUS * 3;
      if (p.vx > 0 && p.x > bounds.width + margin) this.items.splice(i, 1);
      else if (p.vx < 0 && p.x < -margin) this.items.splice(i, 1);
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    for (const p of this.items) drawPickup(ctx, p);
  }

  /** @param {Bounds} bounds */
  _spawn(bounds) {
    // Only spawn from the player's unlocked set, with weights re-normalised
    // over that subset. If nothing is unlocked yet, skip the spawn entirely.
    const unlocked = this.getUnlockedTypes();
    if (!unlocked || unlocked.length === 0) return;
    /** @type {number[]} */
    const filteredWeights = [];
    /** @type {PickupTypeName[]} */
    const filteredTypes = [];
    for (let i = 0; i < PICKUP_TYPES.length; i++) {
      if (unlocked.includes(PICKUP_TYPES[i])) {
        filteredTypes.push(PICKUP_TYPES[i]);
        filteredWeights.push(this.weights[i]);
      }
    }
    if (filteredTypes.length === 0) return;
    const type = filteredTypes[weightedPick(filteredWeights)];
    const direction = Math.random() < 0.5 ? 1 : -1;
    const speed = rand(PICKUP_FLOAT_MIN_SPEED, PICKUP_FLOAT_MAX_SPEED);
    const y = bounds.height * rand(PICKUP_MIN_Y_RATIO, PICKUP_MAX_Y_RATIO);
    const x = direction > 0 ? -PICKUP_RADIUS * 2 : bounds.width + PICKUP_RADIUS * 2;
    this.items.push({
      type,
      x,
      y,
      vx: speed * direction,
      vy: 0,
      spin: Math.random() * Math.PI,
      bobPhase: Math.random() * Math.PI * 2
    });
  }
}

/**
 * AABB-circle test against the player's expanded pickup hitbox. Same shape
 * as scoop catches, but the hitbox itself covers cone + every tray scoop.
 * @param {Pickup} pickup
 * @param {Hitbox} hitbox
 */
export function pickupCaught(pickup, hitbox) {
  const verticalOverlap =
    pickup.y + PICKUP_RADIUS >= hitbox.y - hitbox.r &&
    pickup.y - PICKUP_RADIUS <= hitbox.y + hitbox.r;
  const horizontalOverlap = Math.abs(pickup.x - hitbox.x) < hitbox.halfW;
  return verticalOverlap && horizontalOverlap;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Pickup} p
 */
function drawPickup(ctx, p) {
  const r = PICKUP_RADIUS;
  const bob = Math.sin(p.bobPhase) * 4;
  const cx = p.x;
  const cy = p.y + bob;
  const ring = PICKUP_RING_COLOR[p.type];

  ctx.save();

  // Bubble: translucent fill, colored ring, soft glow.
  ctx.shadowColor = ring;
  ctx.shadowBlur = 14;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * PICKUP_BUBBLE_RADIUS_MULT, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Sparkle highlight on the upper-left of the bubble.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.45, cy - r * 0.45, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  // Icon centred inside the bubble.
  ctx.font = `${Math.floor(r * 1.5)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.fillText(PICKUP_ICONS[p.type], cx, cy + 2);

  ctx.restore();
}
