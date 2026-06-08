// @ts-check
// Scoop sprite binding. The generic SpriteSheet (spriteSheet.js) does the work;
// this file holds the scoop sheet's def + the scoop-specific maps (which row is
// which state, which column is which flavor) + the falling-speed flair logic.
//
// The sheet is a uniform grid, so the def is built from the row list rather than
// hand-writing every frame — it reproduces exactly what the sprite editor
// exports: columns = flavors (+ rainbow), rows = the states listed in ROWS,
// 70px cells, body radius 35, zero offset.
import { SpriteSheet } from './spriteSheet.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */

const SHEET_IMG = 'assets/scoop_sheet.png';
const FRAME = 70;   // cell size, px
const BODY_R = 35;  // body radius the art was tuned to (= SCOOP_RADIUS for 1:1)

// Sheet columns, left→right.
const FLAVOR_COL = { choco: 0, pink: 1, mint: 2, vanilla: 3, blueberry: 4, rainbow: 5 };
const COLS = 6;

// Sheet rows, top→bottom. The first three are the on-screen scoop states; the
// rest are fall-speed pairs (a Bottom = the scoop with a body, a Top = flair).
const ROWS = [
  'Default',
  'Scoop',
  'Scoop Top',
  'Medium Fall Top',
  'Medium Fall Bottom',
  'Medium Fast Fall Top',
  'Medium Fast Fall Bottom',
  'Fast Fall Top',
  'Fast Fall Bottom'
];

// On-screen scoop states (sheet row names). Falling scoops use DEFAULT (or the
// speed rows via drawFallingScoop); the tray stack uses CONE / CONE_TOP.
export const SCOOP_STATE = Object.freeze({
  DEFAULT: 'Default',
  CONE: 'Scoop',         // resting on the cone / a customer mini-cone
  CONE_TOP: 'Scoop Top'  // top of the tray stack (the "deliver me next" look)
});

/**
 * Build the def in the editor's exported shape (see SpriteSheetDef in types.js).
 * @returns {import('../types.js').SpriteSheetDef}
 */
function scoopDef() {
  return {
    image: SHEET_IMG,
    imageSize: { width: COLS * FRAME, height: ROWS.length * FRAME },
    frame: { width: FRAME, height: FRAME },
    animations: ROWS.map((name, row) => ({
      name,
      frames: Array.from({ length: COLS }, (_, col) => ({
        x: col * FRAME, y: row * FRAME,
        body: { shape: /** @type {'circle'} */ ('circle'), x: 0, y: 0, radius: BODY_R },
        offset: { x: 0, y: 0 }
      }))
    }))
  };
}

export const scoopSheet = new SpriteSheet(scoopDef());

// Fall-speed tiers, checked high→low. `speedMult` is the scoop's fall multiplier
// over the default (1.0); the wave ramp runs 1.0→2.2 (≈ +0.2 per wave), so:
//   <1.1 default · 1.1–1.5 medium (w2–3) · 1.5–1.9 medium-fast (w4–5) · ≥1.9 fast (w6+)
const FALL_TIERS = [
  { minMult: 1.9, bottom: 'Fast Fall Bottom',        top: 'Fast Fall Top' },
  { minMult: 1.5, bottom: 'Medium Fast Fall Bottom', top: 'Medium Fast Fall Top' },
  { minMult: 1.1, bottom: 'Medium Fall Bottom',      top: 'Medium Fall Top' }
];
/** @param {number} mult @returns {{minMult:number, bottom:string, top:string} | null} */
function fallTier(mult) {
  for (const t of FALL_TIERS) if (mult >= t.minMult) return t;
  return null;  // default speed → the single Default frame
}

/**
 * Draw a scoop sprite for `color` + `state`, scaled so the frame's body radius
 * maps to the world radius `r`. Returns false if unavailable (caller falls back).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y collision center
 * @param {number} r world collision radius (SCOOP_RADIUS × the instance scale)
 * @param {ScoopColor | 'rainbow'} color
 * @param {number | string} state one of SCOOP_STATE (or any sheet row name)
 * @returns {boolean}
 */
export function drawScoopSprite(ctx, x, y, r, color, state) {
  const col = FLAVOR_COL[color];
  if (col == null) return false;
  const f = scoopSheet.frame(state, col);
  if (!f) return false;
  const bodyR = (f.body && f.body.radius) ? f.body.radius : scoopSheet.frameH / 2;
  return scoopSheet.draw(ctx, state, col, x, y, r / bodyR);
}

/**
 * Draw a FALLING scoop, picking its look from how fast it's falling. At default
 * speed it's a single frame; faster scoops add a flair frame stacked one cell
 * above the scoop. Only the scoop (the "Bottom" frame) carries the collision
 * body — the flair (the "Top" frame) is decoration.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {ScoopColor | 'rainbow'} color
 * @param {number} [speedMult] the scoop's fall multiplier over default (1.0)
 * @returns {boolean}
 */
export function drawFallingScoop(ctx, x, y, r, color, speedMult = 1) {
  const tier = fallTier(speedMult);
  if (!tier) return drawScoopSprite(ctx, x, y, r, color, SCOOP_STATE.DEFAULT);
  // Both frames draw at the scoop's anchor (their offsets are 0): the Bottom is
  // the scoop, the Top overlays its motion flair on top. Collision is the world
  // SCOOP_RADIUS at the anchor, so the flair frame needs no body of its own.
  drawScoopSprite(ctx, x, y, r, color, tier.bottom);
  return drawScoopSprite(ctx, x, y, r, color, tier.top);
}
