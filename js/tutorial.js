// @ts-check
import {
  COLOR_KEYS,
  CONE_HEIGHT,
  PICKUP_RADIUS,
  PICKUP_BUBBLE_RADIUS_MULT
} from './config.js';
import { drawScoop } from './player.js';
import { pickupCaught } from './pickups.js';
import { projectileHits } from './projectiles.js';
import { STATE } from './shop.js';

/** @typedef {import('./types.js').ScoopColor} ScoopColor */

const COIN_SPEED = 70;        // px/s drift — slow so it lingers in reach
const COIN_Y_RATIO = 0.34;    // sits in the sky, mostly shoot-only
const PLOP_FALL_S = 0.5;      // per-scoop fade-in + drop
const PLOP_GAP_S = 0.18;      // beat between plops
const SHOOT_HINT_RANGE = 90;  // |coin.x - cone.x| under which "shoot" reads

const easeIn = t => t * t;

/**
 * Scripted onboarding. Drives a state machine that teaches the four verbs in
 * order: move + serve, then shoot + activate. Plays on a first-time flag at
 * wave 1, or on demand from the "How to Play" button. Reaches into `game`
 * directly — it's a coordinator, not a pure system.
 *
 * Phases: intro → plopOrder → awaitServe → awaitShoot → done.
 *   intro        freeze, stage a customer, wait for its bubble
 *   plopOrder    drop 3 scoops in: the two wanted (A,B) with a blocker (X) in
 *                the middle, so reaching the second order scoop needs a rotate
 *   awaitServe   unlock move/serve/rotate (NOT shoot, so you can't strand
 *                yourself); serve the customer. The leftover X becomes ammo.
 *   awaitShoot   coin floats; shoot the leftover scoop at it → it pops for a
 *                bonus and the tutorial finishes (power-ups fire on contact, so
 *                there's nothing extra to "activate")
 */
export class Tutorial {
  constructor() {
    this.active = false;
    this.phase = 'done';
    this.timer = 0;
    /** @type {import('./types.js').Customer | null} */
    this.customer = null;
    /** @type {ScoopColor[]} colors still to drop into the tray */
    this.plopQueue = [];
    /** @type {{ color: ScoopColor, t: number } | null} */
    this.ghost = null;
    /** @type {{ x: number, y: number, vx: number, bob: number } | null} */
    this.coin = null;
    /** @type {ScoopColor} */
    this.ammoColor = COLOR_KEYS[0];
  }

  /** @param {import('./game.js').Game | any} game */
  start(game) {
    this.active = true;
    this.phase = 'intro';
    this.timer = 0;
    this.ghost = null;
    this.coin = null;

    // Three distinct colors: two the customer wants, one "ammo" to slingshot.
    const keys = COLOR_KEYS.slice();
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const order = [keys[0], keys[1]];
    this.ammoColor = keys[2];
    // Tray bottom→top: A, X(blocker), B. Serving B then needing A forces a
    // rotate past X. X is never wanted, so it survives as slingshot ammo.
    this.plopQueue = [order[0], this.ammoColor, order[1]];

    const slot = Math.random() < 0.5 ? 1 : 3;  // one step left/right of center
    game.shop.scripted = true;
    game.player.frozen = true;
    this.customer = game.shop.spawnScripted(slot, order, 180, 1);
  }

  /**
   * @param {number} dt
   * @param {import('./game.js').Game | any} game
   */
  update(dt, game) {
    if (!this.active) return;
    this.timer += dt;

    switch (this.phase) {
      case 'intro':
        if (this.customer && this.customer.state === STATE.WAITING && this.timer > 0.5) {
          this.phase = 'plopOrder';
          this.timer = PLOP_GAP_S;
        }
        break;

      case 'plopOrder':
        if (this._advancePlop(dt, game)) {
          this.phase = 'awaitServe';
          game.player.frozen = false;  // hand over control to serve
        }
        break;

      case 'awaitServe':
        // During the tutorial nothing else can make the customer leave, so a
        // LEAVING state means it was served. The leftover blocker scoop stays
        // in the tray and becomes the slingshot ammo.
        if (this.customer && this.customer.state === STATE.LEAVING) {
          this._spawnCoin(game);
          this.phase = 'awaitShoot';
        }
        break;

      case 'awaitShoot':
        // Respawn the coin if it drifts past un-shot, so this can't soft-lock.
        if (!this.coin) this._spawnCoin(game);
        else this._moveCoin(dt, game);
        break;
    }
  }

  /**
   * Advance the current plop batch. Returns true once every queued scoop has
   * been committed to the tray. The ghost tracks the live cone x so it still
   * lands correctly if the (unfrozen) player is moving.
   * @param {number} dt @param {any} game
   */
  _advancePlop(dt, game) {
    if (this.ghost) {
      this.ghost.t += dt / PLOP_FALL_S;
      if (this.ghost.t >= 1) {
        game.player.push(this.ghost.color);  // commit → land-squash "plop"
        game.effects.burst(game.player.x, game.player.stackTopY(), [game.shop.hex(this.ghost.color), '#fff'], 8);
        game.sound.catch_();
        this.ghost = null;
        this.timer = 0;
      }
      return false;
    }
    if (this.plopQueue.length === 0) return true;
    if (this.timer >= PLOP_GAP_S) this.ghost = { color: /** @type {ScoopColor} */ (this.plopQueue.shift()), t: 0 };
    return false;
  }

  /**
   * The slingshot is blocked until the shoot step — otherwise the player can
   * fire away the scoops they need to serve and strand themselves (the falling
   * field is suppressed during the tutorial, so there's no recovery).
   */
  allowsShoot() {
    return this.phase === 'awaitShoot';
  }

  /** @param {any} game */
  _spawnCoin(game) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    this.coin = {
      x: dir > 0 ? -PICKUP_RADIUS * 2 : game.bounds.width + PICKUP_RADIUS * 2,
      y: game.bounds.height * COIN_Y_RATIO,
      vx: dir * COIN_SPEED,
      bob: Math.random() * Math.PI * 2
    };
  }

  /** @param {number} dt @param {any} game */
  _moveCoin(dt, game) {
    const coin = this.coin;
    if (!coin) return;
    coin.x += coin.vx * dt;
    coin.bob += dt * 1.8;

    // Caught by the cone/stack OR struck by a slingshot shot → pop it.
    if (pickupCaught(coin, game.player.pickupHitbox())) { this._hitCoin(game); return; }
    for (let i = game.projectiles.list.length - 1; i >= 0; i--) {
      if (projectileHits(game.projectiles.list[i], coin)) {
        game.projectiles.list.splice(i, 1);
        this._hitCoin(game);
        return;
      }
    }

    const m = PICKUP_RADIUS * 3;
    if (coin.x < -m || coin.x > game.bounds.width + m) this.coin = null;  // respawned next tick
  }

  /**
   * Coin popped (caught or shot). Power-ups fire on contact, so the coin just
   * awards a small score bonus on the spot and ends the tutorial — there's no
   * separate "activate" step to teach.
   * @param {any} game
   */
  _hitCoin(game) {
    const { x, y } = this.coin || { x: game.player.x, y: 0 };
    game.effects.burst(x, y, ['#ffd700', '#fff7c0', '#ffffff'], 18);
    game.effects.popText(x, y - 10, '+5', { color: '#ffd700', size: 24 });
    game.shop.addScore(5);
    game.hud.setScore(game.shop.score);
    game.sound.bubblePop();
    this.coin = null;
    this._finish(game);
  }

  /** @param {any} game */
  _finish(game) {
    this.active = false;
    this.phase = 'done';
    this.coin = null;
    this.ghost = null;
    game.shop.scripted = false;   // hand the shop back to the wave director
    game.player.frozen = false;
    game.markTutorialSeen();
  }

  /**
   * Draw the plopping scoop, the coin, and the contextual control hints. Called
   * inside the world (shake) transform so positions line up with the actors.
   * @param {CanvasRenderingContext2D} ctx
   * @param {any} game
   */
  draw(ctx, game) {
    if (!this.active) return;

    if (this.ghost) {
      const tgt = game.player.scoopPosition(game.player.stack.length);
      const startY = tgt.y - 150;
      const y = startY + (tgt.y - startY) * easeIn(this.ghost.t);
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.ghost.t * 2);
      drawScoop(ctx, game.player.x, y, this.ghost.color);
      ctx.restore();
    }

    if (this.coin) this._drawCoin(ctx);

    this._drawHints(ctx, game);
  }

  /** @param {CanvasRenderingContext2D} ctx */
  _drawCoin(ctx) {
    const coin = this.coin;
    if (!coin) return;
    const cy = coin.y + Math.sin(coin.bob) * 4;
    const br = PICKUP_RADIUS * PICKUP_BUBBLE_RADIUS_MULT;
    ctx.save();
    // Bubble.
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(coin.x, cy, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Drawn coin disc (the emoji doesn't render reliably).
    ctx.fillStyle = '#ffcf3a';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(coin.x, cy, PICKUP_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7a5500';
    ctx.font = `bold ${Math.floor(PICKUP_RADIUS * 0.9)}px 'Comic Sans MS', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', coin.x, cy + 1);
    ctx.restore();
  }

  /** @param {CanvasRenderingContext2D} ctx @param {any} game */
  _drawHints(ctx, game) {
    const px = game.player.x;
    const coneTop = game.player.coneTopY();
    const underCone = game.player.y + CONE_HEIGHT / 2 + 36;

    if (this.phase === 'awaitServe') {
      const inRange = game.shop.customerAt(px) >= 0;
      const stack = game.player.stack;
      const top = stack.length ? stack[stack.length - 1].color : null;
      const wanted = this.customer ? this.customer.order.colors : [];
      const topWanted = top != null && wanted.includes(top);
      const buriedWanted = stack.slice(0, -1).some(s => wanted.includes(s.color));
      if (!inRange) {
        this._hint(ctx, px, underCone, '◀  Move  ▶');
      } else if (topWanted) {
        this._hint(ctx, px, coneTop - 28, '↑ / Enter — Serve');
      } else if (buriedWanted) {
        this._hint(ctx, px, coneTop - 28, '↓ — Rotate to dig it up');
      } else {
        this._hint(ctx, px, underCone, '◀  Move  ▶');
      }
    } else if (this.phase === 'awaitShoot') {
      if (this.coin && Math.abs(this.coin.x - px) < SHOOT_HINT_RANGE) {
        this._hint(ctx, px, coneTop - 40, 'Space — Shoot the coin!');
      } else {
        this._hint(ctx, px, underCone, '◀  Move under the coin  ▶');
      }
    }
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
