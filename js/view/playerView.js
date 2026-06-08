// @ts-check
import {
  COLORS,
  CONE_WIDTH,
  CONE_HEIGHT,
  SCOOP_RADIUS,
  HANDOFF_DURATION_S
} from '../game/config.js';
import { LAND_TIME, SLOSH_HIST } from '../game/player.js';
import { scoopSheet, SCOOP_STATE, drawScoopSprite } from './sprites.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../game/player.js').Player} Player */

// View-only slosh-trail shape: each scoop up the stack samples the cone's lean
// from a few ticks earlier (SLOSH_LAG) and scales it by a sideways natural-log
// ARC — flat at the base (bottom scoop tracks the cone), bowing out toward the
// top — so the column reads as one graceful swoosh trailing behind.
const SLOSH_LAG = 2.4;  // ticks of extra delay per scoop above the bottom
const SLOSH_ARC = 6;    // log-arc curvature (higher = sharper bow near the top)

const RAINBOW_STOPS = ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'];

/**
 * Draw the cone + its tray. Reads the Player model's position, stack, slosh
 * history, handoff lean, and flash — never mutates it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {boolean} [rainbow] repaint every tray scoop as rainbow (purely visual)
 */
export function drawPlayer(ctx, player, rainbow = false) {
  // Handoff lean: a sin-bumped offset toward the customer that snaps back by the
  // end of HANDOFF_DURATION_S. Applied via translate so the cone and every scoop
  // on it move together, like a coordinated "reach".
  ctx.save();
  if (player.handoffT < HANDOFF_DURATION_S) {
    const p = player.handoffT / HANDOFF_DURATION_S;
    const ease = Math.sin(p * Math.PI);
    ctx.translate(player.handoffDx * ease, player.handoffDy * ease);
  }
  drawCone(ctx, player);

  const stack = player.stack;
  for (let i = 0; i < stack.length; i++) {
    const s = stack[i];
    const pos = player.scoopPosition(i);
    let drawX = pos.x;
    const drawY = pos.y;
    const p = s.land / LAND_TIME;          // 1 -> 0 as it settles
    const drawScale = 1 + 0.28 * p;        // squash-pop on landing

    // Fake slosh trail: the bottom scoop tracks the cone (zero lean, current
    // tick); each scoop above samples the lean from a few ticks earlier, and its
    // amplitude follows the sideways log arc — so the column trails in one swoosh.
    const n = stack.length;
    const f = n > 1 ? i / (n - 1) : 1;                 // 0 at bottom .. 1 at top
    const arc = 1 - Math.log(1 + SLOSH_ARC * (1 - f)) / Math.log(1 + SLOSH_ARC);
    const lag = Math.min(SLOSH_HIST - 1, Math.round(i * SLOSH_LAG));
    const laggedLean = player._sloshHist[(player._sloshHead - lag + SLOSH_HIST) % SLOSH_HIST];
    drawX += laggedLean * arc;

    const isTop = i === stack.length - 1;
    const state = isTop ? SCOOP_STATE.CONE_TOP : SCOOP_STATE.CONE;
    drawScoop(ctx, drawX, drawY, rainbow ? 'rainbow' : s.color, drawScale, state);

    // The Scoop-Top sprite frame is the "deliver me next" highlight. Keep the
    // amber ring only as a fallback for when the sheet hasn't loaded.
    if (isTop && !scoopSheet.ready) {
      drawTopRing(ctx, drawX, drawY, SCOOP_RADIUS * drawScale);
    }
  }
  ctx.restore();
}

/**
 * Amber selection ring around the top (next-to-be-delivered) scoop. Mirrors the
 * active customer bubble's outline in stations.js (#ffb703 stroke + #ffd166 glow).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r drawn scoop radius
 */
function drawTopRing(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = '#ffd166';
  ctx.shadowBlur = 16;
  ctx.strokeStyle = '#ffb703';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {Player} player */
function drawCone(ctx, player) {
  const cx = player.x;
  const cy = player.y;
  ctx.save();
  if (player.flash > 0) {
    ctx.shadowColor = '#ffec5c';
    ctx.shadowBlur = 30;
  }
  ctx.fillStyle = '#d18a4a';
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - CONE_WIDTH / 2, cy - CONE_HEIGHT / 2);
  ctx.lineTo(cx + CONE_WIDTH / 2, cy - CONE_HEIGHT / 2);
  ctx.lineTo(cx, cy + CONE_HEIGHT / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * One scoop: the sheet sprite for its flavor + state, or a procedural circle
 * fallback (also used for the rainbow power-up). Shared by the tray, the customer
 * mini-cones (stations), the falling field, and anywhere a scoop renders.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y
 * @param {ScoopColor | 'rainbow'} colorKey
 * @param {number} [scale]
 * @param {number | string} [state] one of SCOOP_STATE (sprite row); ignored by the circle
 */
export function drawScoop(ctx, x, y, colorKey, scale = 1, state = SCOOP_STATE.CONE) {
  const r = SCOOP_RADIUS * scale;
  // Sheet sprite for this flavor + state (rainbow is now its own column) when the
  // sheet's loaded; the procedural circle below is the fallback.
  if (drawScoopSprite(ctx, x, y, r, colorKey, state)) return;
  ctx.save();
  if (colorKey === 'rainbow') {
    const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    RAINBOW_STOPS.forEach((c, i) => grad.addColorStop(i / (RAINBOW_STOPS.length - 1), c));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = COLORS[colorKey];
  }
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
