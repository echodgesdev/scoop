// @ts-check
import {
  COLORS,
  CONE_WIDTH,
  CONE_HEIGHT,
  CONE_MAX_SPEED,
  CONE_ACCEL,
  CONE_FRICTION,
  SCOOP_RADIUS,
  SCOOP_SPACING,
  HANDOFF_REACH,
  HANDOFF_DURATION_S,
  ROTATE_LOCK_S,
  ROTATE_ARC_OUT_PX
} from './config.js';

/** @typedef {import('./types.js').ScoopColor} ScoopColor */
/** @typedef {import('./types.js').Bounds} Bounds */
/** @typedef {import('./types.js').Hitbox} Hitbox */
/** @typedef {import('./input.js').Input} Input */

const LAND_TIME = 0.22;

// Fake scoop "slosh" — NOT physics. A single loose damped-spring scalar leans
// the scoop column opposite to the cone's motion (drag), then settles with a
// soft wobble. The lean is derived from the cone's real per-frame displacement
// (so it works for keyboard AND touch, which moves x directly).
//
// The TRAIL: each scoop up the stack samples that lean from a few physics ticks
// EARLIER, and its amplitude follows a sideways natural-log ARC — flat at the
// base (the bottom scoop stays locked to the cone) and bowing out with
// increasing curvature toward the top, so the column reads as one graceful
// swoosh trailing behind. The physics tick is a fixed 1/60s, so the tick-based
// delay is frame-stable.
const SLOSH_LEAN  = 0.016;  // px of lean per px/s of cone speed
const SLOSH_MAX   = 10.4;   // cap (px) so fast flicks don't fling scoops off
const SLOSH_STIFF = 70;     // spring follow strength (lower = looser / less stiff)
const SLOSH_DAMP  = 0.84;   // velocity kept per tick (higher = floatier / wobblier)
const SLOSH_LAG   = 2.4;    // ticks of extra delay per scoop above the bottom
const SLOSH_ARC   = 6;      // log-arc curvature (higher = sharper bow near the top)
const SLOSH_HIST  = 48;     // lean-history ring buffer length (ticks)

export class Player {
  /** @param {number} x @param {number} y */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    /** @type {{ color: ScoopColor, land: number, slideFromIdx?: number, slideT?: number }[]} */
    this.stack = [];
    this.flash = 0;

    // Fake-slosh state (see SLOSH_* above). _prevX tracks last frame's x to read
    // the cone's real velocity; slosh/sloshV are the damped-spring lean + its
    // rate; _sloshHist is a ring buffer of recent lean values (one per physics
    // tick) so higher scoops can sample an older lean for the trailing tail.
    this._prevX = x;
    this.slosh = 0;
    this.sloshV = 0;
    this._sloshHist = new Float64Array(SLOSH_HIST);
    this._sloshHead = 0;

    // Brief lean toward a customer during a serve. Set by triggerHandoff();
    // peaks halfway through HANDOFF_DURATION_S and snaps back to 0.
    this.handoffDx = 0;
    this.handoffDy = 0;
    this.handoffT = HANDOFF_DURATION_S; // start "done" — no lean at game start

    // Rotate lock. While > 0 the cone is "busy" — no movement, no catches,
    // no pop, no deliver, no further rotate. Each scoop also has slideT /
    // slideFromIdx so we can animate it from its previous slot.
    this.lockT = 0;

    // Hard movement freeze (tutorial intro). Unlike lockT it doesn't tick down;
    // the game clears it when control is handed over.
    this.frozen = false;
  }

  /** True while a rotation is in progress; gates movement, catches, and verbs. */
  get locked() { return this.lockT > 0; }

  /**
   * Rotate the tray one slot: the top scoop wraps around to the bottom,
   * every other scoop shifts up by one. Movement and catches lock for
   * ROTATE_LOCK_S — that's the cost. Returns false if the tray is too
   * small to rotate or a rotate is already in progress.
   */
  rotateDown() {
    if (this.locked) return false;
    if (this.stack.length < 2) return false;

    const n = this.stack.length;
    const top = /** @type {{ color: ScoopColor, land: number }} */ (this.stack.pop());
    this.stack.unshift(top);

    // Mark each scoop with where it came from so draw() can interpolate.
    // - Index 0 (the new bottom) was the old top (n-1); arcs around.
    // - Indices 1..n-1 shifted up from i-1; slide straight up one slot.
    for (let i = 0; i < this.stack.length; i++) {
      this.stack[i].slideFromIdx = i === 0 ? n - 1 : i - 1;
      this.stack[i].slideT = 0;
    }

    this.lockT = ROTATE_LOCK_S;
    return true;
  }

  /**
   * Lean briefly toward (targetX, targetY) — a "reaching to hand off" gesture.
   * Direction is normalized so the lean depth (HANDOFF_REACH) is consistent
   * regardless of distance.
   * @param {number} targetX
   * @param {number} targetY
   */
  triggerHandoff(targetX, targetY) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.handoffDx = (dx / dist) * HANDOFF_REACH;
    this.handoffDy = (dy / dist) * HANDOFF_REACH;
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
    // Record this tick's lean so draw() can read an older value for higher scoops.
    this._sloshHead = (this._sloshHead + 1) % SLOSH_HIST;
    this._sloshHist[this._sloshHead] = this.slosh;
  }

  /**
   * @param {number} dt
   * @param {Input} input
   * @param {Bounds} bounds
   * @param {number} [speedMult]
   */
  update(dt, input, bounds, speedMult = 1) {
    // Always tick passive timers (flash, handoff lean, land squash). Even
    // during a rotate-lock, the visual decay should continue.
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.handoffT < HANDOFF_DURATION_S) this.handoffT += dt;
    for (const s of this.stack) {
      if (s.land > 0) s.land = Math.max(0, s.land - dt);
      if (s.slideT !== undefined && s.slideT < 1) s.slideT = Math.min(1, s.slideT + dt / ROTATE_LOCK_S);
    }

    // Slosh runs every frame (before any early return) off the cone's real
    // displacement last frame, so it keeps settling even while locked/frozen.
    const movedVx = dt > 0 ? (this.x - this._prevX) / dt : 0;
    this._prevX = this.x;
    this._tickSlosh(dt, movedVx);

    if (this.lockT > 0) {
      // Rotation in progress: no movement, no acceleration, friction-snap
      // to zero so the cone visibly sits still.
      this.vx = 0;
      this.lockT = Math.max(0, this.lockT - dt);
      return;
    }

    if (this.frozen) {
      // Tutorial freeze: passive timers above still ran; just don't move.
      this.vx = 0;
      return;
    }

    const maxV  = CONE_MAX_SPEED * speedMult;
    const halfW = CONE_WIDTH / 2;

    // Relative touch steering: apply the dragged delta directly (1:1 × gain),
    // then consume it. Uncapped — small thumb travel moves the cone far, which
    // is the whole point. Cleared each frame so a still finger holds position.
    if (input.moveDelta !== 0) {
      this.x = Math.max(halfW, Math.min(bounds.width - halfW, this.x + input.moveDelta));
      input.moveDelta = 0;
      this.vx = 0;
      return;
    }

    const accel = CONE_ACCEL * speedMult;
    const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (dir !== 0) {
      // Hold longer -> ramp up toward the speed cap.
      this.vx += dir * accel * dt;
      this.vx = Math.max(-maxV, Math.min(maxV, this.vx));
    } else {
      // Coast to a stop when nothing is held.
      const drop = CONE_FRICTION * dt;
      this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
    }

    this.x += this.vx * dt;
    if (this.x < halfW) { this.x = halfW; this.vx = 0; }
    if (this.x > bounds.width - halfW) { this.x = bounds.width - halfW; this.vx = 0; }
  }

  coneTopY() {
    return this.y - CONE_HEIGHT / 2;
  }

  stackTopY() {
    return this.coneTopY() - this.stack.length * SCOOP_SPACING;
  }

  /** @param {number} index */
  scoopPosition(index) {
    return {
      x: this.x,
      y: this.coneTopY() - index * SCOOP_SPACING - SCOOP_RADIUS * 0.2
    };
  }

  catchHitbox() {
    return {
      x: this.x,
      y: this.stackTopY(),
      r: SCOOP_RADIUS,
      halfW: CONE_WIDTH / 2 + SCOOP_RADIUS * 0.4
    };
  }

  /**
   * Hitbox for *pickups*. Unlike scoops (which only stick to the top of the
   * stack), pickups pop on contact with ANY part of the player — the cone
   * body OR any scoop in the tray. Vertical range: top edge of the top
   * scoop (or cone top edge if empty) down to the cone tip. Bigger stack =
   * taller hitbox = more reach for higher-flying bubbles.
   */
  pickupHitbox() {
    const top = this.stack.length > 0
      ? this.scoopPosition(this.stack.length - 1).y - SCOOP_RADIUS
      : this.coneTopY();
    const bottom = this.y + CONE_HEIGHT / 2;
    return {
      x: this.x,
      y: (top + bottom) / 2,
      r: (bottom - top) / 2,
      halfW: CONE_WIDTH / 2 + SCOOP_RADIUS * 0.4
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

  /**
   * Eject the *bottom* (oldest) scoop. The rest slide down by one slot —
   * the small re-trigger of the land animation reads the shift. This is
   * the everyday pop verb under top-down delivery: old commitments become
   * cheap to dump while fresh catches stay protected.
   */
  popBottom() {
    if (this.stack.length === 0) return false;
    this.stack.shift();
    for (const s of this.stack) s.land = Math.max(s.land, 0.12);
    return true;
  }

  /**
   * Remove one scoop per color in the list (consumes a served order). While
   * the rainbow power-up is active, every scoop counts as anything — just pop
   * `colors.length` items off the top of the tray.
   */
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
   * Pass `rainbow` to repaint every tray scoop as rainbow (purely visual).
   * @param {CanvasRenderingContext2D} ctx
   * @param {boolean} [rainbow]
   */
  draw(ctx, rainbow = false) {
    // Handoff lean: a sin-bumped offset toward the customer that snaps back
    // by the end of HANDOFF_DURATION_S. Applied via translate so the cone
    // and every scoop on it move together, like a coordinated "reach".
    ctx.save();
    if (this.handoffT < HANDOFF_DURATION_S) {
      const p = this.handoffT / HANDOFF_DURATION_S;
      const ease = Math.sin(p * Math.PI);
      ctx.translate(this.handoffDx * ease, this.handoffDy * ease);
    }
    this._drawCone(ctx);
    for (let i = 0; i < this.stack.length; i++) {
      const s = this.stack[i];
      let drawX, drawY, drawScale;

      if (s.slideT !== undefined && s.slideT < 1) {
        // Rotation animation: lerp from old slot to new slot. The wrap-
        // around scoop (was top, now bottom) bows out to the right so the
        // path reads as "around the cone" instead of teleporting through.
        const from = this.scoopPosition(/** @type {number} */ (s.slideFromIdx));
        const to   = this.scoopPosition(i);
        const t = s.slideT;
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const wrapping = (s.slideFromIdx !== undefined) && s.slideFromIdx > i;
        const bowX = wrapping ? Math.sin(t * Math.PI) * ROTATE_ARC_OUT_PX : 0;
        drawX = from.x + (to.x - from.x) * e + bowX;
        drawY = from.y + (to.y - from.y) * e;
        drawScale = 1;
      } else {
        const pos = this.scoopPosition(i);
        drawX = pos.x;
        drawY = pos.y;
        const p = s.land / LAND_TIME;          // 1 -> 0 as it settles
        drawScale = 1 + 0.28 * p;              // squash-pop on landing
      }

      // Fake slosh trail: the bottom scoop tracks the cone (zero lean, current
      // tick); each scoop above samples the lean from a few ticks earlier, and
      // its amplitude follows a sideways natural-log arc — flat at the base,
      // bowing out more toward the top — so the column trails in one swoosh.
      const n = this.stack.length;
      const f = n > 1 ? i / (n - 1) : 1;                 // 0 at bottom .. 1 at top
      const arc = 1 - Math.log(1 + SLOSH_ARC * (1 - f)) / Math.log(1 + SLOSH_ARC);
      const lag = Math.min(SLOSH_HIST - 1, Math.round(i * SLOSH_LAG));
      const laggedLean = this._sloshHist[(this._sloshHead - lag + SLOSH_HIST) % SLOSH_HIST];
      drawX += laggedLean * arc;

      drawScoop(ctx, drawX, drawY, rainbow ? 'rainbow' : s.color, drawScale);

      // Highlight the top scoop — the one a tap hands to the customer — with the
      // same amber outline + glow as the "selected" customer speech bubble. The
      // matching outline pairs "this scoop ↔ that customer" so the player can see
      // exactly what they're about to deliver.
      if (i === this.stack.length - 1) {
        this._drawTopRing(ctx, drawX, drawY, SCOOP_RADIUS * drawScale);
      }
    }
    ctx.restore();
  }

  /**
   * Amber selection ring around the top (next-to-be-delivered) scoop. Mirrors
   * the active customer bubble's outline in stations.js (#ffb703 stroke +
   * #ffd166 glow) so the "I'm giving you this" read is unmistakable.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x @param {number} y @param {number} r drawn scoop radius
   */
  _drawTopRing(ctx, x, y, r) {
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

  /** @param {CanvasRenderingContext2D} ctx */
  _drawCone(ctx) {
    const cx = this.x;
    const cy = this.y;
    ctx.save();
    if (this.flash > 0) {
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
}

const RAINBOW_STOPS = ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'];

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {ScoopColor | 'rainbow'} colorKey
 * @param {number} [scale]
 */
export function drawScoop(ctx, x, y, colorKey, scale = 1) {
  const r = SCOOP_RADIUS * scale;
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
