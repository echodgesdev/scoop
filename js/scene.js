// @ts-check
import { groundYFor } from './config.js';

/**
 * Sky + sun pass. Drawn FIRST in the frame so everything else paints on top.
 * Sky gradient ends its bottom-anchor color at the horizon so dawn/sunset
 * colors actually read at the sand line. Sun is drawn before sand so it
 * rises from behind / sets into the floor.
 */
export function drawSkyAndSun(ctx, bounds, state) {
  const groundY = groundYFor(bounds.height);

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, state.skyTop);
  sky.addColorStop(1, state.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  // Sun halo — radial gradient fading out.
  const haloR = state.sunR * 3;
  const halo = ctx.createRadialGradient(
    state.sunX, state.sunY, state.sunR * 0.5,
    state.sunX, state.sunY, haloR
  );
  halo.addColorStop(0, hexWithAlpha(state.sunColor, 0.55 * state.sunGlow));
  halo.addColorStop(1, hexWithAlpha(state.sunColor, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(state.sunX, state.sunY, haloR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = state.sunColor;
  ctx.beginPath();
  ctx.arc(state.sunX, state.sunY, state.sunR, 0, Math.PI * 2);
  ctx.fill();
}

// Fixed star field (positions are fractions of the sky; generated once so they
// don't twinkle/jump between frames). `tw` gives each star a static brightness.
const STARS = Array.from({ length: 60 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.62,
  r: Math.random() * 1.4 + 0.4,
  tw: 0.55 + Math.random() * 0.45
}));

/**
 * Night-cycle sky for the between-wave reset: gradient + star field + a glowing
 * crescent moon (drawn before sand so the moon can sit low behind the horizon).
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawNightSky(ctx, bounds, state) {
  const groundY = groundYFor(bounds.height);

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, state.skyTop);
  sky.addColorStop(1, state.skyBottom);
  ctx.fillStyle = sky;
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
  const groundY = groundYFor(bounds.height);
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
  const groundY = groundYFor(bounds.height);
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

  // Time-of-day tint. day≈1 at noon/dawn, ≈0.22 at midnight.
  const day = Math.max(0.22, Math.min(1, luminance(state.skyTop) * 1.4));
  const shallow = scaleHex(mixHex('#6fd6e0', state.skyBottom, 0.10), 0.6 + 0.4 * day);
  const deep    = scaleHex(mixHex('#1f7fa6', state.skyBottom, 0.18), day);
  const crest   = scaleHex('#bdeef5', 0.5 + 0.5 * day);
  const foam    = scaleHex('#ffffff', 0.72 + 0.28 * day);

  const step = Math.max(8, W / 64);
  // Wavy waterline: a long gentle swell + a faster shorter ripple, scrolling.
  const edgeY = x => tideY
    + Math.sin(x * 0.012 + time * 1.6) * band * 0.013
    + Math.sin(x * 0.030 - time * 1.1) * band * 0.006;

  ctx.save();

  // Wet-sand sheen just above the surf (where the tide recently was).
  ctx.fillStyle = hexWithAlpha(scaleHex(state.floor, 0.7), 0.5);
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
  const grad = ctx.createLinearGradient(0, tideY, 0, bounds.height);
  grad.addColorStop(0, shallow);
  grad.addColorStop(0.55, mixHex(shallow, deep, 0.65));
  grad.addColorStop(1, deep);
  ctx.fillStyle = grad;
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
