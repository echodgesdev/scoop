// @ts-check
import { CONE, SCOOP, SERVE } from '../../game/config.js';
import { LAND_TIME, SLOSH_HIST, TOSS_GHOST_S, TOSS_BUMP_S } from '../../game/player.js';
import { SCOOP_STATE, drawScoopSprite } from '../sprites/scoopRenderer.js';
import { drawPlayerCone, CONE_FRAME } from '../sprites/coneRenderer.js';
import { glowCircle } from '../effects/glow.js';

/** @typedef {import('../../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../../game/player.js').Player} Player */

// View-only slosh-trail shape: each scoop up the stack samples the cone's lean
// from a few ticks earlier (SLOSH_LAG) and scales it by a sideways natural-log
// ARC — flat at the base (bottom scoop tracks the cone), bowing out toward the
// top — so the column reads as one graceful swoosh trailing behind.
const SLOSH_LAG = 2.4;  // ticks of extra delay per scoop above the bottom
const SLOSH_ARC = 6;    // log-arc curvature (higher = sharper bow near the top)

/**
 * Draw the cone + its tray. Reads the Player model's position, stack, slosh
 * history, handoff lean, and flash — never mutates it. Reads top-to-bottom as
 * the assembly's draw order: halo, cone back, scoops, cone front, then the
 * world-space toss ghosts.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {boolean} [rainbow] repaint every tray scoop as rainbow (purely visual)
 * @param {number} [alpha] render-interpolation fraction (previous→current x)
 */
export function drawPlayer(ctx, player, rainbow = false, alpha = 1) {
  // Cone fractured on game over — it's gone (the debris lives in Effects), so draw
  // nothing: no cone, no tray, no toss ghosts.
  if (player.fractured) return;

  ctx.save();
  applyAssemblyTransform(ctx, player, alpha);

  drawServeFlash(ctx, player);
  drawPlayerCone(ctx, player.x, player.y, CONE_FRAME.BACK);   // behind the scoops
  drawScoopStack(ctx, player, rainbow);
  // Cone FRONT — over the scoops, so the bottom scoop nests into the bowl.
  drawPlayerCone(ctx, player.x, player.y, CONE_FRAME.FRONT);
  ctx.restore();

  // Toss ghosts render in world space (outside the assembly transform) so a toss
  // mid-reach doesn't drag them sideways with the handoff lean.
  drawTossedScoops(ctx, player, rainbow);
}

/**
 * Shift the canvas so the cone and every scoop riding it move together:
 * 1. render interpolation — everything is positioned off player.x, so shifting
 *    by (drawX − x) draws the whole assembly at the interpolated x;
 * 2. idle bob — hoverY (0 while moving) floats the assembly while standing still;
 * 3. catch recoil — a springy vertical bounce when a scoop lands (player.recoil,
 *    bigger for faster scoops), so the whole loaded cone reads as weighty;
 * 4. handoff lean — a sin-bumped offset toward the customer that snaps back by
 *    the end of SERVE.HANDOFF_DURATION_S (the coordinated "reach").
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {number} alpha
 */
function applyAssemblyTransform(ctx, player, alpha) {
  let tx = player.drawX(alpha) - player.x;
  let ty = player.hoverY + player.recoil;
  if (player.handoffT < SERVE.HANDOFF_DURATION_S) {
    const p = player.handoffT / SERVE.HANDOFF_DURATION_S;
    const ease = Math.sin(p * Math.PI);
    tx += player.handoffDx * ease;
    ty += player.handoffDy * ease;
  }
  if (tx !== 0 || ty !== 0) ctx.translate(tx, ty);
}

/**
 * Serve/catch flash halo, drawn behind the cone back.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 */
function drawServeFlash(ctx, player) {
  if (player.flash > 0) {
    glowCircle(ctx, player.x, player.y, CONE.WIDTH * 0.75, '#ffec5c', Math.min(1, player.flash / 0.2));
  }
}

/**
 * The tray: every scoop riding the cone, bottom to top. Each gets a squash-pop
 * landing scale and a fake slosh-trail X offset; the top scoop additionally gets
 * the toss squash-back bounce.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {boolean} rainbow
 */
function drawScoopStack(ctx, player, rainbow) {
  const stack = player.stack;
  for (let i = 0; i < stack.length; i++) {
    const s = stack[i];
    const pos = player.scoopPosition(i);
    const drawX = pos.x + sloshOffset(player, i, stack.length);
    const drawY = pos.y;
    const drawScale = 1 + 0.28 * (s.land / LAND_TIME);   // squash-pop on landing (1 -> 0 as it settles)

    const isTop = i === stack.length - 1;
    const state = isTop ? SCOOP_STATE.CONE_TOP : SCOOP_STATE.CONE;
    const colorKey = rainbow ? 'rainbow' : s.color;

    if (isTop && player.tossBump > 0) {
      drawTossBumpScoop(ctx, player, drawX, drawY, colorKey, drawScale, state);
    } else {
      drawScoop(ctx, drawX, drawY, colorKey, drawScale, state);
    }
  }
}

/**
 * Fake slosh trail: the bottom scoop tracks the cone (zero lean, current tick);
 * each scoop above samples the cone's lean from a few ticks earlier (SLOSH_LAG)
 * and scales it by a sideways log arc (SLOSH_ARC) — flat at the base, bowing out
 * toward the top — so the column trails behind in one graceful swoosh.
 * @param {Player} player
 * @param {number} i index up the stack
 * @param {number} n stack height
 * @returns {number} sideways X offset for scoop i
 */
function sloshOffset(player, i, n) {
  const f = n > 1 ? i / (n - 1) : 1;                 // 0 at bottom .. 1 at top
  const arc = 1 - Math.log(1 + SLOSH_ARC * (1 - f)) / Math.log(1 + SLOSH_ARC);
  const lag = Math.min(SLOSH_HIST - 1, Math.round(i * SLOSH_LAG));
  const laggedLean = player._sloshHist[(player._sloshHead - lag + SLOSH_HIST) % SLOSH_HIST];
  return laggedLean * arc;
}

/**
 * Top scoop's squash-back bounce: a canceled (too-short) up-flick leaves it
 * stretched, then it recoils through a damped squash back to size. The cos·decay
 * term starts at +1 (tall + narrow) and wobbles down to rest; anchoring at the
 * scoop's base makes it grow up / compress down, not float.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {number} drawX @param {number} drawY
 * @param {ScoopColor | 'rainbow'} colorKey
 * @param {number} drawScale
 * @param {number | string} state
 */
function drawTossBumpScoop(ctx, player, drawX, drawY, colorKey, drawScale, state) {
  const q = 1 - player.tossBump / TOSS_BUMP_S;       // 0 -> 1
  const wob = Math.cos(q * Math.PI * 3) * (1 - q);   // +1 stretched .. damps to 0
  const sy = 1 + 0.60 * wob;
  const sx = 1 - 0.38 * wob;
  const baseY = drawY + SCOOP.RADIUS;
  ctx.save();
  ctx.translate(drawX, baseY);
  ctx.scale(sx, sy);
  ctx.translate(-drawX, -baseY);
  drawScoop(ctx, drawX, drawY, colorKey, drawScale, state);
  ctx.restore();
}

/**
 * Launched-scoop ghosts (committed toss): each rises, stretches tall, and fades
 * out over TOSS_GHOST_S — a quick "flung away" flourish.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {boolean} rainbow
 */
function drawTossedScoops(ctx, player, rainbow) {
  for (const g of player.tossed) {
    const q = Math.min(1, g.t / TOSS_GHOST_S);           // 0 -> 1
    const rise = 58 * (1 - (1 - q) * (1 - q));           // easeOut upward travel
    const gy = g.y - rise;
    const sy = 1 + 0.90 * (1 - q);                       // launches tall, relaxes
    const sx = 1 - 0.42 * (1 - q);
    ctx.save();
    ctx.globalAlpha = (1 - q) * (1 - q);                 // fade out fast (ease-in)
    ctx.translate(g.x, gy);
    ctx.scale(sx, sy);
    ctx.translate(-g.x, -gy);
    drawScoop(ctx, g.x, gy, rainbow ? 'rainbow' : g.color, 1, SCOOP_STATE.DEFAULT);
    ctx.restore();
  }
}

/**
 * One scoop: the sheet sprite for its flavor + state. Shared by the tray, the
 * customer mini-cones (customers), the falling field, and anywhere a scoop renders.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y
 * @param {ScoopColor | 'rainbow'} colorKey
 * @param {number} [scale]
 * @param {number | string} [state] one of SCOOP_STATE (sprite row)
 */
export function drawScoop(ctx, x, y, colorKey, scale = 1, state = SCOOP_STATE.CONE) {
  drawScoopSprite(ctx, x, y, SCOOP.RADIUS * scale, colorKey, state);
}
