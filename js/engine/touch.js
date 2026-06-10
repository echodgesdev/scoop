// @ts-check
/**
 * Native single-touch controls (Pointer Events — also covers mouse/pen, so it
 * works on desktop too). One active pointer at a time.
 *
 * This layer is MEANING-AGNOSTIC: it reports raw gesture events and lets the host
 * decide what they mean, so steering/verb changes never touch this file.
 *
 *   onHold(vx)        pointer went down at virtual-x vx
 *   onMove(vx, dvx)   drag update — absolute vx and the per-event virtual delta
 *   onMoveEnd()       drag released
 *   onHoldEnd()       pointer released (always)
 *   onTap(vx, vy)     quick touch with no drag
 *   onSwipeUp()/onSwipeDown()   a fast vertical flick
 *   onTossCancel()    an upward gesture that fell short of a swipe (a started-
 *                     then-abandoned toss)
 *
 * Keyboard stays fully intact alongside this.
 */

const DRAG_START_PX = 8;    // movement beyond this promotes a touch to a drag
const SWIPE_MIN_PX  = 40;   // a release this far counts as a swipe…
const SWIPE_MAX_MS  = 400;  // …if it happened within this window
const SWIPE_AXIS    = 1.2;  // vertical must dominate horizontal by this factor
const CANCEL_UP_PX  = 14;   // an upward release at least this far, but short of a
                            // swipe, is a canceled toss (squash the top scoop back)

export class TouchControls {
  /**
   * @param {HTMLElement} target element to listen on (the canvas)
   * @param {{
   *   toVirtual: (clientX: number, clientY: number) => { x: number, y: number },
   *   onHold: (vx: number) => void,
   *   onHoldEnd: () => void,
   *   onMove: (vx: number, dvx: number) => void,
   *   onMoveEnd: () => void,
   *   onTap: (vx: number, vy: number) => void,
   *   onSwipeUp: () => void,
   *   onSwipeDown: () => void,
   *   onTossCancel: () => void
   * }} opts
   */
  constructor(target, opts) {
    this.opts = opts;
    /** @type {number | null} */
    this.activeId = null;
    this.startX = 0;
    this.startY = 0;
    this.startT = 0;
    this.lastVX = 0;
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
    this.lastVX = this.opts.toVirtual(e.clientX, e.clientY).x;
    this.opts.onHold(this.lastVX);
    try { target.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  _move(e) {
    if (e.pointerId !== this.activeId) return;
    if (!this.moved && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > DRAG_START_PX) {
      this.moved = true;
    }
    if (this.moved) {
      const vx = this.opts.toVirtual(e.clientX, e.clientY).x;
      this.opts.onMove(vx, vx - this.lastVX);
      this.lastVX = vx;
    }
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

    this.opts.onHoldEnd();
    if (!this.moved) {
      const v = this.opts.toVirtual(e.clientX, e.clientY);
      this.opts.onTap(v.x, v.y);
      return;
    }
    this.opts.onMoveEnd();
    const dist = Math.hypot(dx, dy);
    if (dist >= SWIPE_MIN_PX && dt <= SWIPE_MAX_MS && Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS) {
      if (dy < 0) this.opts.onSwipeUp(); else this.opts.onSwipeDown();
    } else if (dy < -CANCEL_UP_PX && Math.abs(dy) > Math.abs(dx)) {
      // Upward-dominant but short of a swipe: a toss the user started then let go
      // of early. Report it so the host can squash the top scoop back.
      this.opts.onTossCancel();
    }
  }

  /** @param {PointerEvent} e */
  _cancel(e) {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    this.opts.onHoldEnd();
    if (this.moved) this.opts.onMoveEnd();
  }
}
