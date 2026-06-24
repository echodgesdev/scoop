// @ts-check
import {
  CONE,
  SCOOP,
  SERVE
} from './config.js';

/** @typedef {import('../types.js').ScoopColor} ScoopColor */
/** @typedef {import('../types.js').Bounds} Bounds */
/** @typedef {import('../types.js').Hitbox} Hitbox */
/** @typedef {import('../engine/input.js').Input} Input */

// Time a freshly-caught scoop spends "landing" (squash-pop). Read by the view
// to size the squash; lives here because push() stamps it onto each scoop.
export const LAND_TIME = 0.22;

// Toss feedback (presentation, read by the view). A committed toss launches a
// brief stretch-and-fade GHOST of the popped scoop; a too-short up-flick that
// didn't commit squashes the top scoop back to size. Durations live here so the
// view drives the same curve length the model culls on.
export const TOSS_GHOST_S = 0.22;  // launched-scoop ghost lifetime (snappy fade)
export const TOSS_BUMP_S  = 0.30;  // squash-back bounce duration

// Fake scoop "slosh" — NOT physics. A single loose damped-spring scalar leans
// the scoop column opposite to the cone's motion (drag), then settles with a
// soft wobble. The lean is derived from the cone's real per-frame displacement
// (so it works for keyboard AND touch, which moves x directly). The per-tick
// lean history is recorded into a ring buffer so the VIEW can give higher scoops
// an older lean (the trailing "swoosh"); SLOSH_HIST is its length, exported so
// the view indexes the same buffer.
const SLOSH_LEAN  = 0.016;  // px of lean per px/s of cone speed
const SLOSH_MAX   = 10.4;   // cap (px) so fast flicks don't fling scoops off
const SLOSH_STIFF = 70;     // spring follow strength (lower = looser / less stiff)
const SLOSH_DAMP  = 0.84;   // velocity kept per tick (higher = floatier / wobblier)
export const SLOSH_HIST = 48;  // lean-history ring buffer length (ticks)

// Idle hover — NOT physics. When the cone isn't being driven left/right it gently
// bobs up and down. The amplitude eases IN while idle and OUT while moving (so there's
// no snap), the phase runs continuously, and the view reads the resulting hoverY.
const HOVER_PX       = 5;    // bob height (px, peak)
const HOVER_SPEED    = 3.4;  // rad/s — bob frequency (~0.5 Hz)
const HOVER_EASE     = 6;    // amplitude ease rate (per second)
const HOVER_MOVE_EPS = 6;    // px/s of real movement below which the cone counts as idle

/**
 * The cone the player drives. PURE MODEL: state, movement, and tray queries —
 * no rendering. The drawing lives in view/playerView.js, which reads this
 * object's position, stack, slosh history, handoff lean, and flash.
 */
export class Player {
  /** @param {number} x @param {number} y */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    /** @type {{ color: ScoopColor, land: number }[]} */
    this.stack = [];
    this.flash = 0;

    // Fake-slosh state (see SLOSH_* above). _prevX tracks last frame's x to read
    // the cone's real velocity; slosh/sloshV are the damped-spring lean + its
    // rate; _sloshHist is a ring buffer of recent lean values (one per physics
    // tick) so the view can sample an older lean for the trailing tail.
    this._prevX = x;
    this.slosh = 0;
    this.sloshV = 0;
    this._sloshHist = new Float64Array(SLOSH_HIST);
    this._sloshHead = 0;

    // Brief lean toward a customer during a serve. Set by triggerHandoff();
    // peaks halfway through SERVE.HANDOFF_DURATION_S and snaps back to 0.
    this.handoffDx = 0;
    this.handoffDy = 0;
    this.handoffT = SERVE.HANDOFF_DURATION_S; // start "done" — no lean at game start

    // Hard movement freeze (tutorial intro). Doesn't tick down; the game clears
    // it when control is handed over.
    this.frozen = false;

    // Presentation-only: when the cone fractures on game over, the view stops
    // drawing it (the debris lives in Effects). Cleared on reset.
    this.fractured = false;

    // Toss feedback (presentation; see TOSS_* above). `tossed` holds launched-
    // scoop ghosts (each stores its launch point + age; the view derives the
    // rise/stretch/fade). `tossBump` counts down a squash-back bounce on the top
    // scoop after a canceled (too-short) up-flick.
    /** @type {{ color: ScoopColor, x: number, y: number, t: number }[]} */
    this.tossed = [];
    this.tossBump = 0;

    // Idle hover (presentation; see HOVER_* above). hoverY is the vertical bob the
    // view adds to the cone; it eases in when the cone stops and out when it moves.
    this.hoverT = 0;
    this.hoverAmp = 0;
    this.hoverY = 0;
  }

  /**
   * Lean briefly toward (targetX, targetY) — a "reaching to hand off" gesture.
   * Direction is normalized so the lean depth (SERVE.HANDOFF_REACH) is consistent
   * regardless of distance.
   * @param {number} targetX
   * @param {number} targetY
   */
  triggerHandoff(targetX, targetY) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.handoffDx = (dx / dist) * SERVE.HANDOFF_REACH;
    this.handoffDy = (dy / dist) * SERVE.HANDOFF_REACH;
    this.handoffT = 0;
  }

  /** @param {number} x @param {number} y */
  reposition(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    // Snap the slosh to rest so a reposition (resize / wave reset) doesn't fling
    // the scoops.
    this._prevX = x;
    this.slosh = 0;
    this.sloshV = 0;
    this._sloshHist.fill(0);
    this._sloshHead = 0;
    this.hoverT = 0;
    this.hoverAmp = 0;
    this.hoverY = 0;
  }

  /**
   * Advance the fake scoop-slosh spring. Driven by the cone's REAL velocity
   * (per-frame displacement), so it works under every movement scheme. The
   * column leans opposite to motion, then springs back through 0 with a gentle
   * wobble when the cone slows or reverses. @param {number} dt @param {number} vx
   */
  _tickSlosh(dt, vx) {
    const target = Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, -vx * SLOSH_LEAN));
    this.sloshV += (target - this.slosh) * SLOSH_STIFF * dt;
    this.sloshV *= Math.pow(SLOSH_DAMP, dt * 60);
    this.slosh += this.sloshV * dt;
    // Record this tick's lean so the view can read an older value for higher scoops.
    this._sloshHead = (this._sloshHead + 1) % SLOSH_HIST;
    this._sloshHist[this._sloshHead] = this.slosh;
  }

  /**
   * Idle hover: the cone gently bobs while it isn't being driven left/right. The
   * amplitude eases in (idle) / out (moving or frozen) so there's no snap; the phase
   * runs continuously. The view reads hoverY.
   * @param {number} dt @param {number} vx the cone's real per-frame velocity
   */
  _tickHover(dt, vx) {
    const idle = !this.frozen && Math.abs(vx) < HOVER_MOVE_EPS;
    this.hoverT += dt * HOVER_SPEED;
    this.hoverAmp += ((idle ? 1 : 0) - this.hoverAmp) * Math.min(1, dt * HOVER_EASE);
    this.hoverY = -Math.sin(this.hoverT) * HOVER_PX * this.hoverAmp;
  }

  /**
   * @param {number} dt
   * @param {Input} input
   * @param {Bounds} bounds
   * @param {number} [speedMult]
   */
  update(dt, input, bounds, speedMult = 1) {
    // Always tick passive timers (flash, handoff lean, land squash) so visual
    // decay continues even while frozen.
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.handoffT < SERVE.HANDOFF_DURATION_S) this.handoffT += dt;
    if (this.tossBump > 0) this.tossBump = Math.max(0, this.tossBump - dt);
    for (let i = this.tossed.length - 1; i >= 0; i--) {
      const g = this.tossed[i];
      g.t += dt;
      if (g.t >= TOSS_GHOST_S) this.tossed.splice(i, 1);
    }
    for (const s of this.stack) {
      if (s.land > 0) s.land = Math.max(0, s.land - dt);
    }

    // Slosh runs every frame (before any early return) off the cone's real
    // displacement last frame, so it keeps settling even while frozen.
    const movedVx = dt > 0 ? (this.x - this._prevX) / dt : 0;
    this._prevX = this.x;
    this._tickSlosh(dt, movedVx);
    this._tickHover(dt, movedVx);

    if (this.frozen) {
      // Tutorial freeze: passive timers above still ran; just don't move.
      this.vx = 0;
      return;
    }

    const maxV  = CONE.MAX_SPEED * speedMult;
    const halfW = CONE.WIDTH / 2;

    // Relative touch steering: apply the dragged delta directly (1:1 × gain),
    // then consume it. Uncapped — small thumb travel moves the cone far, which
    // is the whole point. Cleared each frame so a still finger holds position.
    if (input.moveDelta !== 0) {
      this.x = Math.max(halfW, Math.min(bounds.width - halfW, this.x + input.moveDelta));
      input.moveDelta = 0;
      this.vx = 0;
      return;
    }

    const accel = CONE.ACCEL * speedMult;
    const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (dir !== 0) {
      // Hold longer -> ramp up toward the speed cap.
      this.vx += dir * accel * dt;
      this.vx = Math.max(-maxV, Math.min(maxV, this.vx));
    } else {
      // Coast to a stop when nothing is held.
      const drop = CONE.FRICTION * dt;
      this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
    }

    this.x += this.vx * dt;
    if (this.x < halfW) { this.x = halfW; this.vx = 0; }
    if (this.x > bounds.width - halfW) { this.x = bounds.width - halfW; this.vx = 0; }
  }

  /**
   * X interpolated between the last two sim steps — what the view should draw.
   * `_prevX` is stamped at the top of every update() (it also feeds the slosh),
   * so it is exactly the previous step's settled position.
   * @param {number} alpha leftover sim-step fraction from the render loop (0..1)
   */
  drawX(alpha) {
    return this._prevX + (this.x - this._prevX) * alpha;
  }

  coneTopY() {
    return this.y - CONE.HEIGHT / 2;
  }

  stackTopY() {
    return this.coneTopY() - this.stack.length * SCOOP.SPACING;
  }

  /** @param {number} index */
  scoopPosition(index) {
    return {
      x: this.x,
      y: this.coneTopY() - index * SCOOP.SPACING - SCOOP.RADIUS * 0.2
    };
  }

  catchHitbox() {
    // Catch band follows the scoop body's half-extents (so a rect body isn't
    // forced into a circle). For a circle body SCOOP.HALF_W/H both equal the
    // radius, so this matches the previous behavior exactly.
    return {
      x: this.x,
      y: this.stackTopY(),
      r: SCOOP.HALF_H,
      halfW: CONE.WIDTH / 2 + SCOOP.HALF_W * 0.4
    };
  }

  /** @param {ScoopColor} color */
  push(color) {
    this.stack.push({ color, land: LAND_TIME });
  }

  /** Pop the top scoop off the tray. Returns true if one was removed. */
  popTop() {
    if (this.stack.length === 0) return false;
    this.stack.pop();
    return true;
  }

  /** Empty the tray (consumes a served order / wave reset). */
  clearStack() {
    this.stack = [];
  }

  /** All stack colors, bottom-to-top. */
  colors() {
    return this.stack.map(s => s.color);
  }

  /** @param {number} [duration] */
  triggerFlash(duration = 0.4) {
    this.flash = duration;
  }

  /**
   * A committed toss: launch a stretch-and-fade ghost of the just-popped scoop
   * from where it sat. Presentation only — the sim already removed the scoop.
   * @param {ScoopColor} color @param {number} x @param {number} y
   */
  launchToss(color, x, y) {
    this.tossed.push({ color, x, y, t: 0 });
  }

  /** A canceled (too-short) up-flick: squash the top scoop back to its size. */
  bumpToss() {
    this.tossBump = TOSS_BUMP_S;
  }
}
