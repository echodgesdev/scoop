// @ts-check
// Code-touching constants + enums, exposed as a few namespace GROUPS
// (CONE, SCOOP, TRAY, …) rather than dozens of flat exports. Balance numbers
// still live in tuning.js as flat consts (the one place a designer edits values);
// this file imports them and composes the groups consumers actually read.
//
// The numeric groups are plain (unfrozen) objects on purpose: under @ts-check,
// Object.freeze pins members to LITERAL types (e.g. 4, 100, 0.32), which then
// can't be copied into a mutable field that's later reassigned a general number.
// Plain object literals widen members to `number`, matching the old flat consts.
// The string groups below (COLORS + the enums) stay frozen — literal string
// types are exactly what we want there.

import {
  GROUND_Y,
  CONE_EMBED_PX as _CONE_EMBED_PX,
  PERFECT_CATCH_BAND, PERFECT_CATCH_BONUS,
  PHASES_PER_WAVE, PHASE_ACTIVE, PHASE_GOAL, WAVE_CELEBRATE_S, WAVE_RAMP,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, FALL_SPEED_MULT_END,
  SCOOP_FALL_MIN, SCOOP_FALL_RANGE, MAX_LIVE_SCOOPS, SCOOP_DISSOLVE_S,
  PATTERN_TIME_START, PATTERN_TIME_END, ORDER_SIZE_WEIGHTS,
  DISCOVERY_BIAS_START, DISCOVERY_BIAS_END, SPAWN_DEMAND_BIAS, WAVE0_DEMAND_BIAS,
  PICKUP_SPAWN_MIN_S, PICKUP_SPAWN_MAX_S, PICKUP_WEIGHTS,
  HEART_HEAL_AMOUNT, SPEED_DURATION_S, SPEED_MULT_BOOST, PAUSE_DURATION_S, RAINBOW_DURATION_S,
  COMBO_DECAY_S, COMBO_BREAKER_THRESHOLD, COMBO_BREAKER_DURATION_MULT, COMBO_CASHOUT_PER,
  MAX_HEALTH, DAMAGE_PER_EXPIRE, HEAL_PER_SERVE,
  CUSTOMER_FACE_OFFSET_PX,
  HANDOFF_REACH, HANDOFF_DURATION_S, SERVED_FLIGHT_S, PARTIAL_SERVE_EXTEND_S
} from './tuning.js';
// The scoop sprite def is data (no rendering), so config reads it to derive the
// scoop's collision size — single source of truth, set in the sprite editor.
import SCOOP_SPRITE from '../ui/sprites/scoopSprite.js';

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

// === Geometry: SCOOP ==========================================================
// The scoop's collision body comes from its sprite definition
// (ui/sprites/scoopSprite.js, set in the sprite editor) — no magic radius here.
// HALF_W/H are the body's half-extents (circle → radius; rect → width/2,
// height/2) used by the catch hitbox, so the hitbox shape follows the sprite
// instead of being locked to a circle. RADIUS is the representative scalar
// (half-height) the rest of the layout/tuning + the 1:1 draw scale use.
const _scoopBody = SCOOP_SPRITE.animations[0].frames[0].body;
const _scoopHalfW = _scoopBody
  ? (_scoopBody.shape === 'rect' ? (_scoopBody.width || 0) / 2 : (_scoopBody.radius || 0))
  : 0;
const _scoopHalfH = _scoopBody
  ? (_scoopBody.shape === 'rect' ? (_scoopBody.height || 0) / 2 : (_scoopBody.radius || 0))
  : 0;
export const SCOOP = {
  HALF_W: _scoopHalfW,
  HALF_H: _scoopHalfH,
  RADIUS: _scoopHalfH,
  SPACING: _scoopHalfH * 0.95,
  DISSOLVE_S: SCOOP_DISSOLVE_S,   // missed-scoop fade/shrink/poof time
  FALL_MIN: SCOOP_FALL_MIN,
  FALL_RANGE: SCOOP_FALL_RANGE,
  MAX_LIVE: MAX_LIVE_SCOOPS       // hard cap on simultaneously-falling scoops
};

// === Geometry: CONE ===========================================================
// WIDTH/HEIGHT drive both the sim (movement clamp + catch hitbox in player.js)
// and the render (cone sprite seat, tutorial), so they stay in the model layer.
// Y is the cone *center*: the tip embeds CONE_EMBED_PX below the sand line, so
// the center sits at GROUND_Y + CONE_EMBED_PX - HEIGHT/2 (≈ on the sand line with
// current values). Absolute because the canvas height is fixed.
const _CONE_HEIGHT = 110;
export const CONE = {
  WIDTH: 90,
  HEIGHT: _CONE_HEIGHT,
  MAX_SPEED: 640,
  ACCEL: 2400,
  FRICTION: 2800,
  Y: GROUND_Y + _CONE_EMBED_PX - _CONE_HEIGHT / 2
};

// === Tray (player's stack + queue) ============================================
export const TRAY = {
  MAX_STACK: 4,        // default cap on scoops carried (re-set per mode in world.js)
  UPCOMING_COUNT: 4,   // size of the previewed upcoming-scoop queue
  SLOT_COUNT: 5        // customer service slots
};

// === Balance groups (values authored flat in tuning.js, composed here) ========
export const SCORING = {
  PERFECT_CATCH_BAND, PERFECT_CATCH_BONUS,
  COMBO_DECAY_S, COMBO_BREAKER_THRESHOLD, COMBO_BREAKER_DURATION_MULT, COMBO_CASHOUT_PER
};

export const WAVES = {
  PHASES_PER_WAVE, PHASE_ACTIVE, PHASE_GOAL, WAVE_CELEBRATE_S, WAVE_RAMP,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, FALL_SPEED_MULT_END,
  PATTERN_TIME_START, PATTERN_TIME_END, ORDER_SIZE_WEIGHTS,
  DISCOVERY_BIAS_START, DISCOVERY_BIAS_END, SPAWN_DEMAND_BIAS, WAVE0_DEMAND_BIAS
};

export const POWERUPS = {
  PICKUP_SPAWN_MIN_S, PICKUP_SPAWN_MAX_S, PICKUP_WEIGHTS,
  HEART_HEAL_AMOUNT, SPEED_DURATION_S, SPEED_MULT_BOOST, PAUSE_DURATION_S, RAINBOW_DURATION_S
};

export const HEALTH = {
  MAX: MAX_HEALTH, DAMAGE_PER_EXPIRE, HEAL_PER_SERVE
};

export const LAYOUT = {
  GROUND_Y, CUSTOMER_FACE_OFFSET_PX
};

export const SERVE = {
  HANDOFF_REACH, HANDOFF_DURATION_S, SERVED_FLIGHT_S, PARTIAL_SERVE_EXTEND_S
};

// === Enums (frozen string maps) ==============================================
// Every tip token a customer can grant: the four power-ups plus COIN, the cash
// tip (bonus points, no power-up effect). COIN is a first-class member so it's
// always referenced as PICKUP_TYPE.COIN — never a bare 'coin' string. It is kept
// OUT of PICKUP_TYPES (the power-up set below) on purpose: that array drives
// weights, unlocks, and the active slot, and coin is a reward, not a power-up.
/** @type {Readonly<{HEART:'heart',FEATHER:'feather',PAUSE:'pause',RAINBOW:'rainbow',COIN:'coin'}>} */
export const PICKUP_TYPE = Object.freeze({
  HEART: 'heart',
  FEATHER: 'feather',
  PAUSE: 'pause',
  RAINBOW: 'rainbow',
  COIN: 'coin'
});
/** The four power-ups only — coin is excluded (see PICKUP_TYPE). @type {PickupTypeName[]} */
export const PICKUP_TYPES = [
  PICKUP_TYPE.HEART,
  PICKUP_TYPE.FEATHER,
  PICKUP_TYPE.PAUSE,
  PICKUP_TYPE.RAINBOW
];

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

// === Math util ================================================================
/**
 * Clamp `v` to the inclusive range [min, max].
 * @param {number} v @param {number} min @param {number} max @returns {number}
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t Clamped to [0, 1].
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Weighted random pick. Returns the chosen item (weighted by its `weight` field),
 * or null when the list is empty. If every weight is <= 0 it falls back to a
 * uniform pick, so a degenerate all-zero pool still returns something.
 * @template {{ weight: number }} T
 * @param {T[]} items
 * @returns {T | null}
 */
export function pickWeighted(items) {
  if (items.length === 0) return null;
  const total = items.reduce((sum, it) => sum + (it.weight > 0 ? it.weight : 0), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
