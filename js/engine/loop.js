// @ts-check
/**
 * Fixed-timestep game loop. Each animation frame it clamps the elapsed time,
 * pumps as many fixed-dt simulation steps as have accumulated (only while
 * `shouldStep()` is true — so pausing simply stops accumulating), then renders.
 * Game-agnostic: the host supplies the gate, the step, and the render; this
 * owns only the rAF + accumulator mechanics.
 *
 * Rendering runs on EVERY animation frame, at the display's native rate, and
 * hands the renderer `alpha` — the fraction of a fixed step left in the
 * accumulator — so the view can interpolate moving actors between the last two
 * sim states. (A render cap sounds like a battery win, but on a 90Hz panel a
 * 60fps cap paints every 2nd vsync = 45fps while the sim steps at 60Hz, so
 * painted frames advance 1,1,2,1,1,2 sim steps — visible judder on everything
 * that moves. Interpolated per-vsync rendering is smooth on 60/90/120Hz alike.)
 */
export class Loop {
  /**
   * @param {number} fixedDt seconds per simulation step (e.g. 1/60)
   * @param {number} maxFrame clamp on a single frame's dt (avoids a huge catch-up
   *   spiral after a tab is backgrounded)
   */
  constructor(fixedDt, maxFrame) {
    this.fixedDt = fixedDt;
    this.maxFrame = maxFrame;
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._running = false;
  }

  /**
   * Begin (or restart) the loop. Idempotent — cancels any prior frame first and
   * resets the clock + accumulator, so calling it on each game start is safe.
   * @param {{
   *   shouldStep: () => boolean,
   *   step: (dt: number) => void,
   *   render: (frameDt: number, alpha: number) => void
   * }} handlers  `alpha` is the leftover sim-step fraction (0..1) — interpolate
   *   drawn positions between the previous and current sim state by it.
   */
  start({ shouldStep, step, render }) {
    this.stop();
    this._last = 0;
    this._acc = 0;
    this._running = true;
    const tick = (/** @type {DOMHighResTimeStamp} */ t) => {
      if (!this._running) return;  // stopped between frames — don't process or re-arm
      if (!this._last) this._last = t;
      const frame = Math.min(this.maxFrame, (t - this._last) / 1000);
      this._last = t;
      if (shouldStep()) {
        this._acc += frame;
        while (this._acc >= this.fixedDt) {
          step(this.fixedDt);
          this._acc -= this.fixedDt;
          if (!this._running) break;  // step() may end the game (stop) mid-pump
        }
      }
      // Paint every frame. While stepping is gated off the accumulator freezes,
      // so alpha is constant and the interpolated scene holds still.
      render(frame, this._acc / this.fixedDt);
      // Re-arm only while still running, so a stop() during step()/render() (e.g.
      // game over) actually halts the loop instead of re-scheduling forever.
      if (this._running) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  /** Halt the loop. No-op if already stopped. Safe to call from within step/render. */
  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }
}
