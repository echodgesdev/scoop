// @ts-check
// The customer tip-badge renderer. In Tipping mode the badge is the ONLY power-up
// source, so the reward a customer will hand over on a completed order is shown as
// a big, glowing, gently-bobbing coin above their head — impossible to miss. Pure
// presentation; customers.js calls drawTip() once per tipping customer.

import { glowCircle } from '../effects/glow.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR } from '../powerupVisuals.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} tip pickup type or PICKUP_TYPE.COIN
 * @param {number} cx @param {number} faceY  customer face center (world)
 * @param {number} faceSize on-screen head diameter — the badge sits on its upper-left
 * @param {number} canvasWidth virtual canvas width — clamps the badge on-screen (0 = no clamp)
 * @param {number} time free-running clock (s) for the pulse / bob
 * @param {boolean} showLabel draw the "TIP" tag (tutorial only)
 */
export function drawTip(ctx, tip, cx, faceY, faceSize, canvasWidth, time, showLabel) {
  const ring = PICKUP_RING_COLOR[tip] || '#ffd700';
  const bob = Math.sin(time * 3) * 4;            // gentle float
  const pulse = 1 + 0.06 * Math.sin(time * 5.5); // breathing scale
  const r = 21 * pulse;                          // smaller badge (was 30)
  // Sit on the customer's upper-left, OVERLAPPING the head, so the token reads
  // as clearly theirs — not floating off toward a neighbor. Clamp to the canvas
  // so the edge slots don't push it off-screen.
  const by = faceY - faceSize * 0.30 + bob;
  let bx = cx - faceSize * 0.30;
  if (canvasWidth) bx = Math.max(r + 5, Math.min(canvasWidth - r - 5, bx));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawTipSparkles(ctx, bx, by, r, ring, time);
  drawTipCoin(ctx, bx, by, r, ring, tip);
  if (showLabel) drawTipLabel(ctx, bx, by, r);

  ctx.restore();
}

/**
 * Soft rotating sparkles orbiting the badge to pull the eye (tight orbit).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} bx @param {number} by badge center
 * @param {number} r badge radius @param {string} ring sparkle color @param {number} time
 */
function drawTipSparkles(ctx, bx, by, r, ring, time) {
  ctx.fillStyle = ring;
  for (let k = 0; k < 3; k++) {
    const a = time * 1.6 + k * (Math.PI * 2 / 3);
    const sx = bx + Math.cos(a) * (r + 5);
    const sy = by + Math.sin(a) * (r + 5);
    const ss = 2 + 1.3 * (0.5 + 0.5 * Math.sin(time * 6 + k));
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(sx, sy, ss, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The coin itself: a baked soft drop shadow (offset down) + a tight colored ring
 * glow, then the white body, the colored eye-catcher ring, a faint inner ring
 * (minted-coin read), and the reward icon — all drawn crisp on top, no per-frame
 * shadowBlur.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} bx @param {number} by badge center
 * @param {number} r badge radius @param {string} ring ring color
 * @param {string} tip pickup type or PICKUP_TYPE.COIN (selects the icon)
 */
function drawTipCoin(ctx, bx, by, r, ring, tip) {
  glowCircle(ctx, bx, by + 3, r, 'rgba(0, 0, 0, 0.45)');
  glowCircle(ctx, bx, by, r + 1, ring, 0.85);
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.arc(bx, by, r - 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = `${Math.floor(r * 1.05)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  ctx.fillStyle = '#222';
  ctx.fillText(PICKUP_ICONS[tip] || '🪙', bx, by + 1);
}

/**
 * "TIP" tag beneath the badge — an onboarding affordance, shown only during the
 * tutorial.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} bx @param {number} by badge center @param {number} r badge radius
 */
function drawTipLabel(ctx, bx, by, r) {
  ctx.font = "bold 12px 'Cousine', 'Comic Sans MS', sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillStyle = '#fff';
  ctx.strokeText('TIP', bx, by + r + 8);
  ctx.fillText('TIP', bx, by + r + 8);
}
