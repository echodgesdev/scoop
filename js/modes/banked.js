// @ts-check
import { GameMode } from './game-mode.js';
import { TutorialBase } from '../tutorial.js';
import { MAX_PU_INVENTORY, BUBBLE_CASHOUT, POWERUP_TYPE } from '../config.js';
import { PICKUP_RING_COLOR } from '../pickups.js';

/** @typedef {import('../game.js').Game} Game */
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('../types.js').Bounds} Bounds */

// Slide-off duration for an evicted bubble (visible "you lost this" beat).
const LEAVE_S = 0.3;
// Delay between queue pops during wave-end cashout — matches Game._cashoutStack
// so the payout reads as one continuous chain.
const CASHOUT_STEP_MS = 140;

/** Banked Inventory tutorial: catching banks the bubble; ⇧ Shift spends it. */
class BankedTutorial extends TutorialBase {
  /** @param {Game} game */
  _updatePowerLesson(game) {
    if (this.powerLessonDone) return;
    if (!game.mode.queueEmpty()) this._banked = true;
    if (this._banked && game.powerups.active(POWERUP_TYPE.SPEED)) this.powerLessonDone = true;
  }

  /** @param {Game} game */
  _powerHint(game) {
    if (this.powerLessonDone) return null;
    const touch = this._touch(game);
    if (!game.mode.queueEmpty()) {
      return touch ? 'Tap the queue to use your power-up!' : '⇧ Shift — use your banked power-up!';
    }
    if (!this._banked && this._featherPresent(game)) {
      return touch ? 'Swipe up to pop the ⚡ and bank it!' : 'Space to pop the ⚡ and bank it!';
    }
    return null;
  }
}

/**
 * Banked Inventory: a caught bubble is stored in a FIFO queue (capped at
 * MAX_PU_INVENTORY) instead of firing; Shift (or a tap on the queue strip)
 * spends the front one — that's when the shared Game._firePower runs the
 * effect, so the active-slot visual is identical to Auto. The queue draws as a
 * row of sockets along the bottom (so the active slot sits higher), and wave-end
 * cashout pays out each banked bubble.
 */
export class BankedMode extends GameMode {
  /** @param {Game} game */
  constructor(game) {
    super(game);
    /** @type {{ type: PickupTypeName, scale: number }[]} */
    this.queue = [];
    /** @type {{ type: PickupTypeName, x: number, y: number, t: number }[]} */
    this.leaving = [];
  }

  get id() { return 'banked'; }
  get label() { return 'Banked Inventory'; }

  reset() { this.queue.length = 0; this.leaving.length = 0; }
  queueEmpty() { return this.queue.length === 0; }

  /** @param {PickupTypeName} type */
  onCatch(type, x, y) {
    this.queue.push({ type, scale: 0.2 });  // pops in via step()
    // Overflow: drop the oldest (front) and slide it off so the loss is visible.
    while (this.queue.length > MAX_PU_INVENTORY) {
      const evicted = this.queue.shift();
      if (!evicted) break;
      const pos = this._slotPos(0);
      this.leaving.push({ type: evicted.type, x: pos.x, y: pos.y, t: 0 });
      this.game.effects.popText(pos.x, pos.y - 22, 'Full!', { color: '#ff9a9a', size: 18, life: 0.6 });
      this.game.sound.bad();
    }
  }

  /** Loot box drops straight into the queue (same as a catch). */
  onLootboxSpend(type, x, y) { this.onCatch(type, x, y); }

  /** Shift: spend the front bubble — fires the effect via the shared engine. */
  onShift() {
    const e = this.queue.shift();
    if (!e) return;
    this.game._firePower(e.type, this.game.player.x, this.game.player.stackTopY());
  }

  /** A tap on the queue strip (when non-empty) spends instead of serving. */
  onTapSpend(vx, vy) {
    if (this.queueEmpty()) return false;
    if (vy <= this.game.bounds.height - 90) return false;
    this.game._useShift();
    return true;
  }

  /** Active-power-up slot sits higher to leave room for the queue row beneath it. */
  activeSlotY(bounds) { return bounds.height - 118; }

  /** @param {number} dt */
  step(dt) {
    const k = Math.min(1, dt * 14);
    for (const e of this.queue) e.scale += (1 - e.scale) * k;  // pop-in ease
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      this.leaving[i].t += dt / LEAVE_S;
      if (this.leaving[i].t >= 1) this.leaving.splice(i, 1);
    }
  }

  /** @param {CanvasRenderingContext2D} ctx @param {Bounds} bounds */
  drawQueueSlots(ctx, bounds) {
    const hasAny = this.queue.length > 0;
    const r = this._slotPos(0).r;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Empty sockets for the whole row (brighter once something is banked).
    for (let i = 0; i < MAX_PU_INVENTORY; i++) {
      const pos = this._slotPos(i);
      ctx.globalAlpha = hasAny ? 0.85 : 0.12;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Evicted bubbles sliding off to the left.
    for (const lv of this.leaving) {
      ctx.globalAlpha = 1 - lv.t;
      this.game._drawPowerupBubble(ctx, lv.x - lv.t * 70, lv.y, r * (1 - 0.5 * lv.t), lv.type, false, -1);
    }
    ctx.globalAlpha = 1;

    // Banked bubbles; the front one glows to mark it as "next to spend".
    for (let i = 0; i < this.queue.length; i++) {
      const e = this.queue[i];
      const pos = this._slotPos(i);
      this.game._drawPowerupBubble(ctx, pos.x, pos.y, r * e.scale, e.type, i === 0, -1);
    }

    // "⇧ Shift" hint once there's something to spend.
    if (hasAny) {
      const last = this._slotPos(MAX_PU_INVENTORY - 1);
      ctx.font = "bold 18px 'Comic Sans MS', sans-serif";
      ctx.textAlign = 'left';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      const hintX = last.x + r + 16;
      ctx.strokeText('⇧ Shift', hintX, last.y);
      ctx.fillText('⇧ Shift', hintX, last.y);
    }
    ctx.restore();
  }

  /**
   * Wave-end cashout: pop each banked bubble (front to back) for BUBBLE_CASHOUT
   * points, paced to match the stack-pop chain, then signal completion.
   * @param {() => void} onDone
   */
  cashout(onDone) {
    const step = () => {
      if (!this.game.running) { onDone(); return; }
      const e = this.queue.shift();
      if (!e) { onDone(); return; }
      const pos = this._slotPos(0);
      this.game.shop.addScore(BUBBLE_CASHOUT);
      this.game.effects.burst(pos.x, pos.y, [PICKUP_RING_COLOR[e.type], '#fff'], 18);
      this.game.effects.popText(pos.x, pos.y - 12, `+${BUBBLE_CASHOUT}`, { color: '#ffec5c', size: 22, life: 0.7 });
      this.game.hud.setScore(this.game.shop.score);
      this.game.sound.bubblePop();
      setTimeout(step, CASHOUT_STEP_MS);
    };
    step();
  }

  makeTutorial() { return new BankedTutorial(); }

  /**
   * Screen-space center + radius of queue slot i — a horizontal row centered
   * along the bottom of the stage (below the active-power-up slot).
   * @param {number} i
   */
  _slotPos(i) {
    const r = 24;
    const gap = 18;
    const n = MAX_PU_INVENTORY;
    const totalW = n * (r * 2) + (n - 1) * gap;
    const startX = this.game.bounds.width / 2 - totalW / 2 + r;
    return { x: startX + i * (r * 2 + gap), y: this.game.bounds.height - 46, r };
  }
}
