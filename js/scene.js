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
