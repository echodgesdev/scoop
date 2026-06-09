// @ts-check
/**
 * Fixed-timestep game loop. Each animation frame it clamps the elapsed time,
 * pumps as many fixed-dt simulation steps as have accumulated (only while
 * `shouldStep()` is true — so pausing simply stops accumulating), then renders
 * (throttled to `maxFps`). Game-agnostic: the host supplies the gate, the step,
 * and the render; this owns only the rAF + accumulator mechanics.
 */
export class Loop {
  /**
   * @param {number} fixedDt seconds per simulation step (e.g. 1/60)
   * @param {number} maxFrame clamp on a single frame's dt (avoids a huge catch-up
   *   spiral after a tab is backgrounded)
   * @param {number} [maxFps] cap the RENDER rate (0 = render every rAF). On 90/
   *   120Hz displays this skips the extra frames — the sim is fixed-step at
   *   fixedDt regardless, so rendering faster than this just burns GPU/battery.
   */
  constructor(fixedDt, maxFrame, maxFps = 0) {
    this.fixedDt = fixedDt;
    this.maxFrame = maxFrame;
    this.minRender = maxFps > 0 ? 1 / maxFps : 0;
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._renderAcc = 0;
    this._running = false;
  }

  /**
   * Begin (or restart) the loop. Idempotent — cancels any prior frame first and
   * resets the clock + accumulators, so calling it on each game start is safe.
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
    this._renderAcc = 0;
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
      // Render at most maxFps: accumulate real time and only paint once enough has
      // passed. The 2ms tolerance keeps a 60Hz display painting every frame rather
      // than occasionally dropping one; a 120Hz display paints every other frame.
      this._renderAcc += frame;
      if (this._renderAcc + 0.002 >= this.minRender) {
        render(this._renderAcc);
        this._renderAcc = 0;
      }
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
