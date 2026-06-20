// @ts-check
// The active power-up indicator (screen-space): a single bubble showing the
// running timed power-up with its countdown ring. It lobs up from where the
// power-up was caught to a mid waypoint, holds, then settles into its resting
// slot while shrinking; a finished / replaced one slides off left. Pure
// presentation — reads game.world (activeBubble / puLeaving / activeSlotPos /
// powerups). Drawn screen-fixed, after the shake transform is popped (see
// renderer.drawFrame).

import { glowCircle } from '../effects/glow.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR } from '../powerupVisuals.js';
import { PICKUP_TO_POWER } from '../../game/config.js';

/** @typedef {import('../../game.js').Game} Game */

// Entrance phases (fractions of the slide anim). The bubble arcs up to a mid
// waypoint (large, with a slight hold) then settles to its resting slot while
// shrinking. The sim-side timing (ACTIVE_SLIDE_S) lives in game.js.
const ACTIVE_ARC_FRAC = 0.45;    // 0..this: arc up-and-over to the mid waypoint
const ACTIVE_PAUSE_FRAC = 0.6;   // arc-frac..this: slight hold at the waypoint

/**
 * Active power-up indicator. Idle → nothing. A finished / replaced bubble slides
 * off LEFT. The entrance lobs up to a waypoint then settles into the resting slot
 * (game.world.activeSlotPos) while shrinking.
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 */
export function drawActivePowerup(ctx, game) {
  const world = game.world;
  if (!world.activeBubble && world.puLeaving.length === 0) return;
  const aslot = world.activeSlotPos();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Bubbles sliding off to the left (finished / replaced).
  for (const lv of world.puLeaving) {
    ctx.globalAlpha = 1 - lv.t;
    drawPowerupBubble(ctx, lv.x - lv.t * 70, lv.y, lv.r0 * (1 - 0.5 * lv.t), lv.type, false, -1);
  }
  ctx.globalAlpha = 1;

  if (world.activeBubble) {
    const a = world.activeBubble;
    const cx = aslot.x;
    const restY = aslot.y;                              // final rest
    const midY = restY - game.bounds.height * 0.10;     // pause waypoint
    let bx, by, grow;
    if (a.anim < ACTIVE_ARC_FRAC) {
      // Quadratic Bézier with a control point lifted above both ends → a toss.
      const t = a.anim / ACTIVE_ARC_FRAC;
      const e = 1 - (1 - t) * (1 - t);                  // easeOut along the arc
      const u = 1 - e;
      const ctrlX = (a.fromX + cx) / 2;
      const ctrlY = Math.min(a.fromY, midY) - game.bounds.height * 0.15;
      bx = u * u * a.fromX + 2 * u * e * ctrlX + e * e * cx;
      by = u * u * a.fromY + 2 * u * e * ctrlY + e * e * midY;
      grow = 0.5 + 0.9 * e;                             // → ~1.4× by the waypoint
    } else if (a.anim < ACTIVE_PAUSE_FRAC) {
      bx = cx; by = midY; grow = 1.4;                   // slight hold, large
    } else {
      const p = (a.anim - ACTIVE_PAUSE_FRAC) / (1 - ACTIVE_PAUSE_FRAC);
      const e = p * p * (3 - 2 * p);                    // smoothstep settle
      bx = cx;
      by = midY + (restY - midY) * e;
      grow = 1.4 - 0.4 * e;                             // shrink 1.4× → 1.0×
    }
    const pulse = 1 + 0.08 * Math.sin(game.clock * 6);
    const radius = aslot.r * grow * pulse;
    const frac = world.powerups.fraction(PICKUP_TO_POWER[a.type]);
    drawPowerupBubble(ctx, bx, by, radius, a.type, true, frac);
  }
  ctx.restore();
}

/**
 * One power-up bubble: dark well + colored ring + icon, optional glow and a
 * run-timer arc (ringFrac >= 0 shows remaining duration). Assumes textAlign/
 * baseline already centered and globalAlpha set by the caller.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} radius
 * @param {import('../../types.js').PickupTypeName} type
 * @param {boolean} glow
 * @param {number} ringFrac  0..1 to draw the run-timer ring; < 0 to skip it
 */
function drawPowerupBubble(ctx, x, y, radius, type, glow, ringFrac) {
  const ring = PICKUP_RING_COLOR[type];
  // Baked halo instead of a per-frame shadowBlur pass.
  if (glow) glowCircle(ctx, x, y, radius + 2, ring);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ring;
  ctx.stroke();

  if (ringFrac >= 0) {
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + ringFrac * Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = `${Math.floor(radius * 1.05)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.fillText(PICKUP_ICONS[type], x, y + 1);
}
