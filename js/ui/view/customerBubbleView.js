// @ts-check
// The customer speech-bubble renderer. A bubble shows the order's wanted-color
// scoops, a state-keyed border (active = amber, servable = mint, else grey), and
// a draining patience bar. It scales in from its tail on spawn and fades toward
// translucent when the player's cone passes behind it. Pure presentation — all
// state lives in Shop; customers.js calls drawBubble() once per waiting customer.

import { glowRoundRect } from '../effects/glow.js';
import { drawHudScoop, HUD_SCOOP_COL } from '../sprites/hudScoopRenderer.js';

/** @typedef {import('../../types.js').Customer} Customer */

const BUBBLE_H = 78;     // bubble body height (tightened after the value line was removed)
const GAP = 18;          // between face top and bubble bottom
const POP_TIME = 0.16;   // scale-in duration on spawn

const SWATCH_R   = 17;   // wanted-color slot radius (drives bubble width)
const SWATCH_GAP = 9;    // edge-to-edge between swatches
const BUBBLE_PAD = 26;   // horizontal padding around the swatch row
const SWATCH_SCOOP_SIZE = 40;   // on-screen size of each wanted-color scoop icon

// A bubble fades toward this opacity as the cone (the player) passes horizontally
// behind it, so the cone + tray stay readable through it. CONE_OVERLAP_HALF is
// the cone's half-reach (cone + a scoop) added to the bubble half-width for the
// proximity test.
const BUBBLE_MIN_ALPHA = 0.75;
const CONE_OVERLAP_HALF = 55;

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

/** Bubble width for an order of `orderLen` scoops — wide enough for the swatch row. */
function bubbleWidthFor(orderLen) {
  const swatches = Math.max(1, orderLen);
  const row = swatches * SWATCH_R * 2 + (swatches - 1) * SWATCH_GAP;
  return Math.max(150, row + BUBBLE_PAD * 2);
}

/**
 * Draw one customer's speech bubble above their face. Reads as the bubble's
 * recipe: compute the pop scale + cone-proximity fade + geometry, then paint the
 * shell, the wanted-color row, and the patience bar inside the scale-in transform.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Customer} c
 * @param {number} cx interpolated customer x (drawn position)
 * @param {number} faceY customer face center (world)
 * @param {number} faceSize on-screen head diameter — the bubble sits above it
 * @param {{ servable: boolean, active: boolean, patience: number, rainbow: boolean, coneX?: (number|null) }} opts
 */
export function drawBubble(ctx, c, cx, faceY, faceSize, { servable, active, patience, rainbow, coneX = null }) {
  const pop = easeOut(Math.min(1, c.waitT / POP_TIME));
  const alpha = coneProximityAlpha(c, cx, coneX);

  const bubbleBottom = faceY - faceSize / 2 - GAP;
  const top = bubbleBottom - BUBBLE_H;
  const bubbleW = bubbleWidthFor(c.order.colors.length);
  const left = cx - bubbleW / 2;

  ctx.save();
  // Fade the whole bubble when the cone is behind it (1 = opaque).
  if (alpha < 1) ctx.globalAlpha = alpha;
  // Scale-in pop, anchored at the tail (bottom-center, by the face).
  ctx.translate(cx, bubbleBottom);
  ctx.scale(pop, pop);
  ctx.translate(-cx, -bubbleBottom);

  drawBubbleShell(ctx, { cx, bubbleBottom, left, top, bubbleW, active, servable });
  drawWantedColors(ctx, c, cx, top, rainbow);
  drawPatienceBar(ctx, left, top, bubbleW, patience);

  ctx.restore();
}

/**
 * Fade toward translucent as the player's cone passes horizontally behind the
 * bubble, so the cone + tray stay readable through it. Returns 1 (opaque) when
 * there's no cone, or when it's clear of the bubble's reach.
 * @param {Customer} c @param {number} cx @param {number | null} coneX
 * @returns {number}
 */
function coneProximityAlpha(c, cx, coneX) {
  if (coneX == null) return 1;
  const range = bubbleWidthFor(c.order.colors.length) / 2 + CONE_OVERLAP_HALF;
  const overlap = Math.max(0, 1 - Math.abs(cx - coneX) / range);
  return 1 - (1 - BUBBLE_MIN_ALPHA) * overlap;
}

/**
 * The bubble shell: a baked state-colored halo, the downward tail, then the
 * rounded body + border. The tail is a solid triangle in the OUTLINE color (its
 * infill matches the border — same as the tutorial tooltip tail), pointing down
 * at the customer; the body's bottom border is that color too, so the two blend
 * into one continuous pointer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, bubbleBottom: number, left: number, top: number, bubbleW: number, active: boolean, servable: boolean }} g
 */
function drawBubbleShell(ctx, { cx, bubbleBottom, left, top, bubbleW, active, servable }) {
  const outline = active ? '#ffb703' : (servable ? '#06d6a0' : '#666');
  ctx.save();
  // Baked halo behind the whole bubble (replaces the per-frame shadowBlur).
  if (active) glowRoundRect(ctx, left, top, bubbleW, BUBBLE_H, 14, '#ffd166', 18);
  else if (servable) glowRoundRect(ctx, left, top, bubbleW, BUBBLE_H, 14, '#06d6a0', 14);
  // Tail first, so the body fill + border draw cleanly over its root.
  ctx.beginPath();
  ctx.moveTo(cx - 10, bubbleBottom - 1);
  ctx.lineTo(cx, bubbleBottom + 13);
  ctx.lineTo(cx + 10, bubbleBottom - 1);
  ctx.closePath();
  ctx.fillStyle = outline;
  ctx.fill();
  // Body.
  ctx.beginPath();
  ctx.roundRect(left, top, bubbleW, BUBBLE_H, 14);
  ctx.fillStyle = servable ? '#eafff7' : 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.lineWidth = active ? 5 : 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.restore();
}

/**
 * The wanted-color scoop icons — a centered row that scales with order length
 * (rainbow mode paints every slot as the rainbow scoop).
 * @param {CanvasRenderingContext2D} ctx @param {Customer} c
 * @param {number} cx @param {number} top @param {boolean} rainbow
 */
function drawWantedColors(ctx, c, cx, top, rainbow) {
  const n = c.order.colors.length;
  const step = SWATCH_R * 2 + SWATCH_GAP;
  const rowW = n * SWATCH_R * 2 + (n - 1) * SWATCH_GAP;
  const swatchY = top + 30;
  const firstX = cx - rowW / 2 + SWATCH_R;
  for (let k = 0; k < n; k++) {
    const sx = firstX + k * step;
    const col = rainbow ? HUD_SCOOP_COL.rainbow : HUD_SCOOP_COL[c.order.colors[k]];
    drawHudScoop(ctx, sx, swatchY, SWATCH_SCOOP_SIZE, col);
  }
}

/**
 * Draining patience bar along the bubble's lower edge — green, turning red below
 * 30%.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} left @param {number} top @param {number} bubbleW @param {number} patience
 */
function drawPatienceBar(ctx, left, top, bubbleW, patience) {
  const barX = left + 14;
  const barW = bubbleW - 28;
  const barY = top + BUBBLE_H - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 8, 4);
  ctx.fill();
  ctx.fillStyle = patience < 0.3 ? '#e63946' : '#43aa8b';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * Math.max(0, patience), 8, 4);
  ctx.fill();
}
