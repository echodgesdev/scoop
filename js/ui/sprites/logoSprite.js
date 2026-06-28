// @ts-check
// Title-sign sprite sheet — the "Poop in a Scoop" marquee, one fully-colored cell.
// Single row, single frame: the art is colored in the sheet, so the renderer blits
// it straight (no recolor), exactly like the cone. Drawn only on the attract screen
// (ui/view/titleLogoView.js), anchored to the cone by its arrow tip. `body` is null —
// the sign never collides.
//
// Source: assets/logo_sheet.png. Re-export at any resolution — only the ASPECT
// matters here, since the view scales the cell to a fixed world width (LOGO_W).
// If you re-export at a different pixel size, update FRAME_W/FRAME_H to match so the
// aspect stays correct.

const FRAME_W = 702;   // logo_sheet.png native size
const FRAME_H = 800;

/** @type {import('../../engine/types.js').SpriteSheetDef} */
const LOGO_SPRITE = {
  // Runtime path (relative to index.html) — used verbatim.
  image: 'assets/logo_sheet.png',
  imageSize: { width: FRAME_W, height: FRAME_H },
  frame: { width: FRAME_W, height: FRAME_H },
  animations: [{
    name: 'logo',
    frames: [{ x: 0, y: 0, body: null, offset: { x: 0, y: 0 } }]
  }]
};

export default LOGO_SPRITE;
