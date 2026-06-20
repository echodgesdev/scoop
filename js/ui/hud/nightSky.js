// @ts-check
// The between-round sky beat: the current week's challenges drift into the night
// sky, then dissolve away as the round begins. Showing them fades the in-game HUD
// out; the dissolve fades it back in (the dissolve IS the round start — no
// countdown). Driven by game.js at the night-cycle / fresh-start boundaries. Pure
// DOM — challenge rows reuse the shared builder; the fades are CSS transitions.
import { challengeListHtml } from './templates/challengeTemplate.js';

const DISSOLVE_MS = 1500;   // must outlast the #nightSky.dissolving CSS fade-out

export class NightSky {
  /** @param {{ challenges: import('../../game/challenges.js').Challenges }} opts */
  constructor({ challenges }) {
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;
    this.skyEl = document.getElementById('nightSky');
    /** @type {number} */
    this._clearTimer = 0;
  }

  /** Render the current week's challenges, fade them in, and fade the in-game HUD out. */
  show() {
    if (!this.skyEl) return;
    clearTimeout(this._clearTimer);
    const cur = this.challenges && this.challenges.getCurrentSet();
    this.skyEl.innerHTML = cur
      ? `<div class="sky-week">Week ${cur.index + 1}</div>` + challengeListHtml(cur)
      : '';
    document.body.classList.add('sky-challenges');   // fade the HUD out
    this.skyEl.classList.remove('hidden', 'dissolving');
    void this.skyEl.offsetWidth;                      // reflow so .visible fades in from 0
    this.skyEl.classList.add('visible');
  }

  /** Slowly dissolve the challenges (this IS the round start) and fade the HUD back in. */
  dissolve() {
    document.body.classList.remove('sky-challenges');  // HUD fades back in
    if (!this.skyEl) return;
    this.skyEl.classList.remove('visible');
    this.skyEl.classList.add('dissolving');
    clearTimeout(this._clearTimer);
    this._clearTimer = /** @type {any} */ (setTimeout(() => {
      if (this.skyEl) {
        this.skyEl.classList.add('hidden');
        this.skyEl.classList.remove('dissolving');
        this.skyEl.innerHTML = '';
      }
    }, DISSOLVE_MS));
  }
}
