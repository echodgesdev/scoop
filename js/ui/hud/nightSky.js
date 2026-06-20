// @ts-check
// The between-round night-sequence HUD, moved off the canvas for consistency:
//   1. the current week's challenges drift in the night sky, fading with the
//      night sweep, and
//   2. the round-start countdown (3·2·1·GO) afterward.
// Driven per-frame by game.js during the night cycle + round intro. Pure DOM —
// the challenge rows reuse the shared challengeRow builder.
import { challengeRow } from './templates/challengeTemplate.js';

export class NightSky {
  /** @param {{ challenges: import('../../game/challenges.js').Challenges }} opts */
  constructor({ challenges }) {
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;
    this.skyEl = document.getElementById('nightSky');
    this.countdownEl = document.getElementById('roundIntro');
    this._skyShown = false;
  }

  /**
   * Per-frame during the night cycle: render the week's challenges once, then fade
   * by the night fraction — in over the first beat, hold, out over the last third.
   * @param {number} fraction night-cycle progress 0..1
   */
  showChallenges(fraction) {
    if (!this.skyEl) return;
    if (!this._skyShown) {
      this._skyShown = true;
      const cur = this.challenges && this.challenges.getCurrentSet();
      this.skyEl.innerHTML = cur
        ? `<div class="sky-week">Week ${cur.index + 1}</div>`
          + cur.challenges.map(ch => challengeRow(ch)).join('')
        : '';
      this.skyEl.classList.remove('hidden');
    }
    const a = fraction < 0.15 ? fraction / 0.15
      : fraction > 0.65 ? Math.max(0, (1 - fraction) / 0.35)
      : 1;
    this.skyEl.style.opacity = String(a);
  }

  hideChallenges() {
    if (!this._skyShown) return;   // already hidden — avoid per-frame churn from the intro
    this._skyShown = false;
    if (this.skyEl) { this.skyEl.classList.add('hidden'); this.skyEl.innerHTML = ''; }
  }

  /**
   * The round-start countdown beat, or null to hide. Big number for digits; a
   * smaller green word for the "GO!" cue.
   * @param {string|null} label
   */
  setCountdown(label) {
    if (!this.countdownEl) return;
    if (!label) {
      this.countdownEl.classList.add('hidden');
      this.countdownEl.textContent = '';
      return;
    }
    this.countdownEl.textContent = label;
    this.countdownEl.classList.toggle('intro-num', /^[0-9]$/.test(label));
    this.countdownEl.classList.toggle('intro-go', label === 'GO!');
    this.countdownEl.classList.remove('hidden');
  }
}
