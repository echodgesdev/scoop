// @ts-check
// Mid-play toasts: "challenge met" / "flavor discovered" banners. Shown one at a
// time at the bottom of the screen, each fading in then out. Fully self-contained
// — owns its queue + the toast element; the Hud just forwards show* calls here.

export class Toasts {
  /** @param {HTMLElement | null} el the toast container */
  constructor(el) {
    this.el = el;
    /** @type {Array<{ title: string, icon: string }>} */
    this._queue = [];
    this._showing = false;
  }

  /** A challenge requirement was newly met. @param {{ title: string }} challenge */
  challenge(challenge) { this._push(challenge.title, '✓'); }

  /** First-time flavor discovery. @param {string} name */
  discovery(name) { this._push(`New flavor — ${name}`, '🍦'); }

  /** @param {string} title @param {string} icon */
  _push(title, icon) {
    if (!this.el) return;
    this._queue.push({ title, icon });
    if (!this._showing) this._process();
  }

  _process() {
    if (!this.el) return;
    if (this._queue.length === 0) { this._showing = false; return; }
    this._showing = true;
    const next = /** @type {{ title: string, icon: string }} */ (this._queue.shift());
    this.el.innerHTML =
      `<span class="toast-check">${next.icon}</span><span class="toast-title">${next.title}</span>`;
    void this.el.offsetWidth;   // restart the transition every time
    this.el.classList.add('show');
    setTimeout(() => {
      if (this.el) this.el.classList.remove('show');
      setTimeout(() => this._process(), 400);
    }, 1800);
  }
}
