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
