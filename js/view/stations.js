// @ts-check
import { STATE } from '../game/shop.js';
import { drawScoop, drawConeUnderStack } from './playerView.js';
import { SCOOP_STATE } from './sprites.js';
import { SpriteSheet } from './spriteSheet.js';
import { glowCircle, glowRoundRect } from './glow.js';
import { CONE_FRAME } from './sprites/coneSprite.js';
import CUSTOMER_SPRITE from './sprites/customerSprite.js';
import HUD_SCOOP_SPRITE, { HUD_SCOOP_COL } from './sprites/hudScoopSprite.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR } from './powerupVisuals.js';
import {
  SCOOP_RADIUS,
  MINI_SCOOP_RADIUS,
  MINI_CONE_OFFSET_X,
  MINI_CONE_H,
  MINI_CONE_FACE_OFFSET_PX,
  SERVED_FLIGHT_ARC,
  CUSTOMER_FACE_OFFSET_PX,
  GROUND_Y
} from '../game/config.js';

// Customers read at parity with the cone (bigger than a falling scoop) so the
// serve half holds visual weight equal to the fall half. The bubble / tip /
// mini-cone offsets all sit against FACE_SIZE.
//
// The sheet's 256px cells carry a LOT of transparent padding around each head
// (so every art size fits one sheet), so drawing a whole cell at FACE_SIZE makes
// the head look tiny. So FACE_SIZE is the on-screen HEAD diameter, and we scale
// the cell UP by the head's fill fraction — the head itself lands at FACE_SIZE
// (and the bubble hugs it). Tune FACE_SIZE for head size; FACE_CELL_FILL only if
// the art's padding changes.
const FACE_SIZE = 168;        // on-screen head diameter (the layout anchor)
const FACE_CELL_FILL = 0.70;  // fraction of the 256px cell the head fills (rest is padding)
const FACE_SCALE = FACE_SIZE / (FACE_CELL_FILL * CUSTOMER_SPRITE.frame.height);
const BUBBLE_H = 78;   // tightened after the point-value line was removed
const GAP = 18;          // between face and bubble
const POP_TIME = 0.16;   // bubble scale-in duration

const SWATCH_R   = 17;
const SWATCH_GAP = 9;    // edge-to-edge between swatches
const BUBBLE_PAD = 26;   // horizontal padding around the swatch row
// Wanted-color scoops render at this display size, centered on the same slots the
// old color circles used (so the bubble-width math below is unchanged).
const SWATCH_SCOOP_SIZE = 40;
const hudScoopSheet = new SpriteSheet(HUD_SCOOP_SPRITE);

// A bubble fades toward this opacity as the cone (the player) passes horizontally
// behind it, so the cone + tray stay readable through it. CONE_OVERLAP_HALF is
// the cone's half-reach (cone + a scoop) added to the bubble half-width for the
// proximity test.
const BUBBLE_MIN_ALPHA = 0.75;
const CONE_OVERLAP_HALF = 55;

function bubbleWidthFor(orderLen) {
  const swatches = Math.max(1, orderLen);
  const row = swatches * SWATCH_R * 2 + (swatches - 1) * SWATCH_GAP;
  return Math.max(150, row + BUBBLE_PAD * 2);
}

// Expression COLUMNS on the customer sheet (column 0 is the blank "Empty" face,
// reserved for the unlock animation; the 6 moods follow, shifted one right of
// the old single-row layout). A customer's row is their character.
const FACE = Object.freeze({ EMPTY: 0, DEFAULT: 1, HUNGRY: 2, UPSET: 3, ANGRY: 4, DROOL: 5, FROZEN: 6 });
// The def's `image` is the runtime path (sprite-editor export) — used verbatim.
const faceSheet = new SpriteSheet(CUSTOMER_SPRITE);

/**
 * The customer's face COLUMN (see FACE) for its state + patience. As patience
 * drains the sequence is Hungry → Default → Upset → Angry, with Drool while
 * servable and Frozen while the pause power-up holds it.
 */
function faceFor(customer, patience, servable, pausePatience) {
  if (customer.state === STATE.LEAVING) return customer.mood === 'happy' ? FACE.HUNGRY : FACE.ANGRY;
  if (customer.state !== STATE.WAITING) return FACE.DEFAULT;  // arriving / delay
  if (pausePatience) return FACE.FROZEN;                       // frozen power-up / debug
  if (servable) return FACE.DROOL;
  if (patience > 0.6) return FACE.HUNGRY;
  if (patience > 0.35) return FACE.DEFAULT;
  if (patience > 0.15) return FACE.UPSET;
  return FACE.ANGRY;
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Renders the shop's customers: a face on the ground (mood = state/patience)
 * and, once waiting, a speech bubble above it with the wanted colors, value,
 * and patience bar. Pure presentation — all state lives in Shop.
 */
export class Stations {
  constructor() {
    this.groundY = 0;
    this.width = 0;   // virtual canvas width — used to keep tip badges on-screen
  }

  layout(bounds) {
    this.groundY = GROUND_Y;
    this.width = bounds.width;
  }

  draw(ctx, customers, { activeIndex, canServe, pausePatience = false, rainbow = false, time = 0, tipLabel = false, coneX = null, alpha = 1 }) {
    // Precompute each customer's interpolated draw state once, then render in
    // LAYERS across all of them — faces, held cones, bubbles, tips — so a
    // customer that spawns next to another never covers the earlier one's bubble
    // or tip. (Within a single loop, customer i+1's face would draw over
    // customer i's bubble/tip.) Lane shifts + slide in/out interpolate between
    // the last two sim steps (render alpha) so motion is smooth at any refresh.
    const items = customers.map((c, i) => {
      const cx = c.prevX + (c.x - c.prevX) * alpha;
      const yOff = c.prevYOff + (c.yOff - c.prevYOff) * alpha;
      // Face center sits CUSTOMER_FACE_OFFSET_PX from the sand top.
      const faceY = this.groundY + CUSTOMER_FACE_OFFSET_PX + yOff;
      const waiting = c.state === STATE.WAITING;
      const servable = waiting && canServe(i);
      const active = waiting && i === activeIndex;
      const patience = c.order.timeLeft / c.order.duration;
      return { c, cx, faceY, waiting, servable, active, patience };
    });

    // Layer 1 — faces. The character picks the sprite row, the mood picks the
    // column; the cell is drawn at FACE_SCALE. Customers always carry a valid
    // character (the selection waterfall + roster guarantee it), so there's no
    // emoji-placeholder fallback — that was the old pre-sprite stand-in.
    for (const it of items) {
      const faceIdx = faceFor(it.c, it.patience, it.servable, pausePatience);
      faceSheet.draw(ctx, it.c.character || '', faceIdx, it.cx, it.faceY, FACE_SCALE);
    }

    // Layer 2 — held mini-cones + flying / settled served scoops (above faces so
    // a neighbor can't hide them). Drawn for every state so it slides off on LEAVING.
    for (const it of items) this._drawHeldCone(ctx, it.c, it.cx, it.faceY, alpha);

    // Layer 3 — speech bubbles, above every face/cone. A bubble fades toward
    // translucent as the cone passes horizontally behind it (so the cone + tray
    // read through it), ramping with overlap and bottoming out at BUBBLE_MIN_ALPHA.
    for (const it of items) {
      if (!it.waiting) continue;
      const pop = easeOut(Math.min(1, it.c.waitT / POP_TIME));
      let bubbleAlpha = 1;
      if (coneX != null) {
        const range = bubbleWidthFor(it.c.order.colors.length) / 2 + CONE_OVERLAP_HALF;
        const overlap = Math.max(0, 1 - Math.abs(it.cx - coneX) / range);
        bubbleAlpha = 1 - (1 - BUBBLE_MIN_ALPHA) * overlap;
      }
      this._drawBubble(ctx, it.c, it.cx, it.faceY, pop, { servable: it.servable, active: it.active, patience: it.patience, rainbow, alpha: bubbleAlpha });
    }

    // Layer 4 — tips on TOP of everything: a token showing the reward this
    // customer will hand over on a completed order (until they leave).
    for (const it of items) {
      if (it.c.tip && it.c.state !== STATE.LEAVING) this._drawTip(ctx, it.c.tip, it.cx, it.faceY, time, tipLabel);
    }
  }

  /**
   * Tipping mode: the reward this customer hands over on a completed order.
   * This is the ONLY power-up source in Tipping, so it's a big, glowing,
   * gently-bobbing badge that floats above the customer — impossible to miss.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} tip  pickup type or 'coin'
   * @param {number} cx @param {number} faceY
   * @param {number} time free-running clock (s) for the pulse / bob
   * @param {boolean} showLabel draw the "TIP" tag (tutorial only)
   */
  _drawTip(ctx, tip, cx, faceY, time, showLabel) {
    const ring = PICKUP_RING_COLOR[tip] || '#ffd700';
    const bob = Math.sin(time * 3) * 4;            // gentle float
    const pulse = 1 + 0.06 * Math.sin(time * 5.5); // breathing scale
    const r = 21 * pulse;                          // smaller badge (was 30)
    // Sit on the customer's upper-left, OVERLAPPING the head, so the token reads
    // as clearly theirs — not floating off toward a neighbor. Clamp to the canvas
    // so the edge slots don't push it off-screen.
    const by = faceY - FACE_SIZE * 0.30 + bob;
    let bx = cx - FACE_SIZE * 0.30;
    if (this.width) bx = Math.max(r + 5, Math.min(this.width - r - 5, bx));

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Soft rotating sparkles around the badge to pull the eye (tighter orbit).
    ctx.fillStyle = ring;
    for (let k = 0; k < 3; k++) {
      const a = time * 1.6 + k * (Math.PI * 2 / 3);
      const sx = bx + Math.cos(a) * (r + 5);
      const sy = by + Math.sin(a) * (r + 5);
      const ss = 2 + 1.3 * (0.5 + 0.5 * Math.sin(time * 6 + k));
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(sx, sy, ss, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Baked soft drop shadow (offset down) + a tight colored ring glow, then the
    // coin body and ring drawn crisp on top — no per-frame shadowBlur.
    glowCircle(ctx, bx, by + 3, r, 'rgba(0, 0, 0, 0.45)');
    glowCircle(ctx, bx, by, r + 1, ring, 0.85);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.fill();

    // Colored ring (the eye-catcher) on the same circle path; then a faint inner
    // ring for a minted-coin read.
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.arc(bx, by, r - 5, 0, Math.PI * 2);
    ctx.stroke();

    // Reward icon.
    ctx.font = `${Math.floor(r * 1.05)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
    ctx.fillStyle = '#222';
    ctx.fillText(PICKUP_ICONS[tip] || '🪙', bx, by + 1);

    // "TIP" tag beneath — onboarding affordance, shown only during the tutorial.
    if (showLabel) {
      ctx.font = "bold 12px 'Comic Sans MS', sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillStyle = '#fff';
      ctx.strokeText('TIP', bx, by + r + 8);
      ctx.fillText('TIP', bx, by + r + 8);
    }
    ctx.restore();
  }

  /**
   * Customer's mini-cone next to their face. Stack grows upward as serveOne
   * accepts; each new entry flies in along an arc from where the player's
   * cone-top scoop was at serve time.
   * @param {number} cx interpolated customer x (drawn position)
   */
  _drawHeldCone(ctx, c, cx, faceY, alpha = 1) {
    const served = c.order.served;
    if (!served || served.length === 0) return;

    const baseX = cx + MINI_CONE_OFFSET_X;
    // Cone tip positioned MINI_CONE_FACE_OFFSET_PX below the face center,
    // so the cone "hangs" at the customer's chin level regardless of how
    // submerged they are. faceY already includes the slide-in offset.
    const baseY = faceY + MINI_CONE_FACE_OFFSET_PX;

    const spacing = MINI_SCOOP_RADIUS * 1.6;
    const scale = MINI_SCOOP_RADIUS / SCOOP_RADIUS;

    // The bottom scoop's resting center (i = 0 of the stack below). The layered
    // cone sprite — the same one the player carries, scaled down — is seated under
    // it so its bowl nests the scoops, with BACK behind the stack and FRONT over it.
    const seatY = baseY - MINI_CONE_H - MINI_SCOOP_RADIUS * 0.2;
    drawConeUnderStack(ctx, baseX, seatY, scale, CONE_FRAME.BACK);

    for (let i = 0; i < served.length; i++) {
      const s = served[i];
      const slotX = baseX;
      const slotY = baseY - MINI_CONE_H - i * spacing - MINI_SCOOP_RADIUS * 0.2;

      // Ease-in-out from src to slot, with a sin-bump that arcs the path
      // upward so the scoop reads as "tossed across". Flight progress is
      // interpolated between sim steps (it's a fast 0.32s arc).
      const st = s.prevT !== undefined ? s.prevT + (s.t - s.prevT) * alpha : s.t;
      const t = Math.max(0, Math.min(1, st));
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = s.srcX + (slotX - s.srcX) * e;
      const linearY = s.srcY + (slotY - s.srcY) * e;
      const bump = Math.sin(t * Math.PI) * SERVED_FLIGHT_ARC;
      const y = linearY - bump;

      // Squash-pop on the last sliver of the flight, mimicking the player
      // tray's land animation.
      const squash = t > 0.85 ? 1 + 0.35 * (1 - (t - 0.85) / 0.15) : 1;

      drawScoop(ctx, x, y, s.color, scale * squash, SCOOP_STATE.CONE);
    }

    // Cone FRONT — over the stack, so the bottom scoop nests into the bowl.
    drawConeUnderStack(ctx, baseX, seatY, scale, CONE_FRAME.FRONT);
  }

  _drawBubble(ctx, c, cx, faceY, pop, { servable, active, patience, rainbow, alpha = 1 }) {
    const bubbleBottom = faceY - FACE_SIZE / 2 - GAP;
    const top = bubbleBottom - BUBBLE_H;
    const bubbleW = bubbleWidthFor(c.order.colors.length);
    const left = cx - bubbleW / 2;

    ctx.save();
    // Fade the whole bubble when the cone is behind it (1 = opaque).
    if (alpha < 1) ctx.globalAlpha = alpha;
    // Scale-in pop, anchored at the tail (bottom-center, by the face).
    ctx.translate(cx, bubbleBottom);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -bubbleBottom);

    // Bubble + tail. The tail is a solid triangle in the OUTLINE color (its
    // infill matches the border — same as the tutorial tooltip tail), pointing
    // down at the customer; the body's bottom border is that color too, so the
    // two blend into one continuous pointer.
    const outline = active ? '#ffb703' : (servable ? '#06d6a0' : '#666');
    ctx.save();
    // Baked halo behind the whole bubble (replaces the per-frame shadowBlur).
    if (active) glowRoundRect(ctx, left, top, bubbleW, BUBBLE_H, 14, '#ffd166', 18);
    else if (servable) glowRoundRect(ctx, left, top, bubbleW, BUBBLE_H, 14, '#06d6a0', 14);
    // Tail first, so the body fill + border draw cleanly over its root.
    ctx.beginPath();
    ctx.moveTo(cx - 10, bubbleBottom - 1);
    ctx.lineTo(cx, bubbleBottom + 13);
    ctx.lineTo(cx + 10, bubbleBottom - 1);
    ctx.closePath();
    ctx.fillStyle = outline;
    ctx.fill();
    // Body.
    ctx.beginPath();
    ctx.roundRect(left, top, bubbleW, BUBBLE_H, 14);
    ctx.fillStyle = servable ? '#eafff7' : 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = active ? 5 : 3;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.restore();

    // Wanted colors — centered row that scales with order length.
    const n = c.order.colors.length;
    const step = SWATCH_R * 2 + SWATCH_GAP;
    const rowW = n * SWATCH_R * 2 + (n - 1) * SWATCH_GAP;
    const swatchY = top + 30;
    const firstX = cx - rowW / 2 + SWATCH_R;
    const scoopScale = SWATCH_SCOOP_SIZE / hudScoopSheet.frameW;
    for (let k = 0; k < n; k++) {
      const sx = firstX + k * step;
      // A scoop icon per wanted color (rainbow mode → the rainbow scoop).
      const col = rainbow ? HUD_SCOOP_COL.rainbow : HUD_SCOOP_COL[c.order.colors[k]];
      hudScoopSheet.draw(ctx, 0, col, sx, swatchY, scoopScale);
    }

    // (Point value removed from the bubble — it was clutter; the swatches + tip
    // token carry the read, and the score lives on the HUD.)

    // Patience bar
    const barX = left + 14;
    const barW = bubbleW - 28;
    const barY = top + BUBBLE_H - 16;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, 8, 4);
    ctx.fill();
    ctx.fillStyle = patience < 0.3 ? '#e63946' : '#43aa8b';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * Math.max(0, patience), 8, 4);
    ctx.fill();

    ctx.restore();
  }
}
