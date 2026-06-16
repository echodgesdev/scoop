// @ts-check
import {
  COLORS,
  CONE_WIDTH,
  CONE_HEIGHT,
  SCOOP_RADIUS,
  HANDOFF_DURATION_S
} from '../game/config.js';
import { LAND_TIME, SLOSH_HIST, TOSS_GHOST_S, TOSS_BUMP_S } from '../game/player.js';
import { scoopSheet, SCOOP_STATE, drawScoopSprite } from './sprites.js';
import { SpriteSheet } from './spriteSheet.js';
import CONE_SPRITE, { CONE_FRAME } from './sprites/coneSprite.js';
import { glowCircle } from './glow.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../game/player.js').Player} Player */

// View-only slosh-trail shape: each scoop up the stack samples the cone's lean
// from a few ticks earlier (SLOSH_LAG) and scales it by a sideways natural-log
// ARC — flat at the base (bottom scoop tracks the cone), bowing out toward the
// top — so the column reads as one graceful swoosh trailing behind.
const SLOSH_LAG = 2.4;  // ticks of extra delay per scoop above the bottom
const SLOSH_ARC = 6;    // log-arc curvature (higher = sharper bow near the top)

const RAINBOW_STOPS = ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'];

// === Cone sprite (layered, grayscale, day-recolored) ========================
// A back layer + a front layer the scoop stack draws between. The grayscale art
// is recolored to a warm golden-orange (dimmed by the day cycle). CONE_SPRITE_W
// is the on-screen art width and CONE_SPRITE_DY nudges it vertically so the bowl
// meets the bottom scoop — tune these two if the cone reads too big/small or the
// scoops don't nest right.
const coneSheet = new SpriteSheet(CONE_SPRITE);
const CONE_FRAME_PX = CONE_SPRITE.frame.width;        // 256
const CONE_SPRITE_W = 168;                            // on-screen cone width (px)
const CONE_SPRITE_DY = -14;                           // sprite-center offset from player.y
// The cone's daylight color — a vibrant, yellowy-orange waffle (not a dull
// brown). It's the multiply tint: the light wafer reads as ~this color while the
// dark grid/outlines stay dark. Bump brighter / more yellow for more pop.
const CONE_BASE = '#e9931c';

function _lum(hex) {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}
function _scaleHex(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  const p = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + p(((v >> 16) & 255) * f) + p(((v >> 8) & 255) * f) + p((v & 255) * f);
}
const _DAWN_FLOOR_LUM = _lum('#e8b97a');   // brightest day-cycle floor = full cone brightness
const _CONE_TINT_STEPS = 13;

/**
 * The cone's tint for the current time of day: CONE_BASE scaled by the day-cycle
 * floor's brightness (so the cone dims into dusk alongside the sand) but never
 * below 0.40, quantized to a few brightness STEPS so the recolored sprite caches
 * cheaply.
 * @param {string} floorHex the active cycle state's `floor` color
 */
export function coneTintFor(floorHex) {
  const b = Math.max(0.40, Math.min(1, _lum(floorHex) / _DAWN_FLOOR_LUM));
  const stepped = Math.round(b * _CONE_TINT_STEPS) / _CONE_TINT_STEPS;
  return _scaleHex(CONE_BASE, stepped);
}

// Recolored cone frames, baked once per (frame, tint): the grayscale art
// multiplied by the tint (the light wafer takes the tint color; the dark
// grid/outlines stay dark), then clipped back to the sprite's alpha. Bounded by
// the tint-step count above (≤ a couple dozen small canvases).
/** @type {Map<string, HTMLCanvasElement>} */
const _coneCache = new Map();
function tintedConeFrame(frame, tint) {
  if (!coneSheet.ready) return null;
  const key = frame + '|' + tint;
  const hit = _coneCache.get(key);
  if (hit) return hit;
  const F = CONE_FRAME_PX;
  const c = document.createElement('canvas');
  c.width = c.height = F;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(coneSheet.img, frame * F, 0, F, F, 0, 0, F, F);  // grayscale art
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = tint;
  g.fillRect(0, 0, F, F);
  g.globalCompositeOperation = 'destination-in';               // keep only the cone's pixels
  g.drawImage(coneSheet.img, frame * F, 0, F, F, 0, 0, F, F);
  _coneCache.set(key, c);
  return c;
}

/** Blit a recolored cone frame centered on the cone. @returns {boolean} whether it drew. */
function drawConeFrame(ctx, player, frame, tint) {
  const c = tintedConeFrame(frame, tint);
  if (!c) return false;
  const w = CONE_SPRITE_W;
  ctx.drawImage(c, player.x - w / 2, player.y + CONE_SPRITE_DY - w / 2, w, w);
  return true;
}

/**
 * Draw the cone + its tray. Reads the Player model's position, stack, slosh
 * history, handoff lean, and flash — never mutates it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Player} player
 * @param {boolean} [rainbow] repaint every tray scoop as rainbow (purely visual)
 * @param {number} [alpha] render-interpolation fraction (previous→current x)
 * @param {string} [coneTint] day-recolored cone tint (see coneTintFor)
 */
export function drawPlayer(ctx, player, rainbow = false, alpha = 1, coneTint = CONE_BASE) {
  // One translate moves the cone and every scoop riding it together:
  // 1. render interpolation — everything here is positioned off player.x, so
  //    shifting by (drawX − x) draws the whole assembly at the interpolated x;
  // 2. handoff lean — a sin-bumped offset toward the customer that snaps back
  //    by the end of HANDOFF_DURATION_S (the coordinated "reach").
  ctx.save();
  let tx = player.drawX(alpha) - player.x;
  let ty = 0;
  if (player.handoffT < HANDOFF_DURATION_S) {
    const p = player.handoffT / HANDOFF_DURATION_S;
    const ease = Math.sin(p * Math.PI);
    tx += player.handoffDx * ease;
    ty += player.handoffDy * ease;
  }
  if (tx !== 0 || ty !== 0) ctx.translate(tx, ty);

  // Serve/catch flash halo, then the cone BACK (behind the scoops). Falls back
  // to the flat triangle until the cone sheet image loads.
  if (player.flash > 0) {
    glowCircle(ctx, player.x, player.y, CONE_WIDTH * 0.75, '#ffec5c', Math.min(1, player.flash / 0.2));
  }
  const coneReady = drawConeFrame(ctx, player, CONE_FRAME.BACK, coneTint);
  if (!coneReady) drawTriangleCone(ctx, player);

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
    const colorKey = rainbow ? 'rainbow' : s.color;

    // Squash-back bounce: a canceled (too-short) up-flick leaves the top scoop
    // stretched, then it recoils through a damped squash back to size. The
    // cos·decay term starts at +1 (tall + narrow) and wobbles down to rest;
    // anchoring at the scoop's base makes it grow up / compress down, not float.
    if (isTop && player.tossBump > 0) {
      const q = 1 - player.tossBump / TOSS_BUMP_S;       // 0 -> 1
      const wob = Math.cos(q * Math.PI * 3) * (1 - q);   // +1 stretched .. damps to 0
      const sy = 1 + 0.60 * wob;
      const sx = 1 - 0.38 * wob;
      const baseY = drawY + SCOOP_RADIUS;
      ctx.save();
      ctx.translate(drawX, baseY);
      ctx.scale(sx, sy);
      ctx.translate(-drawX, -baseY);
      drawScoop(ctx, drawX, drawY, colorKey, drawScale, state);
      ctx.restore();
    } else {
      drawScoop(ctx, drawX, drawY, colorKey, drawScale, state);
    }

    // The Scoop-Top sprite frame is the "deliver me next" highlight. Keep the
    // amber ring only as a fallback for when the sheet hasn't loaded.
    if (isTop && !scoopSheet.ready) {
      drawTopRing(ctx, drawX, drawY, SCOOP_RADIUS * drawScale);
    }
  }

  // Cone FRONT — over the scoops, so the bottom scoop nests into the bowl.
  if (coneReady) drawConeFrame(ctx, player, CONE_FRAME.FRONT, coneTint);
  ctx.restore();

  // Launched-scoop ghosts (committed toss): each rises, stretches tall, and fades
  // out over TOSS_GHOST_S — a quick "flung away" flourish. Drawn in world space
  // (after the handoff lean) so a toss mid-reach doesn't drag the ghost sideways.
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
 * Amber selection ring around the top (next-to-be-delivered) scoop. Mirrors the
 * active customer bubble's outline in stations.js (#ffb703 stroke + #ffd166 glow).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r drawn scoop radius
 */
function drawTopRing(ctx, x, y, r) {
  ctx.save();
  glowCircle(ctx, x, y, r + 2.5, '#ffd166');
  ctx.strokeStyle = '#ffb703';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Flat-triangle cone — the fallback drawn only until the cone sheet image loads
 * (the flash halo is drawn by the caller). @param {CanvasRenderingContext2D} ctx @param {Player} player
 */
function drawTriangleCone(ctx, player) {
  const cx = player.x;
  const cy = player.y;
  ctx.save();
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
