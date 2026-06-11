// @ts-check
import { SCOOP_RADIUS, SCOOP_DISSOLVE_S } from '../game/config.js';
import { drawScoop } from './playerView.js';
import { SCOOP_STATE, drawFallingScoop } from './sprites.js';

/** @typedef {import('../game/scoops.js').ScoopField} ScoopField */

/**
 * Draw the falling-scoop field. Live scoops draw plain; missed ones fade + shrink
 * with an expanding white poof ring so the miss reads as fizzling into the sand.
 * Reads the field; never mutates it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ScoopField} field
 * @param {boolean} [rainbow] repaint every scoop as rainbow (purely visual)
 * @param {number} [alpha] render-interpolation fraction (prevY→y)
 */
export function drawField(ctx, field, rainbow = false, alpha = 1) {
  for (const s of field.scoops) {
    // Interpolate between the last two sim steps so the fall is smooth at any
    // display refresh rate (the sim is fixed at 60Hz).
    const y = s.prevY + (s.y - s.prevY) * alpha;
    if (s.dissolve === undefined) {
      // Live scoop: the look (and any speed-flair) follows its fall speed.
      drawFallingScoop(ctx, s.x, y, SCOOP_RADIUS, rainbow ? 'rainbow' : s.color, s.speedMult);
      continue;
    }
    const p = Math.min(1, s.dissolve / SCOOP_DISSOLVE_S);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    drawScoop(ctx, s.x, y, rainbow ? 'rainbow' : s.color, 1 - 0.4 * p, SCOOP_STATE.DEFAULT);
    ctx.globalAlpha = (1 - p) * 0.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, y, SCOOP_RADIUS * (1 + 0.7 * p), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
