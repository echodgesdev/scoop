// @ts-check
// Cone sprite sheet — a compound, colorized cone that replaces the flat triangle.
// One row of 4 cells (256px). The art is fully colored in the sheet, so the
// renderer blits it straight (no recolor) — see playerView.js. All four frames
// share the cell, so they overlay exactly.
//
// Frames:
//   0 REFERENCE — a cone with a scoop in it, showing how scoops nest in the bowl.
//     Art reference only; never rendered in-game.
//   1 FULL      — the fully-assembled cone (also not rendered; the back+front
//     split is what draws, with the scoop stack between them).
//   2 BACK      — drawn BEHIND the scoop stack.
//   3 FRONT     — the front lip, drawn IN FRONT of the stack so the bottom scoop
//     nests into the bowl.
// Source: dev_tools/base_sprite_sheet_jsons/cone_sheet.json.

const FRAME = 256;
const COLS = 4;

/** @type {import('../../engine/types.js').SpriteSheetDef} */
const CONE_SPRITE = {
  // Runtime path (relative to index.html) — used verbatim.
  image: 'assets/cone_sheet.png',
  imageSize: { width: COLS * FRAME, height: FRAME },
  frame: { width: FRAME, height: FRAME },
  animations: [{
    name: 'cone',
    frames: Array.from({ length: COLS }, (_, col) => ({
      x: col * FRAME, y: 0, body: null, offset: { x: 0, y: 0 }
    }))
  }]
};

export default CONE_SPRITE;
