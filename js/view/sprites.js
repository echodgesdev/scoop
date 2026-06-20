// @ts-check
// Scoop RENDER binding. The sprite definitions (data + collision bodies) live in
// ./sprites/; this file builds a generic SpriteSheet from each and exposes the
// scoop draw helpers + maps. Two sheets: the base scoops (resting states +
// default-speed fall, 70px cells) and the oversized fast-fall scoops (taller
// cells, one frame per speed tier). The generic SpriteSheet handles both.
import { SpriteSheet } from './spriteSheet.js';
import SCOOP_SPRITE from './sprites/scoopSprite.js';
import SCOOP_FAST_SPRITE from './sprites/scoopFastSprite.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */

// Sheet columns, left→right (shared layout for both sheets).
const FLAVOR_COL = { choco: 0, pink: 1, mint: 2, vanilla: 3, blueberry: 4, rainbow: 5 };

// The dissolve "poof": a scoop-outline cell in the extra 7th column (beyond the
// six flavor columns), drawn shrinking + fading as a missed scoop sinks into the
// sand. Single frame, color-agnostic — base-sheet row index 1 ('Scoop'), col 6.
const DISSOLVE_ROW = 1;
const DISSOLVE_COL = 6;

// On-screen scoop states (base-sheet row names). Falling scoops use DEFAULT (or
// the fast sheet via drawFallingScoop); the tray stack uses CONE / CONE_TOP.
export const SCOOP_STATE = Object.freeze({
  DEFAULT: 'Default',
  CONE: 'Scoop',         // resting on the cone / a customer mini-cone
  CONE_TOP: 'Scoop Top'  // top of the tray stack (the "deliver me next" look)
});

// Build a renderer per def. The def's `image` is the runtime path (the sprite
// editor exports it as assets/<file>), so it's used verbatim — no rewriting.
export const scoopSheet = new SpriteSheet(SCOOP_SPRITE);
const fastSheet = new SpriteSheet(SCOOP_FAST_SPRITE);

// Fall-speed tiers (checked high→low). `speedMult` is the scoop's fall multiplier
// over the default (1.0); the wave ramp runs 1.0→2.2 (≈ +0.2 per wave), so:
//   <1.1 default · 1.1–1.5 medium (w2–3) · 1.5–1.9 medium-fast (w4–5) · ≥1.9 fast (w6+)
// `anim` is the fast sheet's row INDEX (its row names don't need to match
// anything); `base` is the base-sheet fallback row used until the fast sheet's
// image is present. Fast rows: 0 = mildest streak … 2 = most intense.
const FALL_TIERS = [
  { minMult: 1.9, anim: 2, base: 'Fast Fall Bottom' },
  { minMult: 1.5, anim: 1, base: 'Medium Fast Fall Bottom' },
  { minMult: 1.1, anim: 0, base: 'Medium Fall Bottom' }
];
/** @param {number} mult @returns {{minMult:number, anim:number, base:string} | null} */
function fallTier(mult) {
  for (const t of FALL_TIERS) if (mult >= t.minMult) return t;
  return null;  // default speed → the single Default frame
}

/**
 * Blit a flavor's frame for an animation from `sheet`, scaled so the frame's body
 * radius maps to the world radius `r`. Returns false if unavailable.
 * @param {SpriteSheet} sheet
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {ScoopColor | 'rainbow'} color
 * @param {number | string} state
 * @returns {boolean}
 */
function drawFrom(sheet, ctx, x, y, r, color, state) {
  const col = FLAVOR_COL[color];
  if (col == null) return false;
  const f = sheet.frame(state, col);
  if (!f) return false;
  const bodyR = (f.body && f.body.radius) ? f.body.radius : sheet.frameH / 2;
  return sheet.draw(ctx, state, col, x, y, r / bodyR);
}

/**
 * Base scoop sprite for `color` + `state` (resting states / mini-cones), scaled to
 * the world radius `r`. Returns false if unavailable (caller falls back).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {ScoopColor | 'rainbow'} color
 * @param {number | string} state one of SCOOP_STATE
 * @returns {boolean}
 */
export function drawScoopSprite(ctx, x, y, r, color, state) {
  return drawFrom(scoopSheet, ctx, x, y, r, color, state);
}

/**
 * Blit the scoop-outline dissolve frame, scaled to world radius `r`. The caller
 * sets globalAlpha for the fade. Color-agnostic. Returns false if the sheet isn't
 * loaded / the frame is missing.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @returns {boolean}
 */
export function drawDissolveSprite(ctx, x, y, r) {
  const f = scoopSheet.frame(DISSOLVE_ROW, DISSOLVE_COL);
  if (!f) return false;
  const bodyR = (f.body && f.body.radius) ? f.body.radius : scoopSheet.frameH / 2;
  return scoopSheet.draw(ctx, DISSOLVE_ROW, DISSOLVE_COL, x, y, r / bodyR);
}

/**
 * Draw a FALLING scoop by its speed: default speed = the base Default frame;
 * faster = the oversized fast sheet's tier frame (a single image, scoop + flair),
 * falling back to the base sheet's tier frame until the fast sheet's image loads.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {ScoopColor | 'rainbow'} color
 * @param {number} [speedMult] the scoop's fall multiplier over default (1.0)
 * @returns {boolean}
 */
export function drawFallingScoop(ctx, x, y, r, color, speedMult = 1) {
  const tier = fallTier(speedMult);
  if (!tier) return drawFrom(scoopSheet, ctx, x, y, r, color, SCOOP_STATE.DEFAULT);
  if (fastSheet.ready && drawFrom(fastSheet, ctx, x, y, r, color, tier.anim)) return true;
  return drawFrom(scoopSheet, ctx, x, y, r, color, tier.base);
}
