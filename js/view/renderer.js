// @ts-check
import { drawSkyAndSun, drawNightSky, drawSand, drawOcean } from './scene.js';
import { dayCycleState, nightCycleState } from '../game/dayCycle.js';
import { drawField } from './scoopsView.js';
import { drawPlayer } from './playerView.js';
import { glowCircle } from './glow.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR } from './powerupVisuals.js';
import {
  PICKUP_TO_POWER,
  SCOOP_RADIUS,
  CUSTOMER_FACE_OFFSET_PX
} from '../game/config.js';
import { REACH } from '../game/shop.js';

/** @typedef {import('../game.js').Game} Game */

// Active-power-up entrance phases (fractions of the slide anim). The bubble arcs
// up to a mid waypoint (large, with a slight hold) then settles to its resting
// slot while shrinking. The sim-side timing (ACTIVE_SLIDE_S) lives in game.js.
const ACTIVE_ARC_FRAC = 0.45;    // 0..this: arc up-and-over to the mid waypoint
const ACTIVE_PAUSE_FRAC = 0.6;   // arc-frac..this: slight hold at the waypoint

/**
 * Draw one full frame. READS the game (its actors, effects, flags, banner, …)
 * and paints — never mutates.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Game} game
 * @param {number} [alpha] leftover sim-step fraction (0..1) — moving actors are
 *   drawn interpolated between their previous and current sim positions, so
 *   rendering at 90/120Hz over the 60Hz sim stays smooth.
 */
export function drawFrame(ctx, game, alpha = 1) {
  const { x, y } = game.effects.offset();
  ctx.save();
  ctx.translate(x, y);

  const world = game.world;
  const rainbow = world.powerups.rainbowActive;

  // Background: sky + sun (or the between-wave night cycle: moon + fast sky),
  // then sand on top. Everything after this draws over the floor — actors stay
  // visible even when their positions overlap the sand region.
  if (game.inNightCycle) {
    const nightState = nightCycleState(game.nightT, game.bounds);
    drawNightSky(ctx, game.bounds, nightState);
    drawSand(ctx, game.bounds, nightState);
    drawOcean(ctx, game.bounds, nightState, game.clock);
  } else {
    const dayState = dayCycleState(world.waves.waveFraction, game.bounds);
    drawSkyAndSun(ctx, game.bounds, dayState);
    drawSand(ctx, game.bounds, dayState);
    drawOcean(ctx, game.bounds, dayState, game.clock);
  }

  drawField(ctx, world.field, rainbow, alpha);
  drawPlayer(ctx, world.player, rainbow, alpha);
  const pausePatience = world.powerups.pauseActive || !game.flags.patternTimer;
  game.stations.draw(ctx, world.shop.list, {
    activeIndex:    world.shop.customerAt(world.player.x),
    canServe:       i => world.shop.canServe(i, world.player.colors(), rainbow, world.deliveryMode),
    hex:            c => world.shop.hex(c),
    pausePatience,
    rainbow,
    time:           game.clock,
    tipLabel:       game.tutorial.active,
    alpha
  });
  // Tutorial hint pills — over the scene but under the effect bursts.
  if (game.tutorial.active) game.tutorial.draw(ctx, game);
  game.effects.draw(ctx);

  if (game.flags.showHitboxes) drawHitboxes(ctx, game);

  if (game.banner) {
    const f = Math.min(1, game.banner.t / 0.4);
    ctx.save();
    ctx.globalAlpha = f;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "bold 64px 'Comic Sans MS', sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.fillStyle = '#fff3c0';
    const bx = game.bounds.width / 2 - x;
    const by = game.bounds.height * 0.32 - y;
    ctx.strokeText(game.banner.text, bx, by);
    ctx.fillText(game.banner.text, bx, by);
    ctx.restore();
  }

  if (game.hurt > 0) {
    ctx.fillStyle = `rgba(230, 57, 70, ${0.35 * (game.hurt / 0.3)})`;
    ctx.fillRect(-x, -y, game.bounds.width, game.bounds.height);
  }

  if (game.paused && game.running) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(-x, -y, game.bounds.width, game.bounds.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⏸ PAUSED', game.bounds.width / 2 - x, game.bounds.height / 2 - y);
  }
  ctx.restore();

  // The active running-power-up indicator (screen-fixed).
  drawActivePowerup(ctx, game);

  // FPS overlay is screen-fixed (drawn after the shake transform is popped).
  if (game.flags.showFps) {
    ctx.save();
    ctx.font = "bold 20px 'Consolas', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const label = `${Math.round(game.fps)} fps  scoops:${game.world.field.scoops.length}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(label, 12, 12);
    ctx.fillStyle = '#39ff14';
    ctx.fillText(label, 12, 12);
    ctx.restore();
  }
}

/**
 * Active power-up indicator (screen-space): a single bubble showing the running
 * timed power-up with its countdown ring. Idle → nothing. A finished / replaced
 * bubble slides off LEFT. The entrance lobs up to a waypoint then settles into
 * the resting slot (game.world.activeSlotPos) while shrinking.
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 */
function drawActivePowerup(ctx, game) {
  const world = game.world;
  if (!world.activeBubble && world.puLeaving.length === 0) return;
  const aslot = world.activeSlotPos();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Bubbles sliding off to the left (finished / replaced).
  for (const lv of world.puLeaving) {
    ctx.globalAlpha = 1 - lv.t;
    drawPowerupBubble(ctx, lv.x - lv.t * 70, lv.y, lv.r0 * (1 - 0.5 * lv.t), lv.type, false, -1);
  }
  ctx.globalAlpha = 1;

  if (world.activeBubble) {
    const a = world.activeBubble;
    const cx = aslot.x;
    const restY = aslot.y;                              // final rest
    const midY = restY - game.bounds.height * 0.10;     // pause waypoint
    let bx, by, grow;
    if (a.anim < ACTIVE_ARC_FRAC) {
      // Quadratic Bézier with a control point lifted above both ends → a toss.
      const t = a.anim / ACTIVE_ARC_FRAC;
      const e = 1 - (1 - t) * (1 - t);                  // easeOut along the arc
      const u = 1 - e;
      const ctrlX = (a.fromX + cx) / 2;
      const ctrlY = Math.min(a.fromY, midY) - game.bounds.height * 0.15;
      bx = u * u * a.fromX + 2 * u * e * ctrlX + e * e * cx;
      by = u * u * a.fromY + 2 * u * e * ctrlY + e * e * midY;
      grow = 0.5 + 0.9 * e;                             // → ~1.4× by the waypoint
    } else if (a.anim < ACTIVE_PAUSE_FRAC) {
      bx = cx; by = midY; grow = 1.4;                   // slight hold, large
    } else {
      const p = (a.anim - ACTIVE_PAUSE_FRAC) / (1 - ACTIVE_PAUSE_FRAC);
      const e = p * p * (3 - 2 * p);                    // smoothstep settle
      bx = cx;
      by = midY + (restY - midY) * e;
      grow = 1.4 - 0.4 * e;                             // shrink 1.4× → 1.0×
    }
    const pulse = 1 + 0.08 * Math.sin(game.clock * 6);
    const radius = aslot.r * grow * pulse;
    const frac = world.powerups.fraction(PICKUP_TO_POWER[a.type]);
    drawPowerupBubble(ctx, bx, by, radius, a.type, true, frac);
  }
  ctx.restore();
}

/**
 * One power-up bubble: dark well + colored ring + icon, optional glow and a
 * run-timer arc (ringFrac >= 0 shows remaining duration). Assumes textAlign/
 * baseline already centered and globalAlpha set by the caller.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} radius
 * @param {import('../types.js').PickupTypeName} type
 * @param {boolean} glow
 * @param {number} ringFrac  0..1 to draw the run-timer ring; < 0 to skip it
 */
function drawPowerupBubble(ctx, x, y, radius, type, glow, ringFrac) {
  const ring = PICKUP_RING_COLOR[type];
  // Baked halo instead of a per-frame shadowBlur pass.
  if (glow) glowCircle(ctx, x, y, radius + 2, ring);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ring;
  ctx.stroke();

  if (ringFrac >= 0) {
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + ringFrac * Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = `${Math.floor(radius * 1.05)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.fillText(PICKUP_ICONS[type], x, y + 1);
}

/**
 * Debug overlay: red collision shapes for falling scoops, the cone catch box,
 * the dissolve/miss line, and each customer's serve-reach band + face box. Drawn
 * inside the shake transform so it tracks the actors. Toggled by "Show hitboxes".
 * @param {CanvasRenderingContext2D} ctx @param {Game} game
 */
function drawHitboxes(ctx, game) {
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
  const missY = game.stations.groundY + SCOOP_RADIUS * 2;
  ctx.strokeStyle = 'rgba(255,45,45,0.45)';
  ctx.beginPath();
  ctx.moveTo(0, missY);
  ctx.lineTo(game.bounds.width, missY);
  ctx.stroke();

  // Customers: face box + serve-reach band (serve test is x-distance only).
  const groundY = game.stations.groundY;
  for (const c of world.shop.list) {
    const faceY = groundY + CUSTOMER_FACE_OFFSET_PX + c.yOff;
    ctx.strokeStyle = '#ff2d2d';
    ctx.strokeRect(c.x - 46, faceY - 46, 92, 92);
    ctx.strokeStyle = 'rgba(255,45,45,0.4)';
    ctx.strokeRect(c.x - REACH, faceY - 70, REACH * 2, 150);
  }

  ctx.restore();
}
