// @ts-check
import { STATE } from './shop.js';
import { drawScoop } from './player.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR } from './pickups.js';
import {
  SCOOP_RADIUS,
  MINI_SCOOP_RADIUS,
  MINI_CONE_OFFSET_X,
  MINI_CONE_W,
  MINI_CONE_H,
  MINI_CONE_FACE_OFFSET_PX,
  SERVED_FLIGHT_ARC,
  CUSTOMER_FACE_OFFSET_PX,
  groundYFor
} from './config.js';

// Customers are now scaled to read at parity with the cone (face ≈ cone width,
// bigger than a falling scoop) so the serve half holds visual weight equal to
// the fall half. Bubble + mini-cone assets scale with the face.
const FACE_SIZE = 92;
const BUBBLE_H = 96;
const GAP = 18;          // between face and bubble
const POP_TIME = 0.16;   // bubble scale-in duration

const SWATCH_R   = 17;
const SWATCH_GAP = 9;    // edge-to-edge between swatches
const BUBBLE_PAD = 26;   // horizontal padding around the swatch row

function bubbleWidthFor(orderLen) {
  const swatches = Math.max(1, orderLen);
  const row = swatches * SWATCH_R * 2 + (swatches - 1) * SWATCH_GAP;
  return Math.max(150, row + BUBBLE_PAD * 2);
}

const RAINBOW_STOPS = ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'];

function faceFor(customer, patience, servable, pausePatience) {
  if (customer.state === STATE.LEAVING) return customer.mood === 'happy' ? '😄' : '😠';
  if (customer.state !== STATE.WAITING) return '🙂'; // arriving / delay
  if (pausePatience) return '🥶';  // patience frozen by power-up or debug flag
  if (servable) return '🤤';
  if (patience > 0.6) return '😋';
  if (patience > 0.35) return '🙂';
  if (patience > 0.15) return '😟';
  return '😠';
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
  }

  layout(bounds) {
    this.groundY = groundYFor(bounds.height);
  }

  draw(ctx, customers, { activeIndex, canServe, hex, pausePatience = false, rainbow = false }) {
    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      const cx = c.x;
      // Face center sits CUSTOMER_FACE_OFFSET_PX from the sand top (negative
      // = above). Half-submerged feel is just below 0; current default keeps
      // a strip of face above the sand.
      const faceY = this.groundY + CUSTOMER_FACE_OFFSET_PX + c.yOff;
      const waiting = c.state === STATE.WAITING;
      const servable = waiting && canServe(i);
      const active = waiting && i === activeIndex;
      const patience = c.order.timeLeft / c.order.duration;

      if (waiting) {
        const pop = easeOut(Math.min(1, c.waitT / POP_TIME));
        this._drawBubble(ctx, c, cx, faceY, pop, { servable, active, patience, hex, rainbow });
      }

      ctx.font = `${FACE_SIZE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(faceFor(c, patience, servable, pausePatience), cx, faceY);

      // Tipping mode: a token by the face showing the reward this customer will
      // tip on a completed order (until they leave).
      if (c.tip && c.state !== STATE.LEAVING) this._drawTip(ctx, c.tip, cx, faceY);

      // Held mini-cone + flying-in / settled scoops. Drawn for every state
      // so it slides off with the customer on LEAVING. Pass faceY in so the
      // held cone tracks the customer's actual face position rather than
      // an absolute ground line.
      this._drawHeldCone(ctx, c, faceY);
    }
  }

  /**
   * Tipping mode: a small token by the customer's face showing the reward
   * they'll hand over when their order is completed.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} tip  pickup type or 'coin'
   */
  _drawTip(ctx, tip, cx, faceY) {
    const r = 19;
    const bx = cx - FACE_SIZE * 0.46;
    const by = faceY - FACE_SIZE * 0.42;
    ctx.save();
    ctx.shadowColor = PICKUP_RING_COLOR[tip] || '#ffd700';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = PICKUP_RING_COLOR[tip] || '#ffd700';
    ctx.stroke();
    ctx.font = `${Math.floor(r * 1.1)}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#222';
    ctx.fillText(PICKUP_ICONS[tip] || '$', bx, by + 1);
    ctx.restore();
  }

  /**
   * Customer's mini-cone next to their face. Stack grows upward as serveOne
   * accepts; each new entry flies in along an arc from where the player's
   * cone-top scoop was at serve time.
   */
  _drawHeldCone(ctx, c, faceY) {
    const served = c.order.served;
    if (!served || served.length === 0) return;

    const baseX = c.x + MINI_CONE_OFFSET_X;
    // Cone tip positioned MINI_CONE_FACE_OFFSET_PX below the face center,
    // so the cone "hangs" at the customer's chin level regardless of how
    // submerged they are. faceY already includes the slide-in offset.
    const baseY = faceY + MINI_CONE_FACE_OFFSET_PX;

    // Mini cone.
    ctx.save();
    ctx.fillStyle = '#d18a4a';
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(baseX - MINI_CONE_W / 2, baseY - MINI_CONE_H);
    ctx.lineTo(baseX + MINI_CONE_W / 2, baseY - MINI_CONE_H);
    ctx.lineTo(baseX, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const spacing = MINI_SCOOP_RADIUS * 1.6;
    const scale = MINI_SCOOP_RADIUS / SCOOP_RADIUS;

    for (let i = 0; i < served.length; i++) {
      const s = served[i];
      const slotX = baseX;
      const slotY = baseY - MINI_CONE_H - i * spacing - MINI_SCOOP_RADIUS * 0.2;

      // Ease-in-out from src to slot, with a sin-bump that arcs the path
      // upward so the scoop reads as "tossed across".
      const t = Math.max(0, Math.min(1, s.t));
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = s.srcX + (slotX - s.srcX) * e;
      const linearY = s.srcY + (slotY - s.srcY) * e;
      const bump = Math.sin(t * Math.PI) * SERVED_FLIGHT_ARC;
      const y = linearY - bump;

      // Squash-pop on the last sliver of the flight, mimicking the player
      // tray's land animation.
      const squash = t > 0.85 ? 1 + 0.35 * (1 - (t - 0.85) / 0.15) : 1;

      drawScoop(ctx, x, y, s.color, scale * squash);
    }
  }

  _drawBubble(ctx, c, cx, faceY, pop, { servable, active, patience, hex, rainbow }) {
    const bubbleBottom = faceY - FACE_SIZE / 2 - GAP;
    const top = bubbleBottom - BUBBLE_H;
    const bubbleW = bubbleWidthFor(c.order.colors.length);
    const left = cx - bubbleW / 2;

    ctx.save();
    // Scale-in pop, anchored at the tail (bottom-center, by the face).
    ctx.translate(cx, bubbleBottom);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -bubbleBottom);

    // Bubble + tail
    ctx.save();
    if (active) { ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 18; }
    else if (servable) { ctx.shadowColor = '#06d6a0'; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ctx.roundRect(left, top, bubbleW, BUBBLE_H, 14);
    ctx.moveTo(cx - 9, bubbleBottom - 1);
    ctx.lineTo(cx, bubbleBottom + 11);
    ctx.lineTo(cx + 9, bubbleBottom - 1);
    ctx.closePath();
    ctx.fillStyle = servable ? '#eafff7' : 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = active ? 5 : 3;
    ctx.strokeStyle = active ? '#ffb703' : (servable ? '#06d6a0' : '#666');
    ctx.stroke();
    ctx.restore();

    // Wanted colors — centered row that scales with order length.
    const n = c.order.colors.length;
    const step = SWATCH_R * 2 + SWATCH_GAP;
    const rowW = n * SWATCH_R * 2 + (n - 1) * SWATCH_GAP;
    const swatchY = top + 30;
    const firstX = cx - rowW / 2 + SWATCH_R;
    for (let k = 0; k < n; k++) {
      const sx = firstX + k * step;
      ctx.beginPath();
      ctx.arc(sx, swatchY, SWATCH_R, 0, Math.PI * 2);
      if (rainbow) {
        const grad = ctx.createLinearGradient(sx - SWATCH_R, swatchY - SWATCH_R, sx + SWATCH_R, swatchY + SWATCH_R);
        RAINBOW_STOPS.forEach((col, i) => grad.addColorStop(i / (RAINBOW_STOPS.length - 1), col));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = hex(c.order.colors[k]);
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#333';
      ctx.stroke();
    }

    // Value
    ctx.fillStyle = '#444';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${c.order.value} pts`, cx, top + 62);

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
