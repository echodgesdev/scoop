// @ts-check
import {
  SCOOP_RADIUS,
  PICKUP_RADIUS,
  PICKUP_BUBBLE_RADIUS_MULT,
  PROJECTILE_SCALE
} from './config.js';
import { drawScoop } from './player.js';

/** @typedef {import('./types.js').ScoopColor} ScoopColor */
/** @typedef {import('./types.js').Bounds} Bounds */
/** @typedef {import('./types.js').Pickup} Pickup */

/**
 * @typedef {object} Projectile
 * @property {number} x
 * @property {number} y
 * @property {number} vy           upward = negative
 * @property {ScoopColor} color    inherited from the popped tray scoop
 */

/**
 * In-flight scoop projectiles launched by the slingshot (Space). Each one
 * flies straight up until it either collides with a pickup bubble or leaves
 * the top of the screen. Drawn smaller than a tray scoop so the visual
 * transformation reads — a stack scoop becomes a "shot" the moment it
 * leaves the cone.
 */
export class ProjectileField {
  constructor() { this.reset(); }

  reset() {
    /** @type {Projectile[]} */
    this.list = [];
  }

  /**
   * Fire a projectile from (x, y) with vertical velocity vy.
   * @param {number} x
   * @param {number} y
   * @param {number} vy             negative = upward
   * @param {ScoopColor} color
   */
  launch(x, y, vy, color) {
    this.list.push({ x, y, vy, color });
  }

  /**
   * Advance every projectile and let the caller decide whether each one
   * collided with anything this frame.
   * @param {number} dt
   * @param {Bounds} bounds
   * @param {(p: Projectile) => boolean} onHit  return true to consume the projectile
   */
  update(dt, bounds, onHit) {
    const cullY = -SCOOP_RADIUS * 2;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.y += p.vy * dt;
      if (onHit(p)) {
        this.list.splice(i, 1);
        continue;
      }
      if (p.y < cullY) this.list.splice(i, 1);
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    for (const p of this.list) drawScoop(ctx, p.x, p.y, p.color, PROJECTILE_SCALE);
  }
}

/**
 * Circle-circle hit test between a projectile and a pickup's bubble.
 * @param {Projectile} proj
 * @param {Pickup} pickup
 */
export function projectileHits(proj, pickup) {
  const bubbleR = PICKUP_RADIUS * PICKUP_BUBBLE_RADIUS_MULT;
  const projR = SCOOP_RADIUS * PROJECTILE_SCALE;
  const dx = proj.x - pickup.x;
  const dy = proj.y - pickup.y;
  const r = bubbleR + projR;
  return (dx * dx + dy * dy) <= r * r;
}
