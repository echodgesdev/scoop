// @ts-check
import { STATE } from '../game/shop.js';
import { CUSTOMER_FACE_OFFSET_PX, GROUND_Y } from '../game/config.js';
import { drawFace, FACE_SIZE } from './sprites/customerRenderer.js';
import { drawHeldCone } from './view/customerConeView.js';
import { drawBubble } from './view/customerBubbleView.js';
import { drawTip } from './view/customerTipView.js';

// Angry-customer buzz: once patience drops below ANGRY_AT (the ANGRY face in
// customerRenderer) the head jitters — amplitude ramps to SHAKE_AMP as patience hits
// 0, oscillating at SHAKE_FREQ rad/s. Applied to the whole customer so face, held
// cone, bubble, and tip shake together. ANGRY_AT mirrors customerRenderer's threshold.
const ANGRY_AT = 0.15;
const SHAKE_FREQ = 38;
const SHAKE_AMP = 3.5;

/**
 * Renders the shop's customers in layers — face, held mini-cone, speech bubble,
 * tip badge — each delegated to its own view module. Pure orchestration; all the
 * state lives in Shop.
 */
export class Customers {
  constructor() {
    this.groundY = 0;
    this.width = 0;   // virtual canvas width — used to keep tip badges on-screen
  }

  layout(bounds) {
    this.groundY = GROUND_Y;
    this.width = bounds.width;
  }

  draw(ctx, customers, { activeIndex, canServe, pausePatience = false, rainbow = false, time = 0, tipLabel = false, coneX = /** @type {number|null} */ (null), alpha = 1 }) {
    // Precompute each customer's interpolated draw state once, then render in
    // LAYERS across all of them — faces, held cones, bubbles, tips — so a
    // customer that spawns next to another never covers the earlier one's bubble
    // or tip. (Within a single loop, customer i+1's face would draw over
    // customer i's bubble/tip.) Lane shifts + slide in/out interpolate between
    // the last two sim steps (render alpha) so motion is smooth at any refresh.
    const items = customers.map((c, i) => {
      let cx = c.prevX + (c.x - c.prevX) * alpha;
      const yOff = c.prevYOff + (c.yOff - c.prevYOff) * alpha;
      // Face center sits CUSTOMER_FACE_OFFSET_PX from the sand top.
      const faceY = this.groundY + CUSTOMER_FACE_OFFSET_PX + yOff;
      const waiting = c.state === STATE.WAITING;
      const servable = waiting && canServe(i);
      const active = waiting && i === activeIndex;
      const patience = c.order.timeLeft / c.order.duration;
      // Shake once past the angry threshold (any WAITING customer, even one whose scoop
      // you're holding — anger supersedes drool now), ramping in as patience hits 0.
      const anger = (waiting && !pausePatience)
        ? Math.max(0, Math.min(1, (ANGRY_AT - patience) / ANGRY_AT)) : 0;
      // A wrong-scoop delivery buzzes "no!" at full amplitude — even if they're not
      // yet impatient (or are frozen) — for instant "that's not my order" feedback.
      const rejecting = (waiting && c.rejectT && c.rejectT > 0) ? 1 : 0;
      const shake = Math.max(anger, rejecting);
      if (shake > 0) cx += Math.sin(time * SHAKE_FREQ + c.id * 1.7) * SHAKE_AMP * shake;
      return { c, cx, faceY, waiting, servable, active, patience };
    });

    // Layer 1 — faces (customerRenderer: character picks the sheet row, mood the
    // column). Customers always carry a valid character (selection waterfall +
    // roster guarantee it), so there's no pre-sprite emoji fallback.
    for (const it of items) {
      drawFace(ctx, it.c, it.cx, it.faceY, { patience: it.patience, servable: it.servable, pausePatience });
    }

    // Layer 2 — held mini-cones + flying / settled served scoops (above faces so
    // a neighbor can't hide them). Drawn for every state so it slides off on LEAVING.
    for (const it of items) drawHeldCone(ctx, it.c, it.cx, it.faceY, alpha);

    // Layer 3 — speech bubbles, above every face/cone (drawn by bubbleView, which
    // handles the spawn pop + the fade-behind-the-cone translucency).
    for (const it of items) {
      if (!it.waiting) continue;
      drawBubble(ctx, it.c, it.cx, it.faceY, FACE_SIZE, { servable: it.servable, active: it.active, patience: it.patience, rainbow, coneX });
    }

    // Layer 4 — tips on TOP of everything: a token showing the reward this
    // customer will hand over on a completed order (until they leave).
    for (const it of items) {
      if (it.c.tip && it.c.state !== STATE.LEAVING) drawTip(ctx, it.c.tip, it.cx, it.faceY, FACE_SIZE, this.width, time, tipLabel);
    }
  }

}
