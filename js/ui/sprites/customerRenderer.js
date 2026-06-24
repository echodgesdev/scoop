// @ts-check
// The customer-face sprite binding: builds the customer SpriteSheet and picks the
// expression for each customer's state + patience. The character is the sheet ROW,
// the mood the COLUMN. Pure presentation; customers.js calls drawFace() once per
// customer (Layer 1). FACE_SIZE — the on-screen head diameter — is exported because
// it's the layout anchor the speech bubble and tip badge also sit against.

import { SpriteSheet } from './spriteSheet.js';
import CUSTOMER_SPRITE from './customerSprite.js';
import { STATE } from '../../game/shop.js';

// Customers read at parity with the cone (bigger than a falling scoop) so the
// serve half holds visual weight equal to the fall half. The sheet's 256px cells
// carry a LOT of transparent padding around each head (so every art size fits one
// sheet), so drawing a whole cell at FACE_SIZE makes the head look tiny. So
// FACE_SIZE is the on-screen HEAD diameter, and we scale the cell UP by the head's
// fill fraction — the head itself lands at FACE_SIZE (and the bubble hugs it).
// Tune FACE_SIZE for head size; FACE_CELL_FILL only if the art's padding changes.
export const FACE_SIZE = 168;        // on-screen head diameter (the layout anchor)
const FACE_CELL_FILL = 0.70;         // fraction of the 256px cell the head fills (rest is padding)
const FACE_SCALE = FACE_SIZE / (FACE_CELL_FILL * CUSTOMER_SPRITE.frame.height);

// Expression COLUMNS on the customer sheet (column 0 is the blank "Empty" face,
// reserved for the unlock animation; the 6 moods follow). A customer's row is
// their character.
const FACE = Object.freeze({ EMPTY: 0, DEFAULT: 1, HUNGRY: 2, UPSET: 3, ANGRY: 4, DROOL: 5, FROZEN: 6 });
const faceSheet = new SpriteSheet(CUSTOMER_SPRITE);

// Patience fraction at/below which a WAITING customer reads as ANGRY — and angry now
// SUPERSEDES the drool face, so a customer you've kept waiting too long is mad even if
// you're holding their scoop. Keep in step with ANGRY_AT in ui/customers.js (the shake)
// and below COYOTE_FLOOR_FRAC in game/shop.js (the coyote pauses just above this line).
const ANGRY_FRAC = 0.15;

/**
 * The customer's face COLUMN (see FACE) for its state + patience. As patience drains
 * the sequence is Hungry → Default → Upset → Angry; Drool shows while servable BUT
 * only above the angry threshold (past it, anger wins); Frozen while the pause
 * power-up holds it.
 */
function faceFor(customer, patience, servable, pausePatience) {
  if (customer.state === STATE.LEAVING) return customer.mood === 'happy' ? FACE.HUNGRY : FACE.ANGRY;
  if (customer.state !== STATE.WAITING) return FACE.DEFAULT;  // arriving / delay
  if (customer.rejectT && customer.rejectT > 0) return FACE.ANGRY;  // just got the wrong scoop
  if (pausePatience) return FACE.FROZEN;                       // frozen power-up / debug
  if (patience <= ANGRY_FRAC) return FACE.ANGRY;               // too long — angry beats drool
  if (servable) return FACE.DROOL;
  if (patience > 0.6) return FACE.HUNGRY;
  if (patience > 0.35) return FACE.DEFAULT;
  return FACE.UPSET;                                           // ANGRY_FRAC < patience <= 0.35
}

/**
 * Draw one customer's face (the head sprite) on the ground; the mood column is
 * chosen from the customer's state + patience, the row from their character.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../../types.js').Customer} customer
 * @param {number} cx interpolated customer x (drawn position)
 * @param {number} faceY face center (world)
 * @param {{ patience: number, servable: boolean, pausePatience: boolean }} opts
 */
export function drawFace(ctx, customer, cx, faceY, { patience, servable, pausePatience }) {
  const faceIdx = faceFor(customer, patience, servable, pausePatience);
  faceSheet.draw(ctx, customer.character || '', faceIdx, cx, faceY, FACE_SCALE);
}

// === Baked head-shaped drop shadow ===========================================
const SHADOW_OFF = 4096;                 // park the real sprite this far left while baking
const SHADOW_DX  = FACE_SIZE * 0.05;     // shadow cast slightly to the side …
const SHADOW_DY  = FACE_SIZE * 0.13;     // … and down, so it peeks out below the head
const SHADOW_BLUR = 2;                   // crisp, not a soft blob
const SHADOW_PAD  = 16;                  // offscreen margin so the blur isn't clipped

/** @type {Map<string, { canvas: HTMLCanvasElement, dx: number, dy: number }>} */
const _shadowCache = new Map();
let _shadowTint = '';

/**
 * Bake one character's blurred, tinted head silhouette into an offscreen canvas at
 * FULL opacity (the draw applies the real alpha). Same off-canvas shadow-offset
 * trick as the old live path, run once. The silhouette is centered in the canvas;
 * dx/dy then blit it so the face anchor maps back to (cx, faceY). Returns null if
 * the sheet image isn't loaded yet (caller skips and retries next frame).
 * @param {string} character @param {string} tint  "r, g, b"
 * @returns {{ canvas: HTMLCanvasElement, dx: number, dy: number } | null}
 */
function bakeFaceShadow(character, tint) {
  const dw = faceSheet.frameW * FACE_SCALE, dh = faceSheet.frameH * FACE_SCALE;
  const W = Math.ceil(dw) + SHADOW_PAD * 2;
  const H = Math.ceil(dh) + SHADOW_PAD * 2;
  const f = faceSheet.frame(character, FACE.DEFAULT);
  const offX = (f && f.offset ? f.offset.x : 0) * FACE_SCALE;
  const offY = (f && f.offset ? f.offset.y : 0) * FACE_SCALE;
  // Anchor placed so the silhouette (sprite center + shadow offset) lands at the
  // canvas center, whatever the frame offset is.
  const ax = W / 2 - offX - SHADOW_DX;
  const ay = H / 2 - offY - SHADOW_DY;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.shadowColor = `rgba(${tint}, 1)`;
  g.shadowBlur = SHADOW_BLUR;
  g.shadowOffsetX = SHADOW_OFF + SHADOW_DX;
  g.shadowOffsetY = SHADOW_DY;
  if (!faceSheet.draw(g, character, FACE.DEFAULT, ax - SHADOW_OFF, ay, FACE_SCALE)) return null;
  return { canvas, dx: -ax, dy: -ay };
}

/**
 * Draw a customer's grounding drop shadow (head-shaped). Drawn before the face so the
 * head sits on top of it. Blits a baked silhouette (see bakeFaceShadow); `alpha` is
 * applied here so a fade never triggers a re-bake.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../../types.js').Customer} customer
 * @param {number} cx @param {number} faceY
 * @param {string} tint  "r, g, b" (the day-tinted shadow color)
 * @param {number} [alpha]
 */
export function drawFaceShadow(ctx, customer, cx, faceY, tint, alpha = 0.38) {
  if (tint !== _shadowTint) { _shadowCache.clear(); _shadowTint = tint; }
  const character = customer.character || '';
  let stamp = _shadowCache.get(character);
  if (!stamp) {
    stamp = bakeFaceShadow(character, tint);
    if (!stamp) return;            // sheet not loaded yet — skip (the face is hidden too)
    _shadowCache.set(character, stamp);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(stamp.canvas, cx + stamp.dx, faceY + stamp.dy);
  ctx.restore();
}
