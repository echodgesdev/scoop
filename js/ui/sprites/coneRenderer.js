// @ts-check
// The waffle-cone sprite binding: a BACK layer + a FRONT layer the scoop stack
// draws between. The sheet art is already colorized, so the renderer just blits
// it. Shared by the player's cone (playerView) and the customers' held mini-cones
// (customers) so both nest scoops identically. CONE_SPRITE_W is the on-screen art
// width and CONE_SPRITE_DY nudges it vertically so the bowl meets the bottom
// scoop — tune those two if the cone reads too big/small or scoops don't nest.
import { SpriteSheet } from '../../engine/spriteSheet.js';
import CONE_SPRITE from './coneSprite.js';
import { CONE, SCOOP } from '../../game/config.js';

// Which sheet frame is which layer. Lives here (the binding), not in the def, so
// the def stays pure tool-generated data.
export const CONE_FRAME = Object.freeze({ REFERENCE: 0, FULL: 1, BACK: 2, FRONT: 3 });

const coneSheet = new SpriteSheet(CONE_SPRITE);
const CONE_FRAME_PX = CONE_SPRITE.frame.width;        // 256
const CONE_SPRITE_W = 168;                            // on-screen cone width (px)
const CONE_SPRITE_DY = -14;                           // sprite-center offset from player.y

// Bowl seat: how far BELOW the bottom scoop's center the cone-sprite center sits
// (at scoopScale 1). Derived from the layout — CONE_SPRITE_DY + CONE.HEIGHT/2 +
// the bottom scoop's 0.2r nudge (see scoopPosition) — so any caller can seat a
// cone of any size under a stack and nest scoops exactly like the player's cone.
const CONE_BOWL_SEAT = CONE.HEIGHT / 2 + CONE_SPRITE_DY + SCOOP.RADIUS * 0.2;

/**
 * Blit one cone-sheet frame (BACK or FRONT) as a square of side `w` centered at
 * (cx, cy). @returns {boolean} whether it drew.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} w @param {number} frame
 */
function drawConeFrame(ctx, cx, cy, w, frame) {
  if (!coneSheet.ready) return false;
  const F = CONE_FRAME_PX;
  ctx.drawImage(coneSheet.img, frame * F, 0, F, F, cx - w / 2, cy - w / 2, w, w);
  return true;
}

/**
 * Draw the player's cone layer, centered on the player. Call once with BACK
 * before the scoop stack and once with FRONT after, so the bottom scoop nests
 * into the bowl. @returns {boolean} whether it drew.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} playerX @param {number} playerY @param {number} frame one of CONE_FRAME
 */
export function drawPlayerCone(ctx, playerX, playerY, frame) {
  return drawConeFrame(ctx, playerX, playerY + CONE_SPRITE_DY, CONE_SPRITE_W, frame);
}

/**
 * Draw one cone layer sized + positioned to seat a scoop stack whose bottom scoop
 * is centered at (scoopX, scoopY) and drawn at `scoopScale` (1 = the player's
 * full-size scoop). Shared by the player's cone and the customers' held mini-cones
 * so both nest scoops identically. @returns {boolean} whether it drew.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} scoopX @param {number} scoopY bottom-scoop center (world)
 * @param {number} scoopScale @param {number} frame one of CONE_FRAME
 */
export function drawConeUnderStack(ctx, scoopX, scoopY, scoopScale, frame) {
  return drawConeFrame(ctx, scoopX, scoopY + CONE_BOWL_SEAT * scoopScale, CONE_SPRITE_W * scoopScale, frame);
}
