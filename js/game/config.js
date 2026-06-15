// @ts-check
// Code-touching constants and enums. Balance numbers live in tuning.js and
// are re-exported from here so existing call-sites don't need to change.

import {
  FLOOR_Y_RATIO as _FLOOR_Y_RATIO,
  CONE_EMBED_PX as _CONE_EMBED_PX
} from './tuning.js';
// The scoop sprite def is data (no rendering), so config reads it to derive the
// scoop's collision size — single source of truth, set in the sprite editor.
import SCOOP_SPRITE from '../view/sprites/scoopSprite.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../types.js').PowerUpTypeName} PowerUpTypeName */
/** @typedef {import('../types.js').RecipeId} RecipeId */

export const COLORS = Object.freeze({
  pink: '#ff6fa3',
  mint: '#7fe3c4',
  choco: '#7b4a2a',
  vanilla: '#fff3c0',
  blueberry: '#6a8cff'
});

/** @type {ScoopColor[]} */
export const COLOR_KEYS = /** @type {ScoopColor[]} */ (Object.keys(COLORS));

// === Geometry / layout ========================================================
// The scoop's collision body comes from its sprite definition
// (view/sprites/scoopSprite.js, set in the sprite editor) — no magic radius here.
// SCOOP_HALF_W/H are the body's
// half-extents (circle → radius; rect → width/2, height/2) used by the catch
// hitbox, so the hitbox shape follows the sprite instead of being locked to a
// circle. SCOOP_RADIUS is the representative scalar (half-height) the rest of the
// layout/tuning + the 1:1 draw scale use.
const _scoopBody = SCOOP_SPRITE.animations[0].frames[0].body;
/** @type {import('../types.js').SpriteBody | null} */
export const SCOOP_BODY = _scoopBody;
export const SCOOP_HALF_W = _scoopBody
  ? (_scoopBody.shape === 'rect' ? (_scoopBody.width || 0) / 2 : (_scoopBody.radius || 0))
  : 0;
export const SCOOP_HALF_H = _scoopBody
  ? (_scoopBody.shape === 'rect' ? (_scoopBody.height || 0) / 2 : (_scoopBody.radius || 0))
  : 0;
export const SCOOP_RADIUS = SCOOP_HALF_H;
export const SCOOP_SPACING = SCOOP_RADIUS * .95;

export const CONE_WIDTH = 90;
export const CONE_HEIGHT = 110;
export const CONE_MAX_SPEED = 640;
export const CONE_ACCEL = 2400;
export const CONE_FRICTION = 2800;

export const MAX_STACK = 6;
export const UPCOMING_COUNT = 4;

export const SLOT_COUNT = 5;

// === Enums (frozen string maps) ==============================================
/** @type {Readonly<{HEART:'heart',FEATHER:'feather',PAUSE:'pause',RAINBOW:'rainbow'}>} */
export const PICKUP_TYPE = Object.freeze({
  HEART: 'heart',
  FEATHER: 'feather',
  PAUSE: 'pause',
  RAINBOW: 'rainbow'
});
/** @type {PickupTypeName[]} */
export const PICKUP_TYPES = [
  PICKUP_TYPE.HEART,
  PICKUP_TYPE.FEATHER,
  PICKUP_TYPE.PAUSE,
  PICKUP_TYPE.RAINBOW
];

// The non-power-up customer tip: a coin (bonus points), the sibling of the four
// power-up tips. Kept OUT of PICKUP_TYPE/PICKUP_TYPES so it never leaks into the
// power-up sets (unlocks, weights, active slot) — it's a reward, not a power-up.
export const TIP_COIN = 'coin';

/** @type {Readonly<{SPEED:'speed',PAUSE:'pause',RAINBOW:'rainbow'}>} */
export const POWERUP_TYPE = Object.freeze({
  SPEED: 'speed',
  PAUSE: 'pause',
  RAINBOW: 'rainbow'
});

// Power-up VISUALS (icons + ring colors) live in view/powerupVisuals.js — the
// one place to touch when we move from emoji to sprites. Config keeps only the
// domain mapping below.

// Which timed power-up a caught/granted type runs. Heart is absent — it heals
// instantly and never occupies the active slot. Read by the active-slot sim
// (which timer is running) and its renderer (the countdown ring).
export const PICKUP_TO_POWER = {
  [PICKUP_TYPE.FEATHER]: POWERUP_TYPE.SPEED,
  [PICKUP_TYPE.PAUSE]:   POWERUP_TYPE.PAUSE,
  [PICKUP_TYPE.RAINBOW]: POWERUP_TYPE.RAINBOW
};

// Stringly-typed config values, centralized as frozen enums so a typo is a
// missing property (loud — undefined) instead of a silently-false comparison.
/** Tray→customer delivery rule. @type {Readonly<{ANY:'any',SEQUENTIAL:'sequential',WHOLE:'whole'}>} */
export const DELIVERY_MODE = Object.freeze({ ANY: 'any', SEQUENTIAL: 'sequential', WHOLE: 'whole' });

// === Math util ================================================================
/**
 * @param {number} a
 * @param {number} b
 * @param {number} t Clamped to [0, 1].
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Y-coordinate of the sand floor's top edge. Shared by scene (floor + sky
 * gradient end), dayCycle (sun horizon), and stations (customer ground line).
 * The sky/ground split is the fixed layout constant FLOOR_Y_RATIO (tuning.js).
 * @param {number} boundsHeight
 * @returns {number}
 */
export function groundYFor(boundsHeight) {
  return boundsHeight * _FLOOR_Y_RATIO;
}

/**
 * Y-coordinate of the cone *center*. The cone tip sits CONE_EMBED_PX below
 * the sand top, so the cone is partially in the floor instead of balancing
 * on its point.
 * @param {number} boundsHeight
 * @returns {number}
 */
export function coneYFor(boundsHeight) {
  return groundYFor(boundsHeight) + _CONE_EMBED_PX - CONE_HEIGHT / 2;
}

// === Re-export balance numbers from tuning.js ================================
export {
  PERFECT_CATCH_BAND,
  PERFECT_CATCH_BONUS,
  PHASES_PER_WAVE,
  PHASE_ACTIVE,
  PHASE_GOAL,
  WAVE_CELEBRATE_S,
  PICKUP_SPAWN_MIN_S,
  PICKUP_SPAWN_MAX_S,
  PICKUP_WEIGHTS,
  HEART_HEAL_AMOUNT,
  SPEED_DURATION_S,
  SPEED_MULT_BOOST,
  PAUSE_DURATION_S,
  RAINBOW_DURATION_S,
  WAVE_RAMP,
  SPAWN_INTERVAL_START,
  SPAWN_INTERVAL_END,
  FALL_SPEED_MULT_END,
  SCOOP_FALL_MIN,
  SCOOP_FALL_RANGE,
  MAX_LIVE_SCOOPS,
  SCOOP_DISSOLVE_S,
  PATTERN_TIME_START,
  PATTERN_TIME_END,
  COMBO_DECAY_S,
  COMBO_BREAKER_THRESHOLD,
  COMBO_BREAKER_DURATION_MULT,
  MAX_HEALTH,
  DAMAGE_PER_EXPIRE,
  HEAL_PER_SERVE,
  COMBO_CASHOUT_PER,
  STACK_CASHOUT_PER_SCOOP,
  SPAWN_DEMAND_BIAS,
  WAVE0_DEMAND_BIAS,
  ORDER_SIZE_WEIGHTS,
  DISCOVERY_BIAS_START,
  DISCOVERY_BIAS_END,
  PARTIAL_SERVE_EXTEND_S,
  FLOOR_Y_RATIO,
  CONE_EMBED_PX,
  CUSTOMER_FACE_OFFSET_PX,
  MINI_CONE_FACE_OFFSET_PX,
  HANDOFF_REACH,
  HANDOFF_DURATION_S,
  SERVED_FLIGHT_S,
  SERVED_FLIGHT_ARC,
  MINI_SCOOP_RADIUS,
  MINI_CONE_OFFSET_X,
  MINI_CONE_W,
  MINI_CONE_H
} from './tuning.js';
