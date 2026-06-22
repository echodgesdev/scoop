// @ts-check
// The Journal hub: one tabbed overlay holding four collection panels (recipes,
// regulars, power-ups, challenges) plus the tap-a-coin detail popup. Owns its own
// elements + the once-only wiring for its close button, tabs, and coin taps; the
// per-panel markup is built by the template builders. State lives in the
// recipes/challenges/regulars models passed in — this just reads + renders them.

import { PICKUP_TYPE, PICKUP_TYPES } from '../../game/config.js';
import { GROUPS } from '../../game/recipes.js';
import {
  coinGrid, COIN_KIND,
  regularDetailHtml, powerupDetailHtml, recipeDetailHtml, challengeSetDetailHtml
} from './templates/collectionTemplate.js';

/** @typedef {import('../../game/recipes.js').Recipes} Recipes */

export class Journal {
  /**
   * @param {{
   *   journalOverlayEl: HTMLElement,
   *   recipes: Recipes,
   *   challenges: import('../../game/challenges.js').Challenges,
   *   regulars: import('../../game/regulars.js').Regulars
   * }} opts
   */
  constructor({ journalOverlayEl, recipes, challenges, regulars }) {
    this.journalOverlayEl = journalOverlayEl;
    // One Journal hub holds the four collection panels. Derive each panel element
    // so the _render* methods (which query within their panel) keep working — the
    // panels carry the original .recipes-list / .regulars-grid / etc.
    const journalPanel = (tab) => journalOverlayEl
      ? journalOverlayEl.querySelector(`.journal-panel[data-tab="${tab}"]`) : null;
    this.recipesOverlayEl = journalPanel('recipes');
    this.challengesOverlayEl = journalPanel('challenges');
    this.regularsOverlayEl = journalPanel('regulars');
    this.powerupsOverlayEl = journalPanel('powerups');
    // Tap-a-coin detail popup (lives outside the journal so it layers above it).
    this.journalDetailEl = document.getElementById('journalDetail');
    /** @type {Recipes} */
    this.recipes = recipes;
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;
    /** @type {import('../../game/regulars.js').Regulars} */
    this.regulars = regulars;

    this._wire();
  }

  /**
   * Wire the Journal's own controls — all persistent markup, so each is wired once
   * via a dataset guard: the Close button, the tab strip, the delegated coin tap
   * (coins are re-rendered each open), and the detail-popup dismiss.
   */
  _wire() {
    const closeJournalBtn = document.getElementById('closeJournalBtn');
    if (closeJournalBtn && !closeJournalBtn.dataset.wired) {
      closeJournalBtn.addEventListener('click', () => this.hide());
      closeJournalBtn.dataset.wired = '1';
    }
    if (this.journalOverlayEl && !this.journalOverlayEl.dataset.tabsWired) {
      this.journalOverlayEl.querySelectorAll('.journal-tab').forEach(tab => {
        tab.addEventListener('click', () => this._setTab(tab.getAttribute('data-tab') || 'recipes'));
      });
      // Tap a coin → its detail popup (delegated; coins are re-rendered each open).
      this.journalOverlayEl.addEventListener('click', (e) => {
        const coin = /** @type {HTMLElement} */ (e.target).closest('.jcoin');
        if (coin) this.showDetail(coin.getAttribute('data-kind') || '', coin.getAttribute('data-id') || '');
      });
      this.journalOverlayEl.dataset.tabsWired = '1';
    }
    // Detail popup: backdrop or Close dismisses it. Wired once.
    if (this.journalDetailEl && !this.journalDetailEl.dataset.wired) {
      this.journalDetailEl.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t === this.journalDetailEl || t.closest('.journal-detail-close')) this.hideDetail();
      });
      this.journalDetailEl.dataset.wired = '1';
    }
  }

  /**
   * Open the hub to a given tab (recipes | regulars | powerups | challenges) and
   * clear the CTA flash on whichever button opened it.
   * @param {string} [tab]
   */
  show(tab = 'recipes') {
    this._setTab(tab);
    if (this.journalOverlayEl) this.journalOverlayEl.classList.remove('hidden');
    const jb = document.getElementById('journalBtn');
    if (jb) jb.classList.remove('flash');
    const pjb = document.getElementById('pauseJournalBtn');
    if (pjb) pjb.classList.remove('flash');
  }

  hide() {
    if (this.journalOverlayEl) this.journalOverlayEl.classList.add('hidden');
  }

  /** Re-render every panel (after a progress wipe, so the reset shows immediately). */
  renderAll() {
    this._renderRecipes();
    this._renderChallenges();
    this._renderRegulars();
    this._renderPowerups();
  }

  /**
   * Activate a tab + its panel, then render that panel's content (so a tab only
   * renders when first shown / re-shown). @param {string} tab
   */
  _setTab(tab) {
    if (!this.journalOverlayEl) return;
    const valid = ['recipes', 'regulars', 'powerups', 'challenges'];
    if (!valid.includes(tab)) tab = 'recipes';
    this.journalOverlayEl.querySelectorAll('.journal-tab').forEach(t =>
      t.classList.toggle('active', t.getAttribute('data-tab') === tab));
    this.journalOverlayEl.querySelectorAll('.journal-panel').forEach(p =>
      p.classList.toggle('active', p.getAttribute('data-tab') === tab));
    if (tab === 'recipes') this._renderRecipes();
    else if (tab === 'regulars') this._renderRegulars();
    else if (tab === 'powerups') this._renderPowerups();
    else if (tab === 'challenges') this._renderChallenges();
  }

  /**
   * Collection grid: one coin per challenge set. A set's coin stays locked (no name)
   * until every goal in it is cleared, then lights up as a medal. Tapping a coin shows
   * that set's challenges, completed ones checked off (the detail popup). No "unlocks"
   * line — the set's reward stays a surprise until it's earned.
   */
  _renderChallenges() {
    if (!this.challenges || !this.challengesOverlayEl) return;
    const listEl = this.challengesOverlayEl.querySelector('.challenges-list');
    if (!listEl) return;
    listEl.innerHTML = coinGrid(COIN_KIND.CHALLENGE, this.challenges.getAllSets());
  }

  /**
   * Reference grid: one coin-style card per tip token — the four power-ups plus
   * the coin ($) cash tip — each an icon in a colored coin + name + what it does.
   * Power-ups are gated by challenge unlocks, so locked ones render greyed with a
   * "how to get it" hint; the coin is always available. Content from powerupVisuals.js.
   */
  _renderPowerups() {
    if (!this.powerupsOverlayEl) return;
    const listEl = this.powerupsOverlayEl.querySelector('.powerups-grid');
    if (!listEl) return;
    // Resolve each token's unlock/usage from challenges (the journal owns that
    // read), then hand the plain data + the kind to coinGrid to render — same
    // shape as the regular/recipe grids.
    const items = [...PICKUP_TYPES, PICKUP_TYPE.COIN].map(type => ({   // 4 power-ups + the coin cash tip
      type,
      unlocked: !this.challenges ? true
        : (type === PICKUP_TYPE.COIN ? this.challenges.isCoinUnlocked() : this.challenges.isPowerupUnlocked(type)),
      used: !this.challenges ? 0
        : (type === PICKUP_TYPE.COIN ? this.challenges.coinCollectedCount() : this.challenges.powerupUsedCount(type))
    }));
    listEl.innerHTML = coinGrid(COIN_KIND.POWERUP, items);
  }

  /**
   * Collection grid: a card per regular. Unlocked cards show the full face
   * (cropped from the sprite sheet), name, favorite recipe, blurb, and served
   * count. Locked cards show the same face as a darkened silhouette with "???"
   * — a tease of who's still to come, and a preview of the eventual unlock flip.
   */
  _renderRegulars() {
    if (!this.regulars || !this.regularsOverlayEl) return;
    const listEl = this.regularsOverlayEl.querySelector('.regulars-grid');
    const countEl = this.regularsOverlayEl.querySelector('.regulars-count');
    if (!listEl) return;
    if (countEl) countEl.textContent = `${this.regulars.unlockedCount()} / ${this.regulars.total} unlocked`;

    listEl.innerHTML = coinGrid(COIN_KIND.REGULAR, this.regulars.getAll());
  }

  _renderRecipes() {
    if (!this.recipes || !this.recipesOverlayEl) return;
    const listEl = this.recipesOverlayEl.querySelector('.recipes-list');
    if (!listEl) return;

    // Bucket every recipe under its named group (Junior Scoop, Daily Double,
    // ...). Section order follows the GROUPS list so headers appear in the
    // designed progression.
    /** @type {Map<string, ReturnType<Recipes['getAll']>>} */
    const byGroup = new Map();
    for (const r of this.recipes.getAll()) {
      if (!byGroup.has(r.group)) byGroup.set(r.group, []);
      /** @type {any} */ (byGroup.get(r.group)).push(r);
    }

    const html = [];
    for (const g of GROUPS) {
      const rows = byGroup.get(g.id);
      if (!rows || rows.length === 0) continue;
      // Section header shows "Name (mastered / total)" so the player can see
      // their progress per group at a glance. Could swap "mastered" for
      // "discovered" later if that reads better.
      const mastered = rows.filter(r => r.mastered).length;
      html.push(`<div class="recipe-section-header">
        <span class="recipe-section-name">${g.name}</span>
        <span class="recipe-section-total">${mastered} / ${rows.length}</span>
      </div>`);
      html.push(coinGrid(COIN_KIND.RECIPE, rows));
    }
    listEl.innerHTML = html.join('');
  }

  // === Detail popup (tap a coin → the info that used to crowd the card) ========

  /** @param {string} kind @param {string} id */
  showDetail(kind, id) {
    if (!this.journalDetailEl) return;
    let html = '';
    if (kind === COIN_KIND.REGULAR && this.regulars) {
      const r = this.regulars.getAll().find(x => x.name === id);
      if (r) html = regularDetailHtml(r);
    } else if (kind === COIN_KIND.POWERUP) {
      const unlocked = !this.challenges ? true
        : (id === PICKUP_TYPE.COIN ? this.challenges.isCoinUnlocked() : this.challenges.isPowerupUnlocked(id));
      const used = !this.challenges ? 0
        : (id === PICKUP_TYPE.COIN ? this.challenges.coinCollectedCount()
          : this.challenges.powerupUsedCount(/** @type {import('../../types.js').PickupTypeName} */ (id)));
      html = powerupDetailHtml(id, unlocked, used);
    } else if (kind === COIN_KIND.RECIPE && this.recipes) {
      const r = this.recipes.getAll().find(x => x.id === id);
      if (r) html = recipeDetailHtml(r);
    } else if (kind === COIN_KIND.CHALLENGE && this.challenges) {
      const set = this.challenges.getAllSets().find(s => String(s.index) === id);
      if (set) html = challengeSetDetailHtml(set);
    }
    if (!html) return;
    const body = this.journalDetailEl.querySelector('.journal-detail-body');
    if (body) body.innerHTML = html;
    this.journalDetailEl.classList.remove('hidden');
  }

  hideDetail() {
    if (this.journalDetailEl) this.journalDetailEl.classList.add('hidden');
  }
}
