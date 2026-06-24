// @ts-check
// The night-cycle star field: a fixed (baked) set of stars + the pass that paints
// them above the horizon during the between-wave night cycle. Pulled out of the
// scene so the 60-entry table doesn't bury the sky/ocean/cloud passes.
import { LAYOUT } from '../../game/config.js';

// Fixed star field — x/y are fractions of the sky, r the dot radius, tw a
// static per-star brightness. BAKED (no load-time randomness, identical every
// run); regenerate/reshuffle with seed/gen-stars.mjs.
const STARS = [
  { x: 0.6231, y: 0.5162, r: 1.1, tw: 0.93 },
  { x: 0.9285, y: 0.4422, r: 1.46, tw: 0.72 },
  { x: 0.9242, y: 0.1232, r: 1.31, tw: 0.72 },
  { x: 0.726, y: 0.5747, r: 1.25, tw: 0.64 },
  { x: 0.2806, y: 0.4192, r: 0.51, tw: 0.84 },
  { x: 0.7652, y: 0.1201, r: 1.2, tw: 0.95 },
  { x: 0.7217, y: 0.4468, r: 0.86, tw: 0.63 },
  { x: 0.9057, y: 0.1398, r: 1.71, tw: 0.77 },
  { x: 0.4179, y: 0.2976, r: 1.72, tw: 0.83 },
  { x: 0.2077, y: 0.4051, r: 0.61, tw: 0.79 },
  { x: 0.255, y: 0.4217, r: 1.32, tw: 0.76 },
  { x: 0.2999, y: 0.2165, r: 0.63, tw: 0.89 },
  { x: 0.1544, y: 0.1533, r: 1.01, tw: 0.93 },
  { x: 0.1721, y: 0.5207, r: 0.95, tw: 0.75 },
  { x: 0.409, y: 0.3392, r: 1.74, tw: 0.88 },
  { x: 0.3253, y: 0.1696, r: 0.53, tw: 0.77 },
  { x: 0.5905, y: 0.4704, r: 1.42, tw: 0.81 },
  { x: 0.9971, y: 0.4547, r: 1.17, tw: 0.6 },
  { x: 0.9132, y: 0.5826, r: 1.42, tw: 0.9 },
  { x: 0.0183, y: 0.0565, r: 1.11, tw: 0.75 },
  { x: 0.427, y: 0.1347, r: 1.23, tw: 0.96 },
  { x: 0.5269, y: 0.049, r: 0.88, tw: 0.85 },
  { x: 0.4165, y: 0.0831, r: 1.45, tw: 0.86 },
  { x: 0.1575, y: 0.0487, r: 1.58, tw: 0.63 },
  { x: 0.9074, y: 0.1137, r: 1.13, tw: 0.81 },
  { x: 0.0316, y: 0.4369, r: 0.49, tw: 0.85 },
  { x: 0.4062, y: 0.1968, r: 1.39, tw: 0.97 },
  { x: 0.7342, y: 0.3878, r: 0.53, tw: 0.6 },
  { x: 0.1713, y: 0.1571, r: 0.6, tw: 0.81 },
  { x: 0.1568, y: 0.273, r: 0.43, tw: 0.57 },
  { x: 0.6409, y: 0.3262, r: 1.58, tw: 0.91 },
  { x: 0.8519, y: 0.4013, r: 1.09, tw: 0.87 },
  { x: 0.9491, y: 0.4559, r: 0.61, tw: 0.64 },
  { x: 0.3808, y: 0.2235, r: 1.75, tw: 0.66 },
  { x: 0.4906, y: 0.0734, r: 0.96, tw: 0.64 },
  { x: 0.9804, y: 0.5758, r: 0.73, tw: 0.74 },
  { x: 0.2502, y: 0.2924, r: 1.12, tw: 0.85 },
  { x: 0.6726, y: 0.3965, r: 1.37, tw: 0.61 },
  { x: 0.2372, y: 0.5793, r: 1.56, tw: 0.71 },
  { x: 0.9788, y: 0.3221, r: 0.71, tw: 0.7 },
  { x: 0.4519, y: 0.4173, r: 0.95, tw: 0.79 },
  { x: 0.9675, y: 0.1482, r: 0.43, tw: 0.69 },
  { x: 0.4242, y: 0.351, r: 1.23, tw: 0.57 },
  { x: 0.4236, y: 0.1785, r: 0.84, tw: 0.73 },
  { x: 0.9221, y: 0.3912, r: 1.6, tw: 0.85 },
  { x: 0.8984, y: 0.2708, r: 0.9, tw: 0.72 },
  { x: 0.4041, y: 0.3604, r: 1.44, tw: 0.7 },
  { x: 0.2338, y: 0.2042, r: 1.45, tw: 0.81 },
  { x: 0.5935, y: 0.3403, r: 1.26, tw: 0.89 },
  { x: 0.6384, y: 0.6089, r: 0.85, tw: 0.77 },
  { x: 0.4874, y: 0.2019, r: 0.51, tw: 0.92 },
  { x: 0.7272, y: 0.5483, r: 1.55, tw: 0.82 },
  { x: 0.7502, y: 0.6147, r: 1.55, tw: 1 },
  { x: 0.6601, y: 0.0289, r: 1.56, tw: 0.65 },
  { x: 0.021, y: 0.3012, r: 1.1, tw: 0.82 },
  { x: 0.3222, y: 0.3748, r: 0.73, tw: 0.94 },
  { x: 0.6065, y: 0.4686, r: 0.74, tw: 0.97 },
  { x: 0.8684, y: 0.3946, r: 0.51, tw: 0.55 },
  { x: 0.1933, y: 0.386, r: 0.54, tw: 0.59 },
  { x: 0.9567, y: 0.2324, r: 0.49, tw: 0.84 }
];

/**
 * Paint the star field above the horizon. Each star's opacity is the night
 * cycle's starAlpha × its baked twinkle, so the whole field fades in at the
 * midpoint of the sweep and out toward dawn. No-op when starAlpha is ~0.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ width: number, height: number }} bounds
 * @param {{ starAlpha: number }} state
 */
export function drawStars(ctx, bounds, state) {
  if (state.starAlpha <= 0.01) return;
  const groundY = LAYOUT.GROUND_Y;
  ctx.save();
  ctx.fillStyle = '#fff';
  for (const s of STARS) {
    ctx.globalAlpha = Math.max(0, Math.min(1, state.starAlpha * s.tw));
    ctx.beginPath();
    ctx.arc(s.x * bounds.width, s.y * groundY, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
