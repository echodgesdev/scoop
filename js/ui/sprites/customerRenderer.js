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

/**
 * The customer's face COLUMN (see FACE) for its state + patience. As patience
 * drains the sequence is Hungry → Default → Upset → Angry, with Drool while
 * servable and Frozen while the pause power-up holds it.
 */
function faceFor(customer, patience, servable, pausePatience) {
  if (customer.state === STATE.LEAVING) return customer.mood === 'happy' ? FACE.HUNGRY : FACE.ANGRY;
  if (customer.state !== STATE.WAITING) return FACE.DEFAULT;  // arriving / delay
  if (customer.rejectT && customer.rejectT > 0) return FACE.ANGRY;  // just got the wrong scoop
  if (pausePatience) return FACE.FROZEN;                       // frozen power-up / debug
  if (servable) return FACE.DROOL;
  if (patience > 0.6) return FACE.HUNGRY;
  if (patience > 0.35) return FACE.DEFAULT;
  if (patience > 0.15) return FACE.UPSET;
  return FACE.ANGRY;
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
