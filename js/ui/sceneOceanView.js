// @ts-check
// The beach surf: a cartoony tidal ocean painted along the bottom of the play
// area. Owns its own time-of-day tint + water-gradient caches, keyed by the
// discrete day state so the hex math and gradient objects are reused frame to
// frame and only rebuilt on serves (the night-cycle sweep changes continuously
// over ~2s between waves; the caches just miss harmlessly there).
//
// drawOcean() is a thin orchestrator: it derives this frame's geometry (the
// `Surf`) and tint, then calls one private pass per layer (wet sand → water body
// → crest lines → foam band → foam bubbles), back to front.
import { GROUND_Y } from '../game/config.js';
import { mixHex, scaleHex, luminance, hexWithAlpha } from './colorUtils.js';

// Base colors, tinted toward the time of day in oceanTint(). The sea is a
// shallow→deep aqua; crests/foam are pale whites.
const WATER_SHALLOW = '#6fd6e0';
const WATER_DEEP    = '#1f7fa6';
const CREST_COLOR   = '#bdeef5';
const FOAM_COLOR    = '#ffffff';
// Soft, rounded ends on the cartoon crest strokes.
const CREST_CAP = 'round';

/** @typedef {{ key: string, shallow: string, deep: string, crest: string, foam: string, wet: string }} OceanTint */
/** @typedef {{ W: number, step: number, band: number, height: number, time: number, tideY: number, edgeY: (x: number) => number }} Surf */

// Ocean tint palette + water-body gradient caches.
/** @type {OceanTint} */
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
  const band = bounds.height - GROUND_Y;          // sand-band height
  if (band <= 4) return;

  // Waterline lives in the LOWER part of the sand band (below the customers).
  const restY = GROUND_Y + band * 0.66;           // tide-out (low)
  const tideTravel = band * 0.15;                  // how far the tide can climb
  const tideY = tideLineY(time, restY, tideTravel);

  /** @type {Surf} */
  const surf = {
    W: bounds.width,
    step: Math.max(8, bounds.width / 64),
    band,
    height: bounds.height,
    time,
    tideY,
    // Wavy waterline: a long gentle swell + a faster shorter ripple, scrolling.
    edgeY: x => tideY
      + Math.sin(x * 0.012 + time * 1.6) * band * 0.013
      + Math.sin(x * 0.030 - time * 1.1) * band * 0.006
  };
  const tint = oceanTint(state);

  ctx.save();
  drawWetSand(ctx, surf, tint);
  drawWaterBody(ctx, surf, tint);
  drawCrestLines(ctx, surf, tint);
  drawFoamBand(ctx, surf, tint);
  drawFoamBubbles(ctx, surf, tint);
  ctx.restore();
}

/**
 * Tide envelope → waterline Y. Three incommensurate sines so each roll-in peaks
 * at a slightly different height ("slight variances in how far the tide rolls in").
 * @param {number} time @param {number} restY @param {number} tideTravel
 * @returns {number}
 */
function tideLineY(time, restY, tideTravel) {
  const s = Math.sin(time * 0.45) * 0.6
          + Math.sin(time * 0.23 + 1.3) * 0.3
          + Math.sin(time * 0.11 + 2.1) * 0.1;
  const tideEnv = 0.5 + 0.5 * Math.max(-1, Math.min(1, s));
  return restY - tideTravel * tideEnv;
}

/**
 * The time-of-day tint palette, cached: the hex parsing/serializing only re-runs
 * when the day state actually changes (on serves), not per frame.
 * @param {{ skyTop: string, skyBottom: string, floor: string }} state
 * @returns {OceanTint}
 */
function oceanTint(state) {
  const tintKey = state.skyTop + '|' + state.skyBottom + '|' + state.floor;
  if (_oceanTint.key !== tintKey) {
    const day = Math.max(0.22, Math.min(1, luminance(state.skyTop) * 1.4));
    _oceanTint = {
      key: tintKey,
      shallow: scaleHex(mixHex(WATER_SHALLOW, state.skyBottom, 0.10), 0.6 + 0.4 * day),
      deep:    scaleHex(mixHex(WATER_DEEP, state.skyBottom, 0.18), day),
      crest:   scaleHex(CREST_COLOR, 0.5 + 0.5 * day),
      foam:    scaleHex(FOAM_COLOR, 0.72 + 0.28 * day),
      wet:     hexWithAlpha(scaleHex(state.floor, 0.7), 0.5)
    };
  }
  return _oceanTint;
}

/**
 * Wet-sand sheen just above the surf (where the tide recently was).
 * @param {CanvasRenderingContext2D} ctx @param {Surf} surf @param {OceanTint} tint
 */
function drawWetSand(ctx, surf, tint) {
  const { W, step, band, edgeY } = surf;
  ctx.fillStyle = tint.wet;
  ctx.beginPath();
  ctx.moveTo(0, edgeY(0));
  for (let x = 0; x <= W; x += step) ctx.lineTo(x, edgeY(x));
  for (let x = W; x >= 0; x -= step) ctx.lineTo(x, edgeY(x) - band * 0.05);
  ctx.closePath();
  ctx.fill();
}

/**
 * Water body — a vertical gradient (shallow at the surf → deep at the bottom).
 * The gradient's top anchor rides the tide; quantize it to 2px steps so the
 * gradient object is reused across frames instead of rebuilt 60×/s (the tide
 * covers a fixed ~50px range, so the cache cycles through a handful of keys).
 * @param {CanvasRenderingContext2D} ctx @param {Surf} surf @param {OceanTint} tint
 */
function drawWaterBody(ctx, surf, tint) {
  const { W, step, height, tideY, edgeY } = surf;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, edgeY(0));
  for (let x = 0; x <= W; x += step) ctx.lineTo(x, edgeY(x));
  ctx.lineTo(W, height);
  ctx.closePath();

  const tideYq = Math.round(tideY / 2) * 2;
  const waterKey = tint.key + '|' + tideYq + '|' + height;
  if (_waterCache.key !== waterKey) {
    const grad = ctx.createLinearGradient(0, tideYq, 0, height);
    grad.addColorStop(0, tint.shallow);
    grad.addColorStop(0.55, mixHex(tint.shallow, tint.deep, 0.65));
    grad.addColorStop(1, tint.deep);
    _waterCache = { key: waterKey, grad };
  }
  ctx.fillStyle = /** @type {CanvasGradient} */ (_waterCache.grad);
  ctx.fill();
}

/**
 * A couple of cartoony lighter crest lines drifting across the water.
 * @param {CanvasRenderingContext2D} ctx @param {Surf} surf @param {OceanTint} tint
 */
function drawCrestLines(ctx, surf, tint) {
  const { W, step, band, time, edgeY } = surf;
  ctx.strokeStyle = tint.crest;
  ctx.lineWidth = Math.max(2, band * 0.009);
  ctx.lineCap = CREST_CAP;
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
}

/**
 * Bumpy cartoon foam band hugging the waterline.
 * @param {CanvasRenderingContext2D} ctx @param {Surf} surf @param {OceanTint} tint
 */
function drawFoamBand(ctx, surf, tint) {
  const { W, step, band, time, edgeY } = surf;
  ctx.fillStyle = tint.foam;
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
  ctx.globalAlpha = 1;
}

/**
 * Scattered foam blobs riding the surf, twinkling in/out.
 * @param {CanvasRenderingContext2D} ctx @param {Surf} surf @param {OceanTint} tint
 */
function drawFoamBubbles(ctx, surf, tint) {
  const { W, band, time, edgeY } = surf;
  ctx.fillStyle = tint.foam;
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
}
