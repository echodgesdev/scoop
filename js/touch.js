// @ts-check
/**
 * Native single-touch controls (Pointer Events — also covers mouse/pen, so it
 * works on desktop too). One active pointer at a time. The gesture vocabulary:
 *
 *   drag (horizontal)  → steer: cone chases the finger's x   (onMove / onMoveEnd)
 *   tap                → serve / tap the queue                (onTap)
 *   swipe up           → slingshot                            (onSwipeUp)
 *   swipe down         → rotate the tray                      (onSwipeDown)
 *
 * Keyboard stays fully intact alongside this. The host (Game) supplies a
 * screen→virtual mapper and the action callbacks, so this module stays free of
 * any game/layout knowledge.
 */

const DRAG_START_PX = 8;    // movement beyond this promotes a touch to a drag
const SWIPE_MIN_PX  = 40;   // a release this far counts as a swipe…
const SWIPE_MAX_MS  = 400;  // …if it happened within this window
const SWIPE_AXIS    = 1.2;  // vertical must dominate horizontal by this factor

export class TouchControls {
  /**
   * @param {HTMLElement} target element to listen on (the canvas)
   * @param {{
   *   toVirtual: (clientX: number, clientY: number) => { x: number, y: number },
   *   onMove: (vx: number) => void,
   *   onMoveEnd: () => void,
   *   onTap: (vx: number, vy: number) => void,
   *   onSwipeUp: () => void,
   *   onSwipeDown: () => void
   * }} opts
   */
  constructor(target, opts) {
    this.opts = opts;
    /** @type {number | null} */
    this.activeId = null;
    this.startX = 0;
    this.startY = 0;
    this.startT = 0;
    this.moved = false;

    target.addEventListener('pointerdown', e => this._down(target, e));
    target.addEventListener('pointermove', e => this._move(e));
    target.addEventListener('pointerup', e => this._up(e));
    target.addEventListener('pointercancel', e => this._cancel(e));
  }

  /** @param {HTMLElement} target @param {PointerEvent} e */
  _down(target, e) {
    if (this.activeId !== null) return;  // single-touch: ignore extra fingers
    this.activeId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startT = e.timeStamp;
    this.moved = false;
    try { target.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _move(e) {
    if (e.pointerId !== this.activeId) return;
    if (!this.moved && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > DRAG_START_PX) {
      this.moved = true;
    }
    if (this.moved) this.opts.onMove(this.opts.toVirtual(e.clientX, e.clientY).x);
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _up(e) {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dt = e.timeStamp - this.startT;
    e.preventDefault();

    if (!this.moved) {
      const v = this.opts.toVirtual(e.clientX, e.clientY);
      this.opts.onTap(v.x, v.y);
      return;
    }
    // It was a drag — stop steering, then check if the release was a flick.
    this.opts.onMoveEnd();
    const dist = Math.hypot(dx, dy);
    if (dist >= SWIPE_MIN_PX && dt <= SWIPE_MAX_MS && Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS) {
      if (dy < 0) this.opts.onSwipeUp(); else this.opts.onSwipeDown();
    }
  }

  /** @param {PointerEvent} e */
  _cancel(e) {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    if (this.moved) this.opts.onMoveEnd();
  }
}
