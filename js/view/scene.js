// @ts-check
import { GROUND_Y } from '../game/config.js';

// === Per-frame caches =========================================================
// The day-cycle state only changes on serves (wave progress is discrete), so
// the same gradients were being rebuilt — and the same hex-string math re-run —
// on every rendered frame. Each cache is keyed by the values it bakes in and
// rebuilds only when they change. (Night-cycle states change continuously, but
// that sweep runs ~2s between waves; the caches just miss harmlessly there.)

/** @type {{ key: string, grad: CanvasGradient | null }} */
let _skyCache = { key: '', grad: null };
function skyGradient(ctx, groundY, top, bottom) {
  const key = groundY + '|' + top + '|' + bottom;
  if (_skyCache.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    _skyCache = { key, grad: g };
  }
  return /** @type {CanvasGradient} */ (_skyCache.grad);
}

/** @type {{ key: string, grad: CanvasGradient | null }} */
let _haloCache = { key: '', grad: null };

/**
 * Sky + sun pass. Drawn FIRST in the frame so everything else paints on top.
 * Sky gradient ends its bottom-anchor color at the horizon so dawn/sunset
 * colors actually read at the sand line. Sun is drawn before sand so it
 * rises from behind / sets into the floor.
 */
export function drawSkyAndSun(ctx, bounds, state) {
  const groundY = GROUND_Y;

  ctx.fillStyle = skyGradient(ctx, groundY, state.skyTop, state.skyBottom);
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  // Sun halo — radial gradient fading out. Cached: position/color only change
  // on serves.
  const haloR = state.sunR * 3;
  const haloKey = state.sunColor + '|' + state.sunGlow + '|' + state.sunX + '|' + state.sunY + '|' + state.sunR;
  if (_haloCache.key !== haloKey) {
    const halo = ctx.createRadialGradient(
      state.sunX, state.sunY, state.sunR * 0.5,
      state.sunX, state.sunY, haloR
    );
    halo.addColorStop(0, hexWithAlpha(state.sunColor, 0.55 * state.sunGlow));
    halo.addColorStop(1, hexWithAlpha(state.sunColor, 0));
    _haloCache = { key: haloKey, grad: halo };
  }
  ctx.fillStyle = /** @type {CanvasGradient} */ (_haloCache.grad);
  ctx.beginPath();
  ctx.arc(state.sunX, state.sunY, haloR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = state.sunColor;
  ctx.beginPath();
  ctx.arc(state.sunX, state.sunY, state.sunR, 0, Math.PI * 2);
  ctx.fill();
}

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
 * Night-cycle sky for the between-wave reset: gradient + star field + a glowing
 * crescent moon (drawn before sand so the moon can sit low behind the horizon).
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawNightSky(ctx, bounds, state) {
  const groundY = GROUND_Y;

  ctx.fillStyle = skyGradient(ctx, groundY, state.skyTop, state.skyBottom);
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  // Stars (above the horizon only).
  if (state.starAlpha > 0.01) {
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

  // Moon glow.
  const mr = state.moonR;
  const halo = ctx.createRadialGradient(state.moonX, state.moonY, mr * 0.4, state.moonX, state.moonY, mr * 2.6);
  halo.addColorStop(0, 'rgba(220, 226, 255, 0.40)');
  halo.addColorStop(1, 'rgba(220, 226, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(state.moonX, state.moonY, mr * 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Crescent: pale disc, then carve it with a sky-colored disc offset up-right.
  ctx.fillStyle = '#eef0dc';
  ctx.beginPath();
  ctx.arc(state.moonX, state.moonY, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = state.skyTop;
  ctx.beginPath();
  ctx.arc(state.moonX + mr * 0.55, state.moonY - mr * 0.32, mr * 0.92, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Sand floor pass. Drawn AFTER the cone, customers, and mini-cones so the
 * sand covers the embedded bottoms — actors look like they're standing in
 * the floor rather than over it.
 */
export function drawSand(ctx, bounds, state) {
  const groundY = GROUND_Y;
  ctx.fillStyle = state.floor;
  ctx.fillRect(0, groundY, bounds.width, bounds.height - groundY);
}

function hexWithAlpha(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}

// --- tiny color helpers for the ocean tint ---------------------------------
function _rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}
function _hex(c) {
  const p = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + p(c.r) + p(c.g) + p(c.b);
}
/** Blend hex a→b by t (0..1). */
function mixHex(a, b, t) {
  const A = _rgb(a), B = _rgb(b);
  return _hex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
/** Multiply a hex color's brightness by f. */
function scaleHex(hex, f) {
  const c = _rgb(hex);
  return _hex({ r: c.r * f, g: c.g * f, b: c.b * f });
}
/** Perceptual-ish luminance 0..1. */
function luminance(hex) {
  const c = _rgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

// Ocean tint palette + water-body gradient caches (see the cache note up top).
let _oceanTint = { key: '', shallow: '', deep: '', crest: '', foam: '', wet: '' };
/** @type {{ key: string, grad: CanvasGradient | null }} */
let _waterCache = { key: '', grad: null };

/**
 * Cartoony ocean surf along the bottom of the beach. Painted AFTER the sand so
 * it covers the lower part of the sand band (which sits below the customers),
 * completing the beach: a flat-toned aqua sea, a couple of lighter wave-crest
 * lines, and a bumpy white foam line at the waterline with scattered foam
 * bubbles. The tide rolls in and out, and *how far* it rolls in varies wave to
 * wave (layered incommensurate sines, so consecutive in-rolls reach different
 * heights). Colors are tinted by the time-of-day `state` (skyTop drives the
 * day/night brightness; skyBottom reflects into the water) so it reads the same
 * in the day cycle and the between-wave night cycle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ width: number, height: number }} bounds
 * @param {{ skyTop: string, skyBottom: string, floor: string }} state
 * @param {number} time  free-running seconds, drives the animation
 */
export function drawOcean(ctx, bounds, state, time) {
  const W = bounds.width;
  const groundY = GROUND_Y;
  const band = bounds.height - groundY;           // sand-band height
  if (band <= 4) return;

  // Waterline lives in the LOWER part of the sand band (below the customers).
  const restY = groundY + band * 0.66;            // tide-out (low)
  const tideTravel = band * 0.15;                  // how far the tide can climb
  // Tide envelope 0..1 — three incommensurate sines so each roll-in peaks at a
  // slightly different height ("slight variances in how far the tide rolls in").
  const s = Math.sin(time * 0.45) * 0.6
          + Math.sin(time * 0.23 + 1.3) * 0.3
          + Math.sin(time * 0.11 + 2.1) * 0.1;
  const tideEnv = 0.5 + 0.5 * Math.max(-1, Math.min(1, s));
  const tideY = restY - tideTravel * tideEnv;

  // Time-of-day tint — cached: the hex parsing/serializing only re-runs when
  // the day state actually changes (on serves), not per frame.
  const tintKey = state.skyTop + '|' + state.skyBottom + '|' + state.floor;
  if (_oceanTint.key !== tintKey) {
    const day = Math.max(0.22, Math.min(1, luminance(state.skyTop) * 1.4));
    _oceanTint = {
      key: tintKey,
      shallow: scaleHex(mixHex('#6fd6e0', state.skyBottom, 0.10), 0.6 + 0.4 * day),
      deep:    scaleHex(mixHex('#1f7fa6', state.skyBottom, 0.18), day),
      crest:   scaleHex('#bdeef5', 0.5 + 0.5 * day),
      foam:    scaleHex('#ffffff', 0.72 + 0.28 * day),
      wet:     hexWithAlpha(scaleHex(state.floor, 0.7), 0.5)
    };
  }
  const { shallow, deep, crest, foam } = _oceanTint;

  const step = Math.max(8, W / 64);
  // Wavy waterline: a long gentle swell + a faster shorter ripple, scrolling.
  const edgeY = x => tideY
    + Math.sin(x * 0.012 + time * 1.6) * band * 0.013
    + Math.sin(x * 0.030 - time * 1.1) * band * 0.006;

  ctx.save();

  // Wet-sand sheen just above the surf (where the tide recently was).
  ctx.fillStyle = _oceanTint.wet;
  ctx.beginPath();
  ctx.moveTo(0, edgeY(0));
  for (let x = 0; x <= W; x += step) ctx.lineTo(x, edgeY(x));
  for (let x = W; x >= 0; x -= step) ctx.lineTo(x, edgeY(x) - band * 0.05);
  ctx.closePath();
  ctx.fill();

  // 1. Water body — vertical gradient (shallow at the surf → deep at the bottom).
  ctx.beginPath();
  ctx.moveTo(0, bounds.height);
  ctx.lineTo(0, edgeY(0));
  for (let x = 0; x <= W; x += step) ctx.lineTo(x, edgeY(x));
  ctx.lineTo(W, bounds.height);
  ctx.closePath();
  // The gradient's top anchor rides the tide; quantize it to 2px steps so the
  // gradient object is reused across frames instead of rebuilt 60×/s (the tide
  // covers a fixed ~50px range, so the cache cycles through a handful of keys).
  const tideYq = Math.round(tideY / 2) * 2;
  const waterKey = _oceanTint.key + '|' + tideYq + '|' + bounds.height;
  if (_waterCache.key !== waterKey) {
    const grad = ctx.createLinearGradient(0, tideYq, 0, bounds.height);
    grad.addColorStop(0, shallow);
    grad.addColorStop(0.55, mixHex(shallow, deep, 0.65));
    grad.addColorStop(1, deep);
    _waterCache = { key: waterKey, grad };
  }
  ctx.fillStyle = /** @type {CanvasGradient} */ (_waterCache.grad);
  ctx.fill();

  // 2. A couple of cartoony lighter crest lines drifting across the water.
  ctx.strokeStyle = crest;
  ctx.lineWidth = Math.max(2, band * 0.009);
  ctx.lineCap = 'round';
  for (let k = 1; k <= 2; k++) {
    ctx.globalAlpha = 0.45 - k * 0.08;
    ctx.beginPath();
    for (let x = 0; x <= W; x += step) {
      const yy = edgeY(x) + k * band * 0.075 + Math.sin(x * 0.02 + time * 1.3 + k) * band * 0.008;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 3. Bumpy cartoon foam band hugging the waterline.
  ctx.fillStyle = foam;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(0, edgeY(0) + band * 0.006);
  for (let x = 0; x <= W; x += step) ctx.lineTo(x, edgeY(x) + band * 0.006);
  for (let x = W; x >= 0; x -= step) {
    const scallop = Math.abs(Math.sin(x * 0.05 + time * 2.2)) * band * 0.022;
    ctx.lineTo(x, edgeY(x) - band * 0.012 - scallop);
  }
  ctx.closePath();
  ctx.fill();

  // 4. Foam bubbles — scattered blobs riding the surf, twinkling in/out.
  const bubbleStep = Math.max(24, W / 24);
  for (let x = 0; x <= W; x += bubbleStep) {
    const ph = x * 0.7;
    const by = edgeY(x) - band * 0.004 + Math.sin(time * 2 + ph) * band * 0.006;
    const br = Math.max(1.5, (1.5 + Math.sin(time * 1.7 + ph * 1.3) * 0.9) * band * 0.013);
    ctx.globalAlpha = Math.max(0.12, 0.55 + 0.4 * Math.sin(time * 2.4 + ph));
    ctx.beginPath();
    ctx.arc(x + Math.sin(time * 0.9 + ph) * 6, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
