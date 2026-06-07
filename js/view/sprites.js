// @ts-check
// Scoop sprite binding. The generic SpriteSheet (spriteSheet.js) does the work;
// this file just holds the scoop sheet's def (in the editor's JSON shape — kept
// whole so the editor → game loop holds and per-frame body/offset tweaks drop
// straight in) plus the scoop-specific maps: which animation is which state and
// which column is which flavor.
import { SpriteSheet } from './spriteSheet.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */

// Scoop states = sheet rows (referenced by animation name). Editor → game.
export const SCOOP_STATE = Object.freeze({
  DEFAULT: 'Default',    // falling from the sky / generic look
  CONE: 'Cone',          // resting on the cone / a customer mini-cone
  CONE_TOP: 'Cone Top'   // top of the tray stack (replaces the old amber ring)
});

// Flavor → sheet column (the sheet's left→right order, NOT COLOR_KEYS order).
const FLAVOR_COL = { choco: 0, pink: 1, mint: 2, vanilla: 3, blueberry: 4 };

// The scoop sheet, in the data contract's shape (see SpriteSheetDef in types.js).
/** @type {import('../types.js').SpriteSheetDef} */
const SCOOP_SHEET_DEF = {
  image: 'assets/scoop_sheet.png',
  imageSize: { width: 349, height: 209 },
  frame: { width: 70, height: 70 },
  animations: [
    {
      name: 'Default',
      frames: [
        { x: 0,   y: 0, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 70,  y: 0, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 140, y: 0, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 210, y: 0, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 280, y: 0, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } }
      ]
    },
    {
      name: 'Cone',
      frames: [
        { x: 0,   y: 70, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 70,  y: 70, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 140, y: 70, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 210, y: 70, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 280, y: 70, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } }
      ]
    },
    {
      name: 'Cone Top',
      frames: [
        { x: 0,   y: 140, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 70,  y: 140, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 140, y: 140, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 210, y: 140, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } },
        { x: 280, y: 140, body: { shape: 'circle', x: 0, y: 0, radius: 32.5 }, offset: { x: 0, y: 0 } }
      ]
    }
  ]
};

export const scoopSheet = new SpriteSheet(SCOOP_SHEET_DEF);

/**
 * Draw a scoop sprite for `color` + `state`, centered on its (x, y) collision
 * point and scaled so the frame's body radius maps onto the world radius `r`
 * (the body is the art↔physics contract). Returns false when the sheet isn't
 * loaded or the flavor has no column, so the caller can fall back to the circle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y collision center
 * @param {number} r world collision radius (SCOOP_RADIUS × the instance scale)
 * @param {ScoopColor} color
 * @param {number | string} state one of SCOOP_STATE
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
