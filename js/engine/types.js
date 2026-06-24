// @ts-check
// Engine-level shared types. Game-agnostic data contracts the reusable engine
// modules speak — kept out of the game's types.js so an engine module (and the
// sprite-editor output it consumes) stays self-contained and portable.

/**
 * Sprite-sheet data contract — the shape the sprite editor (assets/index.html)
 * exports and the generic SpriteSheet renderer (engine/spriteSheet.js) consumes.
 * All coordinates are in the sheet's native pixels.
 *
 * @typedef {object} SpriteBody  the rigid body, relative to the frame's anchor
 * @property {'circle'|'rect'} shape
 * @property {number} x   body center X vs the anchor
 * @property {number} y   body center Y vs the anchor
 * @property {number} [radius]  circle radius
 * @property {number} [width]   rect width
 * @property {number} [height]  rect height
 *
 * @typedef {object} SpriteFrame
 * @property {number} x   top-left X of the cell in the sheet
 * @property {number} y   top-left Y of the cell in the sheet
 * @property {(SpriteBody|null)} body   collision body, or null for a visual-only frame
 * @property {{ x: number, y: number }} offset  sprite center relative to the anchor
 *
 * @typedef {object} SpriteAnimation
 * @property {string} name
 * @property {SpriteFrame[]} frames
 *
 * @typedef {object} SpriteSheetDef
 * @property {string} image   path to the sheet image
 * @property {{ width: number, height: number }} [imageSize]
 * @property {{ width: number, height: number }} frame  cell (viewport) size
 * @property {SpriteAnimation[]} animations
 */

export {};
