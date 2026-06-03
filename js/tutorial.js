// @ts-check
import { CONE_HEIGHT, PICKUP_TYPE } from './config.js';

/** @typedef {import('./game.js').Game} Game */

/**
 * Shared base for the per-mode tutorials. The tutorial is a thin HINT OVERLAY on
 * the real Wave 0 — it doesn't freeze the player, stage customers, or suppress
 * the falling field; Wave 0 (junior flavors only, one of each to clear) is a
 * genuine playable wave, and the tutorial just watches live game state and draws
 * contextual prompts.
 *
 * Each game mode subclasses this in its own modes/<id>.js (overriding the
 * power-up hint + the buried-color fix) and returns it from makeTutorial().
 */
export class TutorialBase {
  constructor() {
    this.active = false;
    this.powerLessonDone = false;
    this._banked = false;     // banked-mode: has the player banked at least one?
    this._demoArmed = false;  // has the demo bubble been released (post first serve)?
  }

  /** @param {Game} game */
  start(game) {
    this.active = true;
    this.powerLessonDone = false;
    this._banked = false;
    this._demoArmed = false;
  }

  /** @param {number} dt @param {Game} game */
  update(dt, game) {
    if (!this.active) return;
    // Wave 0 cleared (the director advanced) → onboarding is done.
    if (game.waves.wave !== 0) { this._finish(); return; }
    // Hold demo bubbles until the first order is served (Game._bubbleTypes gates
    // the spawn); the moment it's served, surface the demo bubble promptly.
    if (!this._demoArmed && game.waves.servedColors.size >= 1) {
      this._demoArmed = true;
      game.pickups.spawnTimer = Math.min(game.pickups.spawnTimer, 1.2);
    }
    this._updatePowerLesson(game);
  }

  /**
   * Hints are done (Wave 0 cleared). Whether the tutorial returns next run is
   * decided by challenge progress in Game, so there's nothing to persist here.
   */
  _finish() {
    this.active = false;
  }

  /** Mode-specific: advance the power-up lesson from real state. @param {Game} game */
  _updatePowerLesson(game) {}

  /** Mode-specific: the power-up prompt string, or null. @param {Game} game */
  _powerHint(game) { return null; }

  /** @param {Game} game */
  _featherPresent(game) {
    return game.pickups.items.some(p => p.type === PICKUP_TYPE.FEATHER);
  }

  /** True when the player is currently driving with touch (vs keyboard). */
  _touch(game) { return game.input.lastWasTouch; }

  /**
   * Core move/serve prompt, keyed off live game state and the active input
   * (gesture wording on touch, key names on keyboard).
   * @param {Game} game @returns {{ text: string, x: number, y: number } | null}
   */
  _coreHint(game) {
    const px = game.player.x;
    const stack = game.player.stack;
    const coneTop = game.player.coneTopY();
    const underCone = game.player.y + CONE_HEIGHT / 2 + 36;
    const touch = this._touch(game);

    if (stack.length === 0) return { text: 'Catch a falling scoop!', x: px, y: coneTop - 28, point: 'down' };

    const idx = game.shop.customerAt(px);
    if (idx < 0) {
      return { text: touch ? 'Drag to a customer' : '◀  Move to a customer  ▶', x: px, y: underCone, point: 'up' };
    }
    if (game.shop.canServe(idx, game.player.colors(), false, game.deliveryMode)) {
      return { text: touch ? 'Tap to serve' : '↑ / Enter — Serve', x: px, y: coneTop - 28, point: 'down' };
    }
    const customer = game.shop.list[idx];
    const wanted = (customer && customer.order.colors) || [];
    const buriedWanted = stack.slice(0, -1).some(s => wanted.includes(s.color));
    if (buriedWanted) {
      return { text: this._buriedHint(touch), x: px, y: coneTop - 28, point: 'down' };
    }
    return { text: 'Catch the flavor they want', x: px, y: underCone, point: 'up' };
  }

  /**
   * Prompt for "the wanted color is buried under the top scoop". Base modes
   * rotate the stack; Tipping discards the top instead (overridden).
   * @param {boolean} touch
   */
  _buriedHint(touch) {
    return touch ? 'Swipe down to dig it up' : '↓ — Rotate to dig it up';
  }

  /** @param {CanvasRenderingContext2D} ctx @param {Game} game */
  draw(ctx, game) {
    if (!this.active) return;
    const t = game.clock || 0;
    const power = this._powerHint(game);
    if (power) this._hint(ctx, game.bounds.width / 2, game.bounds.height * 0.18, power, { t, accent: '#ffd166' });
    const core = this._coreHint(game);
    if (core) this._hint(ctx, core.x, core.y, core.text, { t, accent: '#5cd8ff', point: core.point });
  }

  /**
   * A big, glowing, gently-bobbing prompt pill with a caret pointing at its
   * target — readable at arm's length and visually alive, vs. the old flat chip.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y centre of the pill (target anchor)
   * @param {string} text
   * @param {{ t?: number, accent?: string, point?: 'up' | 'down' | null }} [opts]
   */
  _hint(ctx, x, y, text, { t = 0, accent = '#ffffff', point = null } = {}) {
    const bob = Math.sin(t * 3) * 4;        // float for life
    const cy = y + bob;
    ctx.save();
    ctx.font = "bold 27px 'Comic Sans MS', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 42;
    const h = 50;
    const left = x - w / 2;
    const topY = cy - h / 2;

    // Caret pointing at the target (drawn first, under the pill body). Filled in
    // the accent/outline color so its infill matches the pill's border.
    const caret = 10 + 4 * (0.5 + 0.5 * Math.sin(t * 6));  // pulses to draw the eye
    ctx.fillStyle = accent;
    if (point === 'down') {
      ctx.beginPath();
      ctx.moveTo(x - 13, topY + h - 2);
      ctx.lineTo(x + 13, topY + h - 2);
      ctx.lineTo(x, topY + h + caret);
      ctx.closePath();
      ctx.fill();
    } else if (point === 'up') {
      ctx.beginPath();
      ctx.moveTo(x - 13, topY + 2);
      ctx.lineTo(x + 13, topY + 2);
      ctx.lineTo(x, topY - caret);
      ctx.closePath();
      ctx.fill();
    }

    // Pill body — dark gradient slab with an accent glow + border.
    const grad = ctx.createLinearGradient(0, topY, 0, topY + h);
    grad.addColorStop(0, 'rgba(38, 38, 52, 0.94)');
    grad.addColorStop(1, 'rgba(14, 14, 22, 0.94)');
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(left, topY, w, h, 18);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // Text.
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, cy);
    ctx.restore();
  }
}
