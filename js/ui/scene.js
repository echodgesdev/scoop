// @ts-check
import { GROUND_Y } from '../game/config.js';
import { dayCycleState, nightCycleState } from '../game/dayCycle.js';
import { rgb, scaleHex, hexWithAlpha } from './colorUtils.js';
import { drawStars } from './view/sceneStarView.js';
import { drawClouds } from './view/sceneCloudView.js';
import { drawOcean } from './view/sceneOceanView.js';

/** @typedef {import('../game.js').Game} Game */

/**
 * Paint the full background for the frame: the day sky + sun, or the between-wave
 * night cycle (moon + fast sky), then parallaxing clouds, then sand and ocean on
 * top. Drawn first each frame; the actors layer over the floor afterward. Returns
 * the resolved day/night state so the caller can reuse its colors (e.g. the floor
 * tint for actor shadows). The star, cloud, and ocean passes live in their own
 * *View.js modules; this function just sequences them.
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 * @returns {{ floor: string, skyTop: string, skyBottom: string }}
 */
export function drawEnvironment(ctx, game) {
  const state = game.flow.inNightCycle
    ? nightCycleState(game.flow.nightT, game.bounds)
    : dayCycleState(game.world.waves.waveFraction, game.bounds);
  if (game.flow.inNightCycle) drawNightSky(ctx, game.bounds, state);
  else drawSkyAndSun(ctx, game.bounds, state);
  drawClouds(ctx, game.bounds, state, game.clock);
  drawSand(ctx, game.bounds, state);
  drawOcean(ctx, game.bounds, state, game.clock);
  return state;
}

/**
 * A grounding-shadow tint for actors on the sand: the current floor color darkened
 * and nudged toward a cool dusk tone, so the shadow shifts with the time of day and
 * complements the warm sand. Returns an "r, g, b" string for rgba().
 * @param {string} floorHex the day/night state's floor color
 */
export function groundShadowRgb(floorHex) {
  const c = rgb(scaleHex(floorHex, 0.68));    // darken the sand a touch (kept light)
  const cool = { r: 70, g: 64, b: 96 };       // gentle cool shade to nudge toward
  const t = 0.28;
  const m = n => Math.round(n);
  return `${m(c.r + (cool.r - c.r) * t)}, ${m(c.g + (cool.g - c.g) * t)}, ${m(c.b + (cool.b - c.b) * t)}`;
}

// === Per-frame caches =========================================================
// The day-cycle state only changes on serves (wave progress is discrete), so the
// sky gradient and sun halo below are keyed by the values they bake in and rebuilt
// only when those change — not on every rendered frame. (The night-cycle sweep
// changes continuously over ~2s between waves; the caches just miss harmlessly
// there.) The ocean and cloud views cache their tints the same way.

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
function drawSkyAndSun(ctx, bounds, state) {
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

/**
 * Night-cycle sky for the between-wave reset: gradient + star field + a glowing
 * crescent moon (drawn before sand so the moon can sit low behind the horizon).
 * The star field itself lives in sceneStarView.js.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawNightSky(ctx, bounds, state) {
  const groundY = GROUND_Y;

  ctx.fillStyle = skyGradient(ctx, groundY, state.skyTop, state.skyBottom);
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  // Stars (above the horizon only).
  drawStars(ctx, bounds, state);

  // Moon (glow + crescent), fading out as the sky brightens toward dawn so it's
  // gone by the seamless hand-off to the day sky.
  if (state.moonAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = state.moonAlpha;
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
    ctx.restore();
  }
}

/**
 * Sand floor pass. Drawn AFTER the cone, customers, and mini-cones so the
 * sand covers the embedded bottoms — actors look like they're standing in
 * the floor rather than over it.
 */
function drawSand(ctx, bounds, state) {
  const groundY = GROUND_Y;
  ctx.fillStyle = state.floor;
  ctx.fillRect(0, groundY, bounds.width, bounds.height - groundY);
}
