// @ts-check
// Oversized fast-fall scoops — their own sheet (taller cells than the 70px base
// scoops). One frame per flavor per speed tier; the scoop ball + its motion streak
// are baked into one image, so there's nothing to composite.
//
// Regenerate from the sprite editor (load scoop_sheet_falling.png, size each body
// to the scoop ball, drag the SPRITE so the ball sits on the anchor crosshair,
// then "Download .js" and paste over this). The builder below is the compact form.
//
// `body.radius` is the scoop ball (35) — it drives the 1:1 draw scale, so it must
// match the base scoop's radius. `offset.y` lifts the tall frame up so the ball
// lands on the falling scoop's catch point and the streak trails above.

const FRAME_W = 70;
const FRAME_H = 140;
const BODY_R = 35;        // the scoop ball (= base SCOOP_RADIUS → renders 1:1)
const COLS = 6;           // flavors: choco, pink, mint, vanilla, blueberry, rainbow
const ROWS = 3;           // speed tiers, top→bottom (mapped in view/sprites/scoopRenderer.js by index)
const OFFSET_Y = -(FRAME_H / 2 - BODY_R);  // ball at the cell bottom → lift onto the anchor

/** @type {import('../../types.js').SpriteSheetDef} */
const SCOOP_FAST_SPRITE = {
  // Runtime path (relative to index.html) — consumers use it verbatim.
  image: 'assets/scoop_sheet_falling.png',
  imageSize: { width: COLS * FRAME_W, height: ROWS * FRAME_H },
  frame: { width: FRAME_W, height: FRAME_H },
  animations: Array.from({ length: ROWS }, (_, row) => ({
    name: 'row ' + row,
    frames: Array.from({ length: COLS }, (_, col) => ({
      x: col * FRAME_W, y: row * FRAME_H,
      body: { shape: /** @type {'circle'} */ ('circle'), x: 0, y: 0, radius: BODY_R },
      offset: { x: 0, y: OFFSET_Y }
    }))
  }))
};

export default SCOOP_FAST_SPRITE;
