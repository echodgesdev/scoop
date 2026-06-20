// @ts-check
// Customer sprite-sheet DEFINITION (data) — the multi-character sheet that
// replaces the single-row mascot_test faces. 14 rows × 7 columns of 256px cells.
// Source of truth: dev_tools/base_sprite_sheet_jsons/customer_sheet.json — re-
// export there (sprite editor → "Download .js") and re-derive this compact
// builder when the sheet changes. This is just the uniform-grid form of that.
//
// ROWS (top→bottom). Row 0 ("Empty") is the sheet's column-label/legend strip,
// NOT a playable character; the playable roster is rows 1..13 (see CHARACTERS in
// game/customers.js, which references rows by name — so these MUST stay in sync).
//
// COLUMNS per row, left→right (one face per expression):
//   0 Empty   — blank/silhouette: the pre-unlock "coin" face
//   1 Default — neutral waiting face (a.k.a. "Start"; also the unlock reveal)
//   2 Hungry · 3 Upset · 4 Angry · 5 Drool · 6 Frozen
// This is the old 6-face layout shifted one column right (Empty took column 0),
// so a face's column = its old index + 1 (see drawFace in ui/sprites/customerRenderer.js).
//
// Faces don't collide (they're tap-targeted by lane x, not by a body), so every
// frame's `body` is null — the sheet's 115px circles go unused by the game.

const FRAME = 256;
const COLS = 7;

// Sheet rows, in sheet order. Names must match customer_sheet.json exactly.
const ROWS = [
  'Empty',
  'Annie', 'Amara', 'Sanjay', 'Gerald', 'Chad', 'Missy', 'Karen',
  'Axel', 'Reginald', 'Chris', 'Freddie', 'Harvey Green', 'Poop'
];

/** @type {import('../../types.js').SpriteSheetDef} */
const CUSTOMER_SPRITE = {
  // Runtime path (relative to index.html) — consumers use it verbatim.
  image: 'assets/customer_sheet.png',
  imageSize: { width: COLS * FRAME, height: ROWS.length * FRAME },
  frame: { width: FRAME, height: FRAME },
  animations: ROWS.map((name, row) => ({
    name,
    frames: Array.from({ length: COLS }, (_, col) => ({
      x: col * FRAME, y: row * FRAME, body: null, offset: { x: 0, y: 0 }
    }))
  }))
};

export default CUSTOMER_SPRITE;
