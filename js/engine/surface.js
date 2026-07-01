// @ts-check
/**
 * The drawing surface: owns the canvas backing store, the #stage element it
 * lives in, and the virtual (logical) bounds the game renders against. The play
 * area runs at a fixed virtual resolution; this sizes the canvas to it and
 * scales #stage to fill the viewport (see viewport.js for the math).
 *
 * Game-agnostic — like the Loop, it owns only the mechanics (resize/fullscreen
 * wiring, the viewport→virtual mapping, the #stage fit) and lets the host decide
 * what a resize MEANS via the `onResize` callback. The host repositions its
 * actors and repaints in there; this layer never knows about players or scoops.
 *
 * `bounds` is a single object mutated in place on resize (never reassigned), so a
 * host that hands the same reference to its simulation keeps a live view of the
 * play-area size for free.
 */
import { responsiveDims, fitRect } from './viewport.js';

export class Surface {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   stage: HTMLElement | null,
   *   fullscreenBtn?: HTMLElement | null,
   *   onResize?: () => void
   * }} opts  `onResize` fires AFTER the backing store has been resized (and only
   *   when the virtual dims actually changed) — reposition actors + repaint here.
   */
  constructor({ canvas, stage, fullscreenBtn, onResize }) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.stage = stage || null;
    this._onResize = onResize || (() => {});
    // Cached #stage bounding rect for toVirtual (the pointermove hot path);
    // null = stale, re-read lazily. Invalidated by fit().
    /** @type {DOMRect | null} */
    this._stageRect = null;

    // The virtual canvas tracks the viewport aspect (clamped to portrait) so it
    // fills the screen on mobile — no forced-aspect / letterbox mode.
    const d = responsiveDims(window.innerWidth, window.innerHeight);
    /** @type {{ width: number, height: number }} */
    this.bounds = { width: d.width, height: d.height };
    this.canvas.width = d.width;
    this.canvas.height = d.height;

    // Debounce resize: a mobile URL-bar show/hide fires a burst of resize events,
    // and each dim change reallocates the canvas backing store (a black flash) +
    // re-fires onResize. Coalesce the burst into a single resize once it settles.
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = /** @type {any} */ (setTimeout(() => this.resize(), 150));
    });
    // Fullscreen is just a bigger viewport — re-fit on enter/exit.
    document.addEventListener('fullscreenchange', () => this.resize());
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
  }

  /**
   * Map a screen-space point (clientX/Y) into virtual canvas coordinates, via the
   * #stage rect. Runs on every pointermove, so the rect is CACHED — a live
   * getBoundingClientRect would force a layout pass at input frequency, mid-drag.
   * fit() invalidates the cache.
   * @param {number} clientX @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  toVirtual(clientX, clientY) {
    let rect = this._stageRect;
    if (!rect) {
      if (!this.stage) return { x: 0, y: 0 };
      rect = this._stageRect = this.stage.getBoundingClientRect();
    }
    const w = rect.width || 1;
    const h = rect.height || 1;
    return {
      x: (clientX - rect.left) / w * this.bounds.width,
      y: (clientY - rect.top) / h * this.bounds.height
    };
  }

  /**
   * Fit #stage over the viewport. fitRect with a matching aspect yields a full-
   * bleed rect; with the portrait cap on a wide desktop it centers the column.
   * Drops the cached rect so the next pointer event re-reads it after this layout
   * change applies. Does NOT touch the backing store or repaint — that's resize().
   */
  fit() {
    if (!this.stage) return;
    const r = fitRect(window.innerWidth, window.innerHeight, this.bounds.width, this.bounds.height);
    this.stage.style.left = `${r.left}px`;
    this.stage.style.top = `${r.top}px`;
    this.stage.style.width = `${r.width}px`;
    this.stage.style.height = `${r.height}px`;
    this._stageRect = null;
  }

  /**
   * Re-derive the virtual canvas from the viewport aspect; when the dims change,
   * resize the backing store and fire onResize (the host repositions + repaints),
   * then fit #stage. Reassigning canvas.width wipes the backing store to
   * transparent and the next rAF paint may be a frame away — long enough to flash
   * the dark page background — so onResize MUST repaint synchronously.
   */
  resize() {
    if (!this.stage) return;
    const d = responsiveDims(window.innerWidth, window.innerHeight);
    if (d.width !== this.bounds.width || d.height !== this.bounds.height) {
      this.bounds.width = d.width;
      this.bounds.height = d.height;
      this.canvas.width = d.width;
      this.canvas.height = d.height;
      this._onResize();
    }
    this.fit();
  }

  toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}
