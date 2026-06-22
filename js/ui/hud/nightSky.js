// @ts-check
// The between-round sky beat: the current set's challenges drift into the night sky
// — completed goals already checked (committed before this shows) and, between days,
// the coins earned that day flip in below them — then everything dissolves away as the
// round begins. Showing them fades the in-game HUD out; the dissolve fades it back in
// (the dissolve IS the round start — no countdown). Driven by game.js at the
// night-cycle / fresh-start boundaries. Pure DOM; the fades are CSS transitions and
// the coins reuse the shared unlock-flip (auto-flips on render).
import { RECIPE_BY_ID } from '../../game/recipes.js';
import { challengeListHtml } from './templates/challengeTemplate.js';
import { rewardToCard, unlockCardHtml } from './templates/roundOverTemplate.js';

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

  /**
   * Render the current set's challenges (completed rows show checked) and, between
   * days, the coins earned that day. Fades them in and the in-game HUD out. `recap`
   * is null/undefined for the fresh-start intro (challenges only, no coins).
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} [recap]
   */
  show(recap = null) {
    if (!this.skyEl) return;
    clearTimeout(this._clearTimer);
    const cur = this.challenges && this.challenges.getCurrentSet();
    const coins = this._coinsFromRecap(recap);
    const coinsHtml = coins.length
      ? `<div class="sky-coins">${coins.map(c => `<div class="sky-coin">${unlockCardHtml(/** @type {any} */ (c))}</div>`).join('')}</div>`
      : '';
    const head = cur ? `<div class="sky-week">Week ${cur.index + 1}</div>` + challengeListHtml(cur) : '';
    this.skyEl.innerHTML = head + coinsHtml;
    document.body.classList.add('sky-challenges');   // fade the HUD out
    this.skyEl.classList.remove('hidden', 'dissolving');
    void this.skyEl.offsetWidth;                      // reflow so .visible fades in from 0
    this.skyEl.classList.add('visible');
  }

  /**
   * Build the coin cards earned this day from a between-day recap: regulars met,
   * the set reward(s) just granted, and recipes discovered today. Mirrors the
   * game-over carousel so a coin that flips here never re-appears as a "backlog".
   * @param {{ reveals?: string[], rewards?: any[], discoveries?: string[] } | null} recap
   */
  _coinsFromRecap(recap) {
    if (!recap) return [];
    const discoveryCards = (recap.discoveries || []).slice(0, 6).map(id => {
      const rec = RECIPE_BY_ID.get(id);
      return rec ? { kind: 'recipe', name: rec.name, colors: rec.colors } : null;
    }).filter(Boolean);
    return [
      ...(recap.reveals || []).map(name => ({ kind: 'regular', name })),
      ...(recap.rewards || []).map(r => rewardToCard(r)).filter(Boolean),
      ...discoveryCards
    ];
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
