// @ts-check
import { CONE_HEIGHT, PICKUP_TYPE, POWERUP_TYPE, GAME_MODE } from './config.js';
import { STATE } from './shop.js';

/** @typedef {import('./game.js').Game} Game */

/**
 * The tutorial is a thin HINT OVERLAY on the real Wave 0 — it doesn't freeze the
 * player, stage customers, or suppress the falling field. Wave 0 (junior flavors
 * only, one of each to clear) is a genuine playable wave; the tutorial just
 * watches real game state and draws contextual prompts.
 *
 * It's swapped by game mode via createTutorial(); the modes differ in how stack
 * management + power-ups read:
 *   Auto    — feather (⚡) demo bubble; catching fires it instantly. ↓ rotates.
 *   Banked  — catch banks → ⇧ Shift to spend. ↓ rotates.
 *   Tipping — no bubbles; power-ups come from customer tips. ↑/Space discards the
 *             top scoop (no rotate); the buried-color fix is "toss the top".
 */
class TutorialBase {
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

    if (stack.length === 0) return { text: 'Catch a falling scoop!', x: px, y: coneTop - 28 };

    const idx = game.shop.customerAt(px);
    if (idx < 0) {
      return { text: touch ? 'Drag to a customer' : '◀  Move to a customer  ▶', x: px, y: underCone };
    }
    if (game.shop.canServe(idx, game.player.colors(), false, game.deliveryMode)) {
      return { text: touch ? 'Tap to serve' : '↑ / Enter — Serve', x: px, y: coneTop - 28 };
    }
    const customer = game.shop.list[idx];
    const wanted = (customer && customer.order.colors) || [];
    const buriedWanted = stack.slice(0, -1).some(s => wanted.includes(s.color));
    if (buriedWanted) {
      return { text: this._buriedHint(touch), x: px, y: coneTop - 28 };
    }
    return { text: 'Catch the flavor they want', x: px, y: underCone };
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
    const power = this._powerHint(game);
    if (power) this._hint(ctx, game.bounds.width / 2, game.bounds.height * 0.18, power);
    const core = this._coreHint(game);
    if (core) this._hint(ctx, core.x, core.y, core.text);
  }

  /** Small dark pill with centered white text. @param {CanvasRenderingContext2D} ctx */
  _hint(ctx, x, y, text) {
    ctx.save();
    ctx.font = "bold 22px 'Comic Sans MS', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 26;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 19, w, 38, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Auto Trigger tutorial: catching a bubble fires it on the spot. */
class AutoTutorial extends TutorialBase {
  /** @param {Game} game */
  _updatePowerLesson(game) {
    if (!this.powerLessonDone && game.powerups.active(POWERUP_TYPE.SPEED)) {
      this.powerLessonDone = true;
    }
  }

  /** @param {Game} game */
  _powerHint(game) {
    if (this.powerLessonDone) return null;
    if (this._featherPresent(game)) {
      return this._touch(game)
        ? 'Swipe up to pop the ⚡ — it fires instantly!'
        : 'Space to pop the ⚡ — it fires instantly!';
    }
    return null;
  }
}

/** Banked Inventory tutorial: catching banks the bubble; ⇧ Shift spends it. */
class BankedTutorial extends TutorialBase {
  /** @param {Game} game */
  _updatePowerLesson(game) {
    if (this.powerLessonDone) return;
    if (!game.powerupMode.queueEmpty()) this._banked = true;
    // Lesson lands once they've banked one and then spent it (speed running).
    if (this._banked && game.powerups.active(POWERUP_TYPE.SPEED)) this.powerLessonDone = true;
  }

  /** @param {Game} game */
  _powerHint(game) {
    if (this.powerLessonDone) return null;
    const touch = this._touch(game);
    if (!game.powerupMode.queueEmpty()) {
      return touch ? 'Tap the queue to use your power-up!' : '⇧ Shift — use your banked power-up!';
    }
    if (!this._banked && this._featherPresent(game)) {
      return touch ? 'Swipe up to pop the ⚡ and bank it!' : 'Space to pop the ⚡ and bank it!';
    }
    return null;
  }
}

/**
 * Tipping tutorial: no bubbles — power-ups arrive as customer tips, and the
 * top scoop is discarded with the upward gesture (no rotate verb).
 */
class TippingTutorial extends TutorialBase {
  /** Buried wanted color: toss the top off (upward) rather than rotate. */
  _buriedHint(touch) {
    return touch ? 'Swipe up to toss the top scoop' : 'Space — toss the top scoop';
  }

  /**
   * Surface the tip concept whenever a waiting customer is carrying one.
   * @param {Game} game
   */
  _powerHint(game) {
    const tipped = game.shop.list.some(c => c.state === STATE.WAITING && c.tip);
    return tipped ? 'Finish a customer with a token — they tip you a reward!' : null;
  }
}

/**
 * Pick the tutorial that matches the active game mode.
 * @param {string} mode one of GAME_MODE (auto | banked | tipping)
 * @returns {TutorialBase}
 */
export function createTutorial(mode) {
  if (mode === GAME_MODE.BANKED) return new BankedTutorial();
  if (mode === GAME_MODE.TIPPING) return new TippingTutorial();
  return new AutoTutorial();
}
