// @ts-check
/**
 * Fixed-timestep game loop. Each animation frame it clamps the elapsed time,
 * pumps as many fixed-dt simulation steps as have accumulated (only while
 * `shouldStep()` is true — so pausing simply stops accumulating), then renders
 * once with the real frame delta. Game-agnostic: the host supplies the gate, the
 * step, and the render; this owns only the rAF + accumulator mechanics.
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
  }

  /**
   * Begin (or restart) the loop. Idempotent — cancels any prior frame first and
   * resets the clock + accumulator, so calling it on each game start is safe.
   * @param {{
   *   shouldStep: () => boolean,
   *   step: (dt: number) => void,
   *   render: (frameDt: number) => void
   * }} handlers
   */
  start({ shouldStep, step, render }) {
    this.stop();
    this._last = 0;
    this._acc = 0;
    const tick = (/** @type {DOMHighResTimeStamp} */ t) => {
      if (!this._last) this._last = t;
      const frame = Math.min(this.maxFrame, (t - this._last) / 1000);
      this._last = t;
      if (shouldStep()) {
        this._acc += frame;
        while (this._acc >= this.fixedDt) {
          step(this.fixedDt);
          this._acc -= this.fixedDt;
        }
      }
      render(frame);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  /** Halt the loop (e.g. on game over). No-op if already stopped. */
  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }
}
