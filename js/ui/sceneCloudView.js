// @ts-check
// Cartoon clouds drifting across the sky, styled to match the ocean: flat-toned
// puffs with a lighter sun-lit crown (the cloud's answer to the sea's flat aqua +
// lighter crest lines), tinted by the time-of-day `state`. Depth comes from
// PARALLAX: three layers scroll at different speeds — far clouds are small, slow,
// faint, and high; near clouds are big, fast, opaque, and lower — so the sky has
// a sense of distance as the wind pushes everything left.
//
// PERFORMANCE: each cloud is pre-rendered once to its own offscreen canvas and
// the per-frame pass just blits it (drawImage), instead of re-tessellating ~5
// circles per puff every frame. The sprites are keyed by the tint and rebuilt
// only when the day state changes — i.e. on serves during play (the night-cycle
// sweep changes the tint continuously over ~2s between waves, so it rebakes each
// frame there, but that's not gameplay). Shape + scale are fixed per cloud (the
// base radius derives from the constant GROUND_Y), so a cloud's bitmap depends
// only on the tint.
import { GROUND_Y } from '../game/config.js';
import { mixHex, scaleHex, luminance } from './colorUtils.js';

// Per-layer depth feel (far → near): scroll speed (px/s), size, opacity.
const CLOUD_LAYERS = [
  { speed: 5,  scale: 0.55, alpha: 0.45 },  // far
  { speed: 11, scale: 0.85, alpha: 0.65 },  // mid
  { speed: 20, scale: 1.15, alpha: 0.90 }   // near
];

// Puff silhouettes — clusters of overlapping circles in units of the base puff
// radius (dx/dy offsets from the cloud anchor, r the circle radius). Drawn as one
// path + one fill, so the union of the circles reads as a single lumpy cloud.
const CLOUD_SHAPES = [
  [
    { dx: -1.7, dy:  0.15, r: 0.85 },
    { dx: -0.7, dy: -0.35, r: 1.15 },
    { dx:  0.5, dy: -0.50, r: 1.25 },
    { dx:  1.6, dy: -0.10, r: 0.95 },
    { dx:  0.4, dy:  0.20, r: 1.00 }
  ],
  [
    { dx: -1.3, dy:  0.10, r: 0.80 },
    { dx: -0.3, dy: -0.40, r: 1.10 },
    { dx:  0.9, dy: -0.20, r: 1.00 },
    { dx:  0.0, dy:  0.20, r: 0.95 }
  ],
  [
    { dx: -2.0, dy:  0.10, r: 0.70 },
    { dx: -1.0, dy: -0.30, r: 1.00 },
    { dx:  0.0, dy: -0.55, r: 1.20 },
    { dx:  1.0, dy: -0.25, r: 1.05 },
    { dx:  2.0, dy:  0.10, r: 0.75 },
    { dx:  0.0, dy:  0.25, r: 1.10 }
  ]
];
// Half-width of each silhouette (max |dx| + r), in base-radius units — used to
// size the off-screen wrap margin so a cloud fully exits before re-entering.
const CLOUD_SHAPE_HALFW = CLOUD_SHAPES.map(s => Math.max(...s.map(p => Math.abs(p.dx) + p.r)));

// Baked cloud field — x is a base fraction of the wrap span, y a fraction of the
// sky (0..groundY), w a per-cloud width jitter, shape an index into CLOUD_SHAPES.
// Fixed (no load-time randomness) so the sky reads identically every run.
const CLOUDS = [
  { layer: 0, x: 0.08, y: 0.12, w: 1.00, shape: 1 },
  { layer: 0, x: 0.45, y: 0.18, w: 1.20, shape: 2 },
  { layer: 0, x: 0.78, y: 0.10, w: 0.90, shape: 0 },
  { layer: 1, x: 0.20, y: 0.26, w: 1.10, shape: 0 },
  { layer: 1, x: 0.55, y: 0.31, w: 0.95, shape: 1 },
  { layer: 1, x: 0.88, y: 0.22, w: 1.25, shape: 2 },
  { layer: 1, x: 0.02, y: 0.34, w: 0.85, shape: 1 },
  { layer: 2, x: 0.15, y: 0.16, w: 1.20, shape: 2 },
  { layer: 2, x: 0.50, y: 0.12, w: 1.00, shape: 0 },
  { layer: 2, x: 0.82, y: 0.30, w: 1.30, shape: 1 },
  { layer: 2, x: 0.35, y: 0.37, w: 0.90, shape: 0 }
];

// Base puff radius scales with the play area; constant since GROUND_Y is fixed.
const BASE_R = GROUND_Y * 0.05;
const SPRITE_PAD = 2;  // transparent margin so anti-aliased edges never clip

/**
 * Precomputed per-cloud sprite geometry (constant: derived from shape + scale,
 * neither of which changes at runtime). `scale` is the puff radius in px; `w`/`h`
 * the bitmap size; `ax`/`ay` the cloud anchor's offset inside the bitmap (so the
 * blit lands the anchor at the on-screen position); `alpha` the layer opacity.
 * @typedef {{ scale: number, shape: Array<{dx:number,dy:number,r:number}>, w: number, h: number, ax: number, ay: number, alpha: number }} CloudGeom
 * @type {CloudGeom[]}
 */
const CLOUD_GEOM = CLOUDS.map(c => {
  const L = CLOUD_LAYERS[c.layer];
  const scale = BASE_R * L.scale * c.w;
  const shape = CLOUD_SHAPES[c.shape];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of shape) {
    // Body circle, then the crown circle (smaller, nudged up) — see drawCloudPuff.
    const cr = p.r * 0.74, cdy = p.dy - 0.28;
    minX = Math.min(minX, (p.dx - p.r) * scale, (p.dx - cr) * scale);
    maxX = Math.max(maxX, (p.dx + p.r) * scale, (p.dx + cr) * scale);
    minY = Math.min(minY, (p.dy - p.r) * scale, (cdy - cr) * scale);
    maxY = Math.max(maxY, (p.dy + p.r) * scale, (cdy + cr) * scale);
  }
  return {
    scale, shape,
    w: Math.ceil(maxX - minX) + SPRITE_PAD * 2,
    h: Math.ceil(maxY - minY) + SPRITE_PAD * 2,
    ax: -minX + SPRITE_PAD,
    ay: -minY + SPRITE_PAD,
    alpha: L.alpha
  };
});

/** @typedef {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }} CloudSprite */
/** @type {CloudSprite[] | null} */
let _cloudSprites = null;
let _cloudSpriteKey = '';

/**
 * Lazily build (and tint-rebake when stale) the per-cloud offscreen bitmaps, and
 * return them. The canvases are created once at their fixed sizes and reused; a
 * tint change just clears + redraws each. Alpha is baked IN (body and crown drawn
 * at the layer opacity into a transparent canvas), so the per-frame blit at
 * globalAlpha=1 reproduces the original layered compositing exactly.
 * @param {string} tintKey
 * @param {{ skyTop: string, skyBottom: string }} state
 * @returns {CloudSprite[]}
 */
function ensureCloudSprites(tintKey, state) {
  let sprites = _cloudSprites;
  if (!sprites) {
    sprites = CLOUD_GEOM.map(g => {
      const canvas = document.createElement('canvas');
      canvas.width = g.w;
      canvas.height = g.h;
      return { canvas, ctx: /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')) };
    });
    _cloudSprites = sprites;
  }
  if (_cloudSpriteKey === tintKey) return sprites;
  _cloudSpriteKey = tintKey;

  // Time-of-day tint — same math as the ocean: clouds read as white warmed
  // toward the horizon color, dimmed and faded at night (low sky luminance).
  const day = Math.max(0.30, Math.min(1, luminance(state.skyTop) * 1.4));
  const body = scaleHex(mixHex('#ffffff', state.skyBottom, 0.18), 0.62 + 0.38 * day);  // shaded base
  const top  = scaleHex(mixHex('#ffffff', state.skyBottom, 0.05), 0.80 + 0.20 * day);  // sun-lit crown
  const opacity = 0.55 + 0.45 * day;

  for (let i = 0; i < CLOUD_GEOM.length; i++) {
    const g = CLOUD_GEOM[i];
    const sp = sprites[i];
    sp.ctx.clearRect(0, 0, g.w, g.h);
    drawCloudPuff(sp.ctx, g.ax, g.ay, g.scale, body, top, g.alpha * opacity, g.shape);
  }
  return sprites;
}

/**
 * Parallaxing cloud pass. Drawn AFTER the sky/sun (so puffs can drift in front of
 * the sun) and BEFORE the sand. Each layer scrolls at its own speed for depth;
 * within a layer every cloud wraps independently across `width + 2·margin`, so a
 * cloud slides off one edge and reappears on the other with no pop. The puffs are
 * cached bitmaps (see ensureCloudSprites) tinted by the time-of-day `state`, so
 * they glow warm at dawn/sunset and dim to a cool grey at night — same as the
 * ocean — while the per-frame cost is just a blit per cloud.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ width: number, height: number }} bounds
 * @param {{ skyTop: string, skyBottom: string }} state
 * @param {number} time  free-running seconds, drives the drift
 */
export function drawClouds(ctx, bounds, state, time) {
  const W = bounds.width;
  const groundY = GROUND_Y;
  const sprites = ensureCloudSprites(state.skyTop + '|' + state.skyBottom, state);

  ctx.save();
  ctx.globalAlpha = 1;  // alpha is baked into each sprite
  for (let i = 0; i < CLOUDS.length; i++) {
    const c = CLOUDS[i], g = CLOUD_GEOM[i];
    const margin = CLOUD_SHAPE_HALFW[c.shape] * g.scale;
    const wrapSpan = W + margin * 2;
    // Parallax scroll: subtract so the wind pushes left; wrap into [-margin, W+margin].
    let cx = (c.x * wrapSpan - time * CLOUD_LAYERS[c.layer].speed) % wrapSpan;
    if (cx < 0) cx += wrapSpan;
    cx -= margin;
    ctx.drawImage(sprites[i].canvas, cx - g.ax, c.y * groundY - g.ay);
  }
  ctx.restore();
}

/**
 * One cartoon cloud: the lumpy shaded body, then a smaller, nudged-up copy in the
 * lighter crown color so the top reads as sun-lit and the underside as shadow —
 * two flat tones standing in for a gradient, the same trick the ocean uses. Used
 * to bake each cloud's sprite (drawn at (cx, cy) = the anchor inside the bitmap).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx @param {number} cy @param {number} scale
 * @param {string} body @param {string} top @param {number} alpha
 * @param {Array<{dx:number,dy:number,r:number}>} shape
 */
function drawCloudPuff(ctx, cx, cy, scale, body, top, alpha, shape) {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.fillStyle = body;
  ctx.beginPath();
  for (const p of shape) {
    const x = cx + p.dx * scale, y = cy + p.dy * scale, r = p.r * scale;
    ctx.moveTo(x + r, y);                 // moveTo before each arc → no joining lines
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.fillStyle = top;
  ctx.beginPath();
  for (const p of shape) {
    const x = cx + p.dx * scale, y = cy + (p.dy - 0.28) * scale, r = p.r * 0.74 * scale;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}
