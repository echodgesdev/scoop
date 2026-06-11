// @ts-check
// Baked glow / soft-shadow sprites. ctx.shadowBlur re-runs a Gaussian blur into
// a temporary buffer on EVERY fill/stroke — the slowest common path in mobile
// Canvas2D — and the scene was paying for a dozen of those per frame (customer
// bubble glows, tip badges, the active power-up ring, the cone flash). These
// helpers bake each glow ONCE into a small offscreen canvas (cached by color /
// size) and blit it, turning a per-frame blur pass into a cheap drawImage.
//
// The halo shapes are radial-gradient approximations of a Gaussian shadow —
// indistinguishable in motion at game scale. Cache stays tiny: keys are the
// handful of accent colors plus the couple of discrete speech-bubble sizes.

/** @type {Map<string, HTMLCanvasElement>} */
const cache = new Map();

// Baked circular halo: an alpha falloff mask tinted via source-in, so any CSS
// color string works. Baked once at a fixed core radius; draws scale it.
const CORE_R = 32;        // baked core radius, px
const HALO_RATIO = 2.1;   // halo extends to HALO_RATIO × the core radius

/** @param {string} color @returns {HTMLCanvasElement} */
function circleHalo(color) {
  let c = cache.get('c:' + color);
  if (c) return c;
  const size = Math.ceil(CORE_R * HALO_RATIO * 2);
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const half = size / 2;
  const grad = g.createRadialGradient(half, half, CORE_R * 0.55, half, half, CORE_R * HALO_RATIO);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Tint the alpha mask with the requested color (its own alpha multiplies in).
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  cache.set('c:' + color, c);
  return c;
}

/**
 * Soft halo behind a circle of radius r at (x, y) — the baked stand-in for
 * `shadowColor = color; shadowBlur ≈ r/2` around a circular shape. Draw it
 * FIRST, then the crisp shape plain on top.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r core radius (the shape's)
 * @param {string} color any CSS color
 * @param {number} [alpha] extra opacity multiplier
 */
export function glowCircle(ctx, x, y, r, color, alpha = 1) {
  const sprite = circleHalo(color);
  const d = r * HALO_RATIO * 2;
  if (alpha !== 1) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite, x - d / 2, y - d / 2, d, d);
    ctx.restore();
  } else {
    ctx.drawImage(sprite, x - d / 2, y - d / 2, d, d);
  }
}

/**
 * Soft halo behind a rounded rect — baked with a one-time real shadowBlur pass
 * (so it matches the old look exactly), cached by size + color. Speech bubbles
 * come in a couple of discrete widths, so the cache stays a handful of entries.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y top-left of the rect
 * @param {number} w @param {number} h
 * @param {number} radius corner radius
 * @param {string} color glow color
 * @param {number} blur the shadowBlur this halo stands in for
 */
export function glowRoundRect(ctx, x, y, w, h, radius, color, blur) {
  const key = `r:${color}|${Math.round(w)}x${Math.round(h)}|${radius}|${blur}`;
  let c = cache.get(key);
  if (!c) {
    const pad = Math.ceil(blur * 2);
    c = document.createElement('canvas');
    c.width = Math.ceil(w) + pad * 2;
    c.height = Math.ceil(h) + pad * 2;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    // Draw the shape far off-canvas with the shadow offset back in, so only the
    // blurred halo lands on the canvas. Fill twice: the old code stacked the
    // shadow across a fill + stroke, which reads as a fuller glow.
    const OFF = 4096;
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.shadowOffsetX = OFF;
    g.fillStyle = '#000';
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.roundRect(pad - OFF, pad, w, h, radius);
      g.fill();
    }
    cache.set(key, c);
  }
  const pad = (c.width - Math.ceil(w)) / 2;
  ctx.drawImage(c, x - pad, y - pad);
}
