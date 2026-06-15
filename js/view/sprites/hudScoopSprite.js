// @ts-check
// HUD scoop sprite sheet — small scoop icons for the speech bubbles and the
// recipe book (they replace the flat color circles). One row of 7 cells (256px):
// the six scoop colors in the SAME column order as the gameplay scoop sheet
// (FLAVOR_COL in view/sprites.js), plus a trailing white "empty" scoop used to
// mark an unknown / locked slot (colorized grey by the consumer, like the locked
// regular silhouettes). Source: dev_tools/base_sprite_sheet_jsons/hud_scoop_sheet.json.

const FRAME = 256;   // cell size, px (2× the original 128 for sharper downscaling)
const COLS = 7;

// color → column. 'empty' is the trailing white scoop.
export const HUD_SCOOP_COL = Object.freeze({
  choco: 0, pink: 1, mint: 2, vanilla: 3, blueberry: 4, rainbow: 5, empty: 6
});

/** @type {import('../../types.js').SpriteSheetDef} */
const HUD_SCOOP_SPRITE = {
  // Runtime path (relative to index.html) — used verbatim.
  image: 'assets/hud_scoop_sheet.png',
  imageSize: { width: COLS * FRAME, height: FRAME },
  frame: { width: FRAME, height: FRAME },
  animations: [{
    name: 'scoops',
    frames: Array.from({ length: COLS }, (_, col) => ({
      x: col * FRAME, y: 0, body: null, offset: { x: 0, y: 0 }
    }))
  }]
};

export default HUD_SCOOP_SPRITE;
