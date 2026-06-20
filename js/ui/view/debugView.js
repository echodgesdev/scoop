// @ts-check
// Debug overlays, toggled from the debug panel: collision hitboxes (red shapes
// over the actors) and the FPS / live-scoop readout. Pure presentation; both
// self-guard on their game.flags toggle, so renderer.drawFrame calls them
// unconditionally (hitboxes inside the shake transform; fps screen-fixed).
import { SCOOP_RADIUS, CUSTOMER_FACE_OFFSET_PX } from '../../game/config.js';
import { REACH } from '../../game/shop.js';

/** @typedef {import('../../game.js').Game} Game */

const FPS_FILL    = '#39ff14';
const FPS_OUTLINE = 'rgba(0, 0, 0, 0.6)';
const FPS_SIZE    = 20;
const FPS_X = 12, FPS_Y = 12;

/**
 * Red collision shapes for falling scoops, the cone catch box, the dissolve/miss
 * line, and each customer's serve-reach band + face box. Drawn inside the shake
 * transform so it tracks the actors. Toggled by "Show hitboxes".
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 */
export function drawHitboxes(ctx, game) {
  if (!game.flags.showHitboxes) return;
  const world = game.world;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ff2d2d';

  // Falling scoops — collision circle (skip dissolving ones; uncatchable).
  for (const s of world.field.scoops) {
    if (s.dissolve !== undefined) continue;
    ctx.beginPath();
    ctx.arc(s.x, s.y, SCOOP_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cone: catch hitbox (solid AABB).
  const cb = world.player.catchHitbox();
  ctx.strokeRect(cb.x - cb.halfW, cb.y - cb.r, cb.halfW * 2, cb.r * 2);

  // Miss / dissolve line.
  const missY = game.customers.groundY + SCOOP_RADIUS * 2;
  ctx.strokeStyle = 'rgba(255,45,45,0.45)';
  ctx.beginPath();
  ctx.moveTo(0, missY);
  ctx.lineTo(game.bounds.width, missY);
  ctx.stroke();

  // Customers: face box + serve-reach band (serve test is x-distance only).
  const groundY = game.customers.groundY;
  for (const c of world.shop.list) {
    const faceY = groundY + CUSTOMER_FACE_OFFSET_PX + c.yOff;
    ctx.strokeStyle = '#ff2d2d';
    ctx.strokeRect(c.x - 46, faceY - 46, 92, 92);
    ctx.strokeStyle = 'rgba(255,45,45,0.4)';
    ctx.strokeRect(c.x - REACH, faceY - 70, REACH * 2, 150);
  }

  ctx.restore();
}

/**
 * Top-left FPS + live-scoop readout. Toggled by "Show FPS".
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 */
export function drawFps(ctx, game) {
  if (!game.flags.showFps) return;
  const label = `${Math.round(game.fps)} fps  scoops:${game.world.field.scoops.length}`;
  ctx.save();
  ctx.font = `bold ${FPS_SIZE}px 'Consolas', monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 4;
  ctx.strokeStyle = FPS_OUTLINE;
  ctx.strokeText(label, FPS_X, FPS_Y);
  ctx.fillStyle = FPS_FILL;
  ctx.fillText(label, FPS_X, FPS_Y);
  ctx.restore();
}
