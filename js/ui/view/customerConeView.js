// @ts-check
// The customer's held mini-cone: a small cone beside the customer's face holding
// the scoops they've been served so far. Each new scoop flies in along an arc
// from where the player's cone-top scoop was at serve time, then squash-pops into
// its slot. Pure presentation; customers.js calls drawHeldCone() once per customer
// (Layer 2).
import { drawScoop } from './playerView.js';
import { drawConeUnderStack, CONE_FRAME } from '../sprites/coneRenderer.js';
import { SCOOP_STATE } from '../sprites/scoopRenderer.js';
import { SCOOP } from '../../game/config.js';

/** @typedef {import('../../types.js').Customer} Customer */

// Mini-cone proportions (the customer's held cone, fills with served scoops) and
// the served-scoop flight arc — view-only presentation, scaled to read
// proportionally beside the larger customer faces. Not gameplay balance, so they
// live here rather than in tuning.js.
const MINI_SCOOP_RADIUS = 19;
const MINI_CONE_OFFSET_X = 58;        // right of the customer face
const MINI_CONE_H = 50;               // bowl-seat height: how far above the tip the bottom scoop sits
const MINI_CONE_FACE_OFFSET_PX = 46;  // cone tip relative to the customer's face center
const SERVED_FLIGHT_ARC = 50;         // peak upward bump along the in-flight arc

/**
 * Draw a customer's held mini-cone + its served-scoop stack. Stack grows upward
 * as serveOne accepts; each new entry flies in along an arc from the serve source.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Customer} c
 * @param {number} cx interpolated customer x (drawn position)
 * @param {number} faceY face center (world; already includes the slide-in offset)
 * @param {number} [alpha] render-interpolation fraction for in-flight scoops
 */
export function drawHeldCone(ctx, c, cx, faceY, alpha = 1) {
  const served = c.order.served;
  if (!served || served.length === 0) return;

  const baseX = cx + MINI_CONE_OFFSET_X;
  // Cone tip positioned MINI_CONE_FACE_OFFSET_PX below the face center, so the
  // cone "hangs" at the customer's chin level regardless of how submerged they
  // are. faceY already includes the slide-in offset.
  const baseY = faceY + MINI_CONE_FACE_OFFSET_PX;

  const spacing = MINI_SCOOP_RADIUS * 1.6;
  const scale = MINI_SCOOP_RADIUS / SCOOP.RADIUS;

  // The bottom scoop's resting center (i = 0 of the stack below). The layered cone
  // sprite — the same one the player carries, scaled down — is seated under it so
  // its bowl nests the scoops, with BACK behind the stack and FRONT over it.
  const seatY = baseY - MINI_CONE_H - MINI_SCOOP_RADIUS * 0.2;
  drawConeUnderStack(ctx, baseX, seatY, scale, CONE_FRAME.BACK);

  for (let i = 0; i < served.length; i++) {
    const s = served[i];
    const slotY = baseY - MINI_CONE_H - i * spacing - MINI_SCOOP_RADIUS * 0.2;
    const { x, y, squash } = servedScoopFlight(s, baseX, slotY, alpha);
    drawScoop(ctx, x, y, s.color, scale * squash, SCOOP_STATE.CONE);
  }

  // Cone FRONT — over the stack, so the bottom scoop nests into the bowl.
  drawConeUnderStack(ctx, baseX, seatY, scale, CONE_FRAME.FRONT);
}

/**
 * In-flight pose for one served scoop arcing from its serve source to its slot:
 * ease-in-out along the path, plus a sin-bump that lifts it (so it reads as
 * "tossed across") and a squash-pop on the last sliver of the flight (mimicking
 * the player tray's land animation). Flight progress is interpolated between sim
 * steps — it's a fast arc.
 * @param {{ srcX: number, srcY: number, t: number, prevT?: number }} s served-scoop flight state
 * @param {number} slotX @param {number} slotY resting slot the scoop flies into
 * @param {number} alpha render-interpolation fraction
 * @returns {{ x: number, y: number, squash: number }}
 */
function servedScoopFlight(s, slotX, slotY, alpha) {
  const st = s.prevT !== undefined ? s.prevT + (s.t - s.prevT) * alpha : s.t;
  const t = Math.max(0, Math.min(1, st));
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const x = s.srcX + (slotX - s.srcX) * e;
  const linearY = s.srcY + (slotY - s.srcY) * e;
  const y = linearY - Math.sin(t * Math.PI) * SERVED_FLIGHT_ARC;
  const squash = t > 0.85 ? 1 + 0.35 * (1 - (t - 0.85) / 0.15) : 1;
  return { x, y, squash };
}
