// @ts-check
// The HUD-scoop sprite binding: builds the small scoop-icon SpriteSheet (the
// speech-bubble wanted-color swatches + the recipe-book coins) and exposes the
// color→column map plus a draw helper. Shared by bubbleView (canvas swatches) and
// coinTemplate (the COL map for the journal's recipe-coin scoops).
import { SpriteSheet } from './spriteSheet.js';
import HUD_SCOOP_SPRITE from './hudScoopSprite.js';

// color → column on the HUD scoop sheet (same color order as the gameplay scoop
// sheet's FLAVOR_COL). 'empty' is the trailing white scoop, for an unknown/locked
// slot (colorized grey by the consumer).
export const HUD_SCOOP_COL = Object.freeze({
  choco: 0, pink: 1, mint: 2, vanilla: 3, blueberry: 4, rainbow: 5, empty: 6
});

const hudScoopSheet = new SpriteSheet(HUD_SCOOP_SPRITE);

/**
 * Blit one HUD scoop icon centered at (x, y), scaled to `size` px on-screen.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} size on-screen px
 * @param {number} col one of HUD_SCOOP_COL
 * @returns {boolean} whether it drew
 */
export function drawHudScoop(ctx, x, y, size, col) {
  return hudScoopSheet.draw(ctx, 0, col, x, y, size / hudScoopSheet.frameW);
}
