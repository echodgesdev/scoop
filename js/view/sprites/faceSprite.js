// @ts-check
// Customer face sprite-sheet DEFINITION (data) — replaces the emoji faces. One
// row of 6 frames: 0 Default · 1 Hungry · 2 Upset · 3 Angry · 4 Drool · 5 Frozen.
// Faces don't collide, so every `body` is null. Regenerate from the sprite editor
// (dev_tools/sprite_sheet_generator → "Download .js") and paste over the builder.

const FRAME = 102;
const COLS = 6;

/** @type {import('../../types.js').SpriteSheetDef} */
const FACE_SPRITE = {
  image: 'mascot_test.png',
  imageSize: { width: 614, height: FRAME },
  frame: { width: FRAME, height: FRAME },
  animations: [{
    name: 'faces',
    frames: Array.from({ length: COLS }, (_, col) => ({
      x: col * FRAME, y: 0, body: null, offset: { x: 0, y: 0 }
    }))
  }]
};

export default FACE_SPRITE;
