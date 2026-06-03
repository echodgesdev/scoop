// @ts-check
import { SCOOP_RADIUS, SCOOP_DISSOLVE_S } from '../game/config.js';
import { drawScoop } from './playerView.js';

/** @typedef {import('../game/scoops.js').ScoopField} ScoopField */

/**
 * Draw the falling-scoop field. Live scoops draw plain; missed ones fade + shrink
 * with an expanding white poof ring so the miss reads as fizzling into the sand.
 * Reads the field; never mutates it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ScoopField} field
 * @param {boolean} [rainbow] repaint every scoop as rainbow (purely visual)
 */
export function drawField(ctx, field, rainbow = false) {
  for (const s of field.scoops) {
    if (s.dissolve === undefined) {
      drawScoop(ctx, s.x, s.y, rainbow ? 'rainbow' : s.color);
      continue;
    }
    const p = Math.min(1, s.dissolve / SCOOP_DISSOLVE_S);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    drawScoop(ctx, s.x, s.y, rainbow ? 'rainbow' : s.color, 1 - 0.4 * p);
    ctx.globalAlpha = (1 - p) * 0.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, SCOOP_RADIUS * (1 + 0.7 * p), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
