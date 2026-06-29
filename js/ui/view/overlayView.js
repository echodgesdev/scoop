// @ts-check
// Screen-text overlays drawn onto the canvas: the "DAY N!" wave banner and the
// debug-pause scrim + label. (The round-start countdown moved to the HUD — see
// nightSky.js.) All styling lives in the constants here. Called from
// renderer.drawFrame inside the shake transform, so each counteracts the
// (ox, oy) offset to stay screen-fixed.

/** @typedef {import('../../game.js').Game} Game */

const TITLE_FONT = "'Cousine', 'Comic Sans MS', sans-serif";
const PLAIN_FONT = 'sans-serif';
const boldFont = (px, family = TITLE_FONT) => `bold ${px}px ${family}`;

const TITLE_FILL   = '#fff3c0';            // the "DAY N!" banner text
const PAUSE_FILL   = '#fff';
const TEXT_OUTLINE = 'rgba(0, 0, 0, 0.5)'; // dark stroke behind the big overlay text
const PAUSE_SCRIM  = 'rgba(0, 0, 0, 0.45)';// dim behind the PAUSED label

const BANNER_SIZE     = 64;
const PAUSE_SIZE      = 52;

const BANNER_Y_FRAC = 0.32;                // text center as a fraction of canvas height
const BANNER_FADE_S = 0.4;                 // banner fades in over its final 0.4s
const PAUSE_LABEL   = '⏸ PAUSED';

/**
 * Stroke-then-fill one line of text with its own save/restore. The single seam
 * for every screen-text overlay, so styling stays in the constants above rather
 * than scattered inline.
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
export function drawBanner(ctx, game, ox, oy) {
  if (!game.banner) return;
  const alpha = Math.min(1, game.banner.t / BANNER_FADE_S);
  drawText(ctx, game.banner.text, game.bounds.width / 2 - ox, game.bounds.height * BANNER_Y_FRAC - oy,
    { font: boldFont(BANNER_SIZE), fill: TITLE_FILL, alpha });
}

/** Dim scrim + "⏸ PAUSED" label (debug-panel pause). @param {CanvasRenderingContext2D} ctx @param {Game} game @param {number} ox @param {number} oy */
export function drawPauseOverlay(ctx, game, ox, oy) {
  if (!(game.paused && game.running)) return;
  ctx.fillStyle = PAUSE_SCRIM;
  ctx.fillRect(-ox, -oy, game.bounds.width, game.bounds.height);
  drawText(ctx, PAUSE_LABEL, game.bounds.width / 2 - ox, game.bounds.height / 2 - oy,
    { font: boldFont(PAUSE_SIZE, PLAIN_FONT), fill: PAUSE_FILL });
}
