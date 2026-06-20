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
    // Missed: the scoop pops away into the sand. It fades out as it sinks, while a
    // translucent outline swells slightly then collapses back down — a slow "pop"
    // that fades to nothing rather than a hard sprite swap.
    const p = Math.min(1, s.dissolve / SCOOP_DISSOLVE_S);
    ctx.save();
    ctx.globalAlpha = 1 - p;                       // scoop fades out
    drawFallingScoop(ctx, s.x, y, SCOOP_RADIUS, rainbow ? 'rainbow' : s.color);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.4 * Math.sin(p * Math.PI); // outline fades in then out, max 0.4
    // Pop: a slight overshoot early, then tween down to a small collapse.
    const PEAK = 0.25;
    const grow = p < PEAK
      ? 1 + 0.2 * (p / PEAK)                        // swell slightly up
      : 1.2 - 1.0 * ((p - PEAK) / (1 - PEAK));      // collapse down
    ctx.translate(s.x, y);
    ctx.scale(grow, grow);
    ctx.translate(-s.x, -y);
    drawDissolveSprite(ctx, s.x, y, SCOOP_RADIUS);
    ctx.restore();
  }
}
