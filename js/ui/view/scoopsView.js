// @ts-check
import { SCOOP_RADIUS, SCOOP_DISSOLVE_S } from '../../game/config.js';
import { drawFallingScoop, drawDissolveSprite } from '../sprites/scoopRenderer.js';

/** @typedef {import('../../game/scoops.js').ScoopField} ScoopField */

/**
 * Draw the falling-scoop field. Live scoops draw plain; a missed scoop cross-
 * fades into the sand — the scoop fades out while a translucent outline fades in
 * over it and flattens down. Reads the field; never mutates it.
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
    // Missed: cross-fade into the sand. The scoop fades out as it sinks, while a
    // translucent outline fades IN over it and flattens down — a soft imprint
    // pressed into the sand rather than a hard sprite swap.
    const p = Math.min(1, s.dissolve / SCOOP_DISSOLVE_S);
    ctx.save();
    ctx.globalAlpha = 1 - p;                       // scoop fades out
    drawFallingScoop(ctx, s.x, y, SCOOP_RADIUS, rainbow ? 'rainbow' : s.color);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.55 * p;                    // outline fades in, kept translucent
    const flatten = 1 - 0.7 * p;                   // squash vertically into the sand
    const baseY = y + SCOOP_RADIUS;                // press down from the scoop's base
    ctx.translate(s.x, baseY);
    ctx.scale(1, flatten);
    ctx.translate(-s.x, -baseY);
    drawDissolveSprite(ctx, s.x, y, SCOOP_RADIUS);
    ctx.restore();
  }
}
