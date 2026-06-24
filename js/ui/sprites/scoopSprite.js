// @ts-check
// The scoop sprite-sheet DEFINITION (data) — the resting states + default-speed
// fall. Each frame's `body` is the collision shape; config.js derives the scoop's
// size from it and the generic renderer (engine/spriteSheet.js) draws from it.
//
// Regenerate from the sprite editor (dev_tools/sprite_sheet_generator →
// "Download .js" / "Copy as JS"); it emits a flat `export default { … }` you can
// paste straight over the builder below. The builder is just the compact form of
// that uniform grid.

const FRAME = 70;   // cell size, px
const BODY_R = 35;  // collision-body radius the editor set for every cell
const COLS = 7;     // 6 flavor columns (choco, pink, mint, vanilla, blueberry, rainbow) + 1 dissolve-outline column

// Sheet rows, top→bottom: the on-screen scoop states, then the fall-speed pairs.
const ROWS = [
  'Default', 'Scoop', 'Scoop Top',
  'Medium Fall Top', 'Medium Fall Bottom',
  'Medium Fast Fall Top', 'Medium Fast Fall Bottom',
  'Fast Fall Top', 'Fast Fall Bottom'
];

/** @type {import('../../engine/types.js').SpriteSheetDef} */
const SCOOP_SPRITE = {
  // Runtime path (relative to index.html) — consumers use it verbatim.
  image: 'assets/scoop_sheet.png',
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

export default SCOOP_SPRITE;
