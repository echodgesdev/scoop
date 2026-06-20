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

// === Overlay text styling (banner / round-intro / pause / FPS) ===============
// All of the screen-text styling lives here so it isn't scattered through the
// draw functions below. The font is built from a size + family; the rest are
// fills, outlines, and vertical anchors (fractions of canvas height).
const TITLE_FONT = "'Comic Sans MS', sans-serif";
const PLAIN_FONT = 'sans-serif';
const MONO_FONT  = "'Consolas', monospace";
const boldFont = (px, family = TITLE_FONT) => `bold ${px}px ${family}`;

const TITLE_FILL   = '#fff3c0';            // banner + round-intro words/numbers
const START_FILL   = '#8ef0a8';            // the round-intro "START!" beat
const PAUSE_FILL   = '#fff';
const FPS_FILL     = '#39ff14';
const TEXT_OUTLINE = 'rgba(0, 0, 0, 0.5)'; // dark stroke behind the big overlay text
const FPS_OUTLINE  = 'rgba(0, 0, 0, 0.6)';
const PAUSE_SCRIM  = 'rgba(0, 0, 0, 0.45)';// dim behind the PAUSED label
const HURT_RGB       = '230, 57, 70';      // damage-flash tint (alpha is dynamic)
const HURT_MAX_ALPHA = 0.35;
const HURT_REF_S     = 0.3;                // game.hurt is seeded to ~0.3 on damage

const BANNER_SIZE     = 64;
const INTRO_NUM_SIZE  = 130;               // "3" / "2" / "1"
const INTRO_WORD_SIZE = 60;                // "Week N" / "START!"
const PAUSE_SIZE      = 52;
const FPS_SIZE        = 20;

const BANNER_Y_FRAC = 0.32;                // text center as a fraction of canvas height
const INTRO_Y_FRAC  = 0.40;
const BANNER_FADE_S = 0.4;                 // banner fades in over its final 0.4s
const START_LABEL   = 'START!';            // round-intro beat that turns green
const PAUSE_LABEL   = '⏸ PAUSED';
const FPS_X = 12, FPS_Y = 12;

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
    canServe:       i => world.shop.canServe(i, world.player.colors(), rainbow),
    pausePatience,
    rainbow,
    time:           game.clock,
    tipLabel:       game.tutorial.active,
    coneX:          world.player.drawX(alpha),  // fades a bubble translucent as the cone passes behind it
    alpha
  });
  // Tutorial hint pills — over the scene but under the effect bursts.
  if (game.tutorial.active) game.tutorial.draw(ctx, game);
  game.effects.draw(ctx);

  if (game.flags.showHitboxes) drawHitboxes(ctx, game);

  // Screen-text overlays + flashes — all still inside the shake transform, so each
  // counteracts the (x, y) offset to stay screen-fixed.
  drawBanner(ctx, game, x, y);
  drawRoundIntro(ctx, game, x, y);
  drawHurtFlash(ctx, game, x, y);
  drawPauseOverlay(ctx, game, x, y);

  ctx.restore();   // pop the shake transform

  // Screen-fixed (drawn after the shake transform is popped).
  drawActivePowerup(ctx, game);
  drawFps(ctx, game);
}

/**
 * Stroke-then-fill one line of text with its own save/restore. The single seam
 * for every screen-text overlay (banner, round-intro, pause label, FPS readout),
 * so styling stays in the constants above rather than scattered inline.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} cx @param {number} cy  anchor (interpretation set by align/baseline)
 * @param {{ font: string, fill: string, stroke?: string, lineWidth?: number, align?: CanvasTextAlign, baseline?: CanvasTextBaseline, alpha?: number }} style
 */
function drawText(ctx, text, cx, cy, { font, fill, stroke = TEXT_OUTLINE, lineWidth = 8, align = 'center', baseline = 'middle', alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.font = font;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = fill;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

/** "DAY N!" / wave banner — fades in over its final BANNER_FADE_S. @param {CanvasRenderingContext2D} ctx @param {Game} game @param {number} ox @param {number} oy */
function drawBanner(ctx, game, ox, oy) {
  if (!game.banner) return;
  const alpha = Math.min(1, game.banner.t / BANNER_FADE_S);
  drawText(ctx, game.banner.text, game.bounds.width / 2 - ox, game.bounds.height * BANNER_Y_FRAC - oy,
    { font: boldFont(BANNER_SIZE), fill: TITLE_FILL, alpha });
}

/** Round-start intro: a big "Week N" title (day 1) then the 3·2·1·START! countdown. @param {CanvasRenderingContext2D} ctx @param {Game} game @param {number} ox @param {number} oy */
function drawRoundIntro(ctx, game, ox, oy) {
  const text = game.roundIntroLabel && game.roundIntroLabel();
  if (!text) return;
  const isNum = /^[0-9]$/.test(text);
  drawText(ctx, text, game.bounds.width / 2 - ox, game.bounds.height * INTRO_Y_FRAC - oy, {
    font: boldFont(isNum ? INTRO_NUM_SIZE : INTRO_WORD_SIZE),
    fill: text === START_LABEL ? START_FILL : TITLE_FILL,
    lineWidth: 10
  });
}

/** Full-screen red tint when the player just took damage. @param {CanvasRenderingContext2D} ctx @param {Game} game @param {number} ox @param {number} oy */
function drawHurtFlash(ctx, game, ox, oy) {
  if (game.hurt <= 0) return;
  ctx.fillStyle = `rgba(${HURT_RGB}, ${HURT_MAX_ALPHA * (game.hurt / HURT_REF_S)})`;
  ctx.fillRect(-ox, -oy, game.bounds.width, game.bounds.height);
}

/** Dim scrim + "⏸ PAUSED" label (debug-panel pause). @param {CanvasRenderingContext2D} ctx @param {Game} game @param {number} ox @param {number} oy */
function drawPauseOverlay(ctx, game, ox, oy) {
  if (!(game.paused && game.running)) return;
  ctx.fillStyle = PAUSE_SCRIM;
  ctx.fillRect(-ox, -oy, game.bounds.width, game.bounds.height);
  drawText(ctx, PAUSE_LABEL, game.bounds.width / 2 - ox, game.bounds.height / 2 - oy,
    { font: boldFont(PAUSE_SIZE, PLAIN_FONT), fill: PAUSE_FILL });
}

/** Top-left FPS + live-scoop readout (debug). @param {CanvasRenderingContext2D} ctx @param {Game} game */
function drawFps(ctx, game) {
  if (!game.flags.showFps) return;
  const label = `${Math.round(game.fps)} fps  scoops:${game.world.field.scoops.length}`;
  drawText(ctx, label, FPS_X, FPS_Y,
    { font: boldFont(FPS_SIZE, MONO_FONT), fill: FPS_FILL, stroke: FPS_OUTLINE, lineWidth: 4, align: 'left', baseline: 'top' });
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
