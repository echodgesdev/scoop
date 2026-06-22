// @ts-check
// The between-round sky beat, played over the night-cycle sweep. Two phases:
//   1. Coins — the day's earned unlocks (regulars / rewards / discoveries) flip in as
//      an auto-cycling carousel on its own; a tap skips straight to the end.
//   2. Challenges — the current set drifts into the sky, completed goals checked, with
//      a "finish your run" note once it's cleared.
// then everything dissolves into the round (the dissolve IS the round start — no
// countdown). The fresh-start intro skips straight to phase 2 (no coins). Showing the
// sky fades the in-game HUD out; the dissolve fades it back in. Driven by game.js at
// the night-cycle / fresh-start boundaries; game.js stretches the night sweep so the
// carousel has room. Pure DOM — coins reuse the shared CoinCarousel.
import { challengeListHtml } from './templates/challengeTemplate.js';
import { rewardToCard } from './templates/roundOverTemplate.js';
import { RECIPE_BY_ID } from '../../game/recipes.js';
import { CoinCarousel } from './coinCarousel.js';

const DISSOLVE_MS = 1500;   // must outlast the #nightSky.dissolving CSS fade-out
const HANDOFF_MS = 800;     // beat between the last coin resting and the challenges

export class NightSky {
  /** @param {{ challenges: import('../../game/challenges.js').Challenges, sound?: any }} opts */
  constructor({ challenges, sound }) {
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;
    this.sound = sound || null;
    this.skyEl = document.getElementById('nightSky');
    /** @type {number} */
    this._clearTimer = 0;
    /** @type {number[]} */
    this._timers = [];
    this._phase = /** @type {'coins'|'challenges'|null} */ (null);
    /** @type {CoinCarousel|null} */
    this.carousel = null;
    // Tap the sky during the coin reveal to skip straight to the challenges.
    if (this.skyEl) {
      this.skyEl.addEventListener('click', () => {
        if (this._phase === 'coins' && this.carousel && this.carousel.cycling) this.carousel.skip();
      });
    }
  }

  /**
   * Open the sky. Between days, `recap` carries the day's coins — phase 1 plays them
   * in a carousel, then auto-advances to the challenges. The fresh-start intro passes
   * nothing, so it opens straight on the challenges.
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} [recap]
   */
  show(recap = null) {
    if (!this.skyEl) return;
    this._reset();
    const coins = this._coinsFromRecap(recap);
    document.body.classList.add('sky-challenges');   // fade the HUD out
    this.skyEl.classList.remove('hidden', 'dissolving');
    if (coins.length) this._showCoins(coins);
    else this._showChallenges();
    void this.skyEl.offsetWidth;                      // reflow so .visible fades in from 0
    this.skyEl.classList.add('visible');
  }

  /** Phase 1: the day's coins flip in as an auto-cycling carousel (tap to skip). */
  _showCoins(coins) {
    if (!this.skyEl) return;
    this._phase = 'coins';
    this.skyEl.classList.add('sky-tappable');         // accept the skip tap
    this.skyEl.innerHTML = `<div class="sky-carousel ro-carousel"></div><div class="sky-skip-hint">tap to skip</div>`;
    this.carousel = new CoinCarousel({ el: this.skyEl.querySelector('.sky-carousel'), sound: this.sound });
    this.carousel.start(coins, () => {
      // Last coin has rested — hold a beat, then hand off to the challenges.
      this._timers.push(/** @type {any} */ (setTimeout(() => this._showChallenges(), HANDOFF_MS)));
    });
  }

  /** Phase 2 (and the fresh-start intro): the set's challenges, completed goals checked. */
  _showChallenges() {
    if (!this.skyEl) return;
    this._phase = 'challenges';
    this.skyEl.classList.remove('sky-tappable');
    if (this.carousel) this.carousel.clear();
    const cur = this.challenges && this.challenges.getCurrentSet();
    this.skyEl.innerHTML = cur
      ? `<div class="sky-week">Week ${cur.index + 1}</div>` + challengeListHtml(cur)
      : '';
    this.skyEl.classList.remove('sky-fade-in');
    void this.skyEl.offsetWidth;                      // reflow so the swap fades in
    this.skyEl.classList.add('sky-fade-in');
  }

  /**
   * Build the coin cards earned this day from a between-day recap: regulars met, the
   * set reward(s) just granted, and recipes discovered today. Mirrors the game-over
   * carousel so a coin that flips here never re-appears as a "backlog".
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} recap
   */
  _coinsFromRecap(recap) {
    if (!recap) return [];
    // Show EVERY coin earned — none hidden. The carousel shortens each coin's dwell
    // past the ceiling (coinDwellMs) so a long list still fits a bounded night.
    const discoveryCards = (recap.discoveries || []).map(id => {
      const rec = RECIPE_BY_ID.get(id);
      return rec ? { kind: 'recipe', name: rec.name, colors: rec.colors } : null;
    }).filter(Boolean);
    return [
      ...(recap.reveals || []).map(name => ({ kind: 'regular', name })),
      ...(recap.rewards || []).map(r => rewardToCard(r)).filter(Boolean),
      ...discoveryCards
    ];
  }

  /** Slowly dissolve the sky (this IS the round start) and fade the HUD back in. */
  dissolve() {
    document.body.classList.remove('sky-challenges');  // HUD fades back in
    if (!this.skyEl) return;
    this._phase = null;
    if (this.carousel) this.carousel.clear();
    this.skyEl.classList.remove('visible', 'sky-tappable', 'sky-fade-in');
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

  /** Stop any in-flight phase timers + carousel (called when (re)opening the sky). */
  _reset() {
    clearTimeout(this._clearTimer);
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    if (this.carousel) this.carousel.clear();
    this._phase = null;
  }
}
