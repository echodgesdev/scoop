// @ts-check
// The full-screen "round over" modal — used by BOTH the between-day transition and
// game over (they're identical except the primary button + what it does). It plays
// a tap-gated SEQUENCE so the recap isn't a wall of information all at once:
//
//   1. Challenges — the week's set; any newly-earned rows cross off with checkmarks.
//      If the set is now complete, the rows fade out and the "Complete the Week"
//      meter (or the next-week banner) fades in.
//   2. Unlocks — anything unlocked today flips in as coins in a CAROUSEL (current
//      coin large + centered, neighbours smaller / translucent), one tap per coin.
//   3. Score — the end-of-round card as a table.
//
// Tapping the stage skips the current animation / advances to the next beat; a
// "tap to continue" hint marks each rest point. Home / Journal / the primary button
// live in a fixed bottom bar. No countdown lives here — for next-wave the get-ready
// beat is the night sky → HUD (driven by game.js); game over just waits for input.
//
// Commit/advance semantics match the old flow: cross-offs → commitEarned() (captures
// the rewards the carousel then flips) → advanceSet() when the set/week completes.

import { RECIPE_BY_ID } from '../../game/recipes.js';
import { challengeRow } from './templates/challengeTemplate.js';
import { weekMeterHtml, rewardToCard, unlockCardHtml, scoreTableHtml } from './templates/roundOverTemplate.js';

// Auto-advance dwell per unlock coin: the ~0.7s flip plus a beat to read it.
const COIN_DWELL_MS = 1500;

export class RoundOver {
  /**
   * @param {{
   *   overlayEl: HTMLElement,
   *   challenges: import('../../game/challenges.js').Challenges,
   *   sound: import('../../engine/audio.js').Sound,
   *   onShowJournal: () => void,
   *   onHome: () => void
   * }} opts
   */
  constructor({ overlayEl, challenges, sound, onShowJournal, onHome }) {
    this.overlayEl = overlayEl;
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;
    /** @type {import('../../engine/audio.js').Sound} */
    this.sound = sound;
    this.onShowJournal = onShowJournal || (() => {});
    this.onHome = onHome || (() => {});

    const q = (sel) => overlayEl ? /** @type {HTMLElement|null} */ (overlayEl.querySelector(sel)) : null;
    this.contentEl = q('.ro-content');
    this.titleEl = q('.wt-title');
    this.subtitleEl = q('.wt-subtitle');
    this.challengesEl = q('.ro-challenges');
    this.carouselEl = q('.ro-carousel');
    this.scoreStageEl = q('.ro-score');
    this.hintEl = q('.ro-hint');
    this.journalBtnEl = q('.wt-journal-btn');

    // Sequence state (reset per open).
    this._mode = 'nextwave';      // 'nextwave' | 'gameover'
    /** @type {() => void} */
    this._final = () => {};
    /** @type {number[]} */
    this._timers = [];
    this._step = null;            // 'challenges' | 'unlocks' | 'score'
    this._settled = false;        // challenges step finalized once
    /** @type {(() => void) | null} jump the cross-off animation to its end state */
    this._crossoffFinalize = null;
    this._coins = [];
    this._coinIndex = 0;
    this._coinsRest = false;

    this._wire();
  }

  _wire() {
    if (!this.overlayEl) return;
    // The content stage is the tap target that drives / skips the sequence (and is
    // the finish — "tap to continue"); the bottom-bar buttons sit outside it.
    if (this.contentEl) this.contentEl.addEventListener('click', () => this._tap());
    const journal = this.overlayEl.querySelector('.wt-journal-btn');
    if (journal) journal.addEventListener('click', () => this.onShowJournal());
    const home = this.overlayEl.querySelector('.wt-home-btn');
    if (home) home.addEventListener('click', () => {
      // Game over already ended the run — no confirm. Mid-run, confirm the quit.
      if (this._mode === 'gameover' || window.confirm('Quit this run and return to the title? Your current score will be lost.')) {
        this.onHome();
      }
    });
  }

  // === Entry points ===========================================================

  /**
   * @param {{ completedWave: number, completedDayInWeek?: number, weekDays?: number, reveals?: string[], discoveries?: string[], stats?: any, onResume: () => void, tutorialMode?: ('first'|'replay'|null) }} opts
   */
  showNextWave({ completedDayInWeek = 1, weekDays = 7, reveals = [], discoveries = [], stats = null, onResume, tutorialMode = null }) {
    if (!this.overlayEl || !this.challenges) { if (onResume) onResume(); return; }
    this._mode = 'nextwave';
    this._final = onResume || (() => {});
    this._completedDayInWeek = completedDayInWeek;
    this._weekDays = weekDays;
    this._tutorialMode = tutorialMode;
    this._reveals = reveals || [];
    this._discoveries = discoveries || [];
    this._stats = stats;
    this._scoreExtra = {};
    this._open();
  }

  /**
   * @param {{ stats: any, onRestart: () => void, recipeEvents?: { unlocked: string[], mastered: string[] }, isRecord?: boolean, best?: number }} opts
   */
  showGameOver({ stats, onRestart, recipeEvents = { unlocked: [], mastered: [] }, isRecord = false, best = 0 }) {
    if (!this.overlayEl) { if (onRestart) onRestart(); return; }
    this._mode = 'gameover';
    this._final = onRestart || (() => {});
    this._completedDayInWeek = 1;
    this._weekDays = 7;
    this._tutorialMode = null;
    this._reveals = [];
    this._discoveries = [];
    this._stats = stats;
    this._scoreExtra = { isRecord, best, recipeEvents };
    this._open();
  }

  _open() {
    this._clearTimers();
    this._settled = false;
    this._crossoffFinalize = null;
    this._coins = [];
    this._coinIndex = 0;
    this._coinsRest = false;
    // Hide the in-game HUD buttons (debug / fit-to-screen / pause) behind the modal.
    document.body.classList.add('roundover-open');
    this.overlayEl.classList.remove('hidden');
    this._goChallenges();
  }

  hide() {
    this._clearTimers();
    document.body.classList.remove('roundover-open');
    if (this.journalBtnEl) this.journalBtnEl.classList.remove('flash');
    if (this.overlayEl) this.overlayEl.classList.add('hidden');
  }

  // === Tap routing ============================================================

  /** A tap on the stage drives / skips the sequence; at the score step it's the finish. */
  _tap() {
    if (this._step === 'challenges') {
      if (this._crossoffFinalize) {
        // Skip the cross-off animation → jump to the struck/checked end state.
        this._clearTimers();
        const finalize = this._crossoffFinalize;
        this._crossoffFinalize = null;
        finalize();
        this._challengesSettled();
      } else if (this._settled) {
        this._goUnlocks();
      }
    } else if (this._step === 'unlocks') {
      this._tapUnlocks();
    } else if (this._step === 'score') {
      this.hide();
      this._final();
    }
  }

  // === Step 1: challenges + cross-offs ========================================

  _goChallenges() {
    this._step = 'challenges';
    this._settled = false;
    this._showStage('challenges');
    this._setHint(false);
    const cur = this.challenges.getCurrentSet();
    if (this.titleEl) this.titleEl.textContent = cur ? `Week ${cur.index + 1}: ${cur.name}` : 'All Weeks Complete';
    if (this.subtitleEl) this.subtitleEl.textContent = this._mode === 'gameover' ? 'Game Over' : 'Day Complete';

    const earned = this.challenges.getEarnedNotCommitted();
    const earnedIds = new Set(earned.map(c => c.id));
    if (this.challengesEl) {
      this.challengesEl.classList.remove('fading-out', 'fading-in');
      this.challengesEl.innerHTML = cur
        ? cur.challenges.map(ch => {
            const row = challengeRow(ch);
            // Mark freshly-earned rows so the stagger below knows which to strike.
            return (!ch.completed && earnedIds.has(ch.id))
              ? row.replace('class="challenge-row"', 'class="challenge-row earned-pending"')
              : row;
          }).join('')
        : '';
    }
    this._animateCrossOffs(() => this._challengesSettled());
  }

  /**
   * Stagger a checkmark-pop + strike-through onto each earned row, then call `done`.
   * No progress bar anymore (rows show %), so it's just the pop + strike beats.
   * @param {() => void} done
   */
  _animateCrossOffs(done) {
    const container = this.challengesEl;
    const rows = container
      ? /** @type {HTMLElement[]} */ (Array.from(container.querySelectorAll('.challenge-row.earned-pending')))
      : [];
    if (!container || rows.length === 0) { this._crossoffFinalize = null; done(); return; }

    const stagger = 420, pop = 360, fade = 360;
    rows.forEach((row, i) => {
      const t0 = i * stagger;
      this._timers.push(/** @type {any} */ (setTimeout(() => {
        const count = row.querySelector('.challenge-count');
        if (count) count.textContent = '✓';
        row.classList.add('check-pop');
        if (this.sound) this.sound.perfect();
      }, t0 + 10)));
      this._timers.push(/** @type {any} */ (setTimeout(() => {
        row.classList.add('struck-fade');
        if (this.sound) this.sound.crossOff();
      }, t0 + pop)));
    });

    // Skip handler: snap every earned row straight to checked + struck.
    this._crossoffFinalize = () => {
      rows.forEach(row => {
        const count = row.querySelector('.challenge-count');
        if (count) count.textContent = '✓';
        row.classList.add('check-pop', 'struck-fade');
      });
    };

    const total = (rows.length - 1) * stagger + pop + fade + 200;
    this._timers.push(/** @type {any} */ (setTimeout(() => { this._crossoffFinalize = null; done(); }, total)));
  }

  /** Cross-offs are done (or skipped). Commit, build the unlock queue, show set-complete. */
  _challengesSettled() {
    if (this._settled) return;
    this._settled = true;
    this._crossoffFinalize = null;

    // Commit now so saved state matches the screen — and capture the rewards the
    // carousel will flip. (Idempotent: game.js commits again as a backstop.)
    let rewards = [];
    if (this.challenges) {
      const result = this.challenges.commitEarned();
      rewards = (result && result.rewards) || [];
    }
    const discoveryCards = this._discoveries.slice(0, 6).map(id => {
      const rec = RECIPE_BY_ID.get(id);
      return rec ? { kind: 'recipe', name: rec.name, colors: rec.colors } : null;
    }).filter(Boolean);
    this._coins = [
      ...this._reveals.map(name => ({ kind: 'regular', name })),
      ...rewards.map(r => rewardToCard(r)).filter(Boolean),
      ...discoveryCards
    ];

    this._maybeAdvanceSet();
    this._setHint(true);
  }

  /**
   * If the set/week is complete, fade the rows out and fade in the "Complete the
   * Week" meter (or the next-week banner), advancing the set where appropriate.
   * Mirrors the old _afterUnlocks branching.
   */
  _maybeAdvanceSet() {
    const el = this.challengesEl;
    if (!el || !this.challenges) return;
    const swap = (html) => {
      el.classList.add('fading-out');
      this._timers.push(/** @type {any} */ (setTimeout(() => {
        el.innerHTML = html;
        el.classList.remove('fading-out');
        el.classList.add('fading-in');
      }, 300)));
    };

    const mode = this._tutorialMode;
    if (mode === 'first') {
      this.challenges.advanceSet();
      const cur = this.challenges.getCurrentSet();
      const rows = cur ? cur.challenges.map(ch => challengeRow(ch)).join('') : '';
      const label = cur ? `Next up — Week ${cur.index + 1}: ${cur.name}` : 'All challenges complete!';
      swap(`<div class="wt-new-label">${label}</div>${rows}`);
      return;
    }
    if (mode === 'replay') return;

    const days = this._completedDayInWeek, target = this._weekDays;
    if (this.challenges.isCurrentSetComplete()) {
      if (days >= target) {
        const advanced = this.challenges.advanceSet();
        const next = advanced ? this.challenges.getCurrentSet() : null;
        if (next) {
          const rows = next.challenges.map(ch => challengeRow(ch)).join('');
          swap(`<div class="wt-new-label">🎉 Week complete!</div>`
            + `<div class="wt-new-label">Next up — Week ${next.index + 1}: ${next.name}</div>${rows}`);
        } else {
          swap(`<div class="wt-new-label">🏆 All Weeks complete!</div>`);
        }
      } else {
        swap(weekMeterHtml({ days, target }));
      }
    }
  }

  // === Step 2: unlocks carousel ===============================================

  _goUnlocks() {
    if (!this._coins.length) { this._goScore(); return; }
    this._step = 'unlocks';
    this._showStage('carousel');
    this._setHint(false);
    if (this.subtitleEl) this.subtitleEl.textContent = 'Unlocked!';
    // Pulse the Journal button as a CTA while coins are flipping in.
    if (this.journalBtnEl) this.journalBtnEl.classList.add('flash');
    if (this.carouselEl) {
      this.carouselEl.innerHTML = this._coins.map(c => `<div class="ro-coin">${unlockCardHtml(/** @type {any} */ (c))}</div>`).join('');
    }
    this._coinIndex = 0;
    this._coinsRest = false;
    this._layoutCarousel();
    this._cycleCoins();
  }

  /** Position every coin by its offset from the current one: centre large, others shrink + fade. */
  _layoutCarousel() {
    const coins = this.carouselEl ? Array.from(this.carouselEl.querySelectorAll('.ro-coin')) : [];
    coins.forEach((c, i) => {
      const off = i - this._coinIndex;
      const abs = Math.abs(off);
      const x = off * 150;
      const scale = off === 0 ? 1 : Math.max(0.42, 0.7 - (abs - 1) * 0.12);
      const opacity = off === 0 ? 1 : Math.max(0, 0.5 - (abs - 1) * 0.22);
      const el = /** @type {HTMLElement} */ (c);
      el.style.transform = `translateX(${x}px) scale(${scale})`;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(50 - abs);
      el.classList.toggle('current', off === 0);
    });
  }

  /**
   * Auto-cycle the carousel: flip the current coin, hold a beat, then advance to
   * the next — cycle, pause, cycle, pause. After the last coin it rests and shows
   * the continue hint.
   */
  _cycleCoins() {
    const coins = this.carouselEl ? Array.from(this.carouselEl.querySelectorAll('.ro-coin')) : [];
    const cur = /** @type {HTMLElement} */ (coins[this._coinIndex]);
    if (cur) {
      cur.classList.remove('snap');
      void cur.offsetWidth;      // reflow so the flip transition plays
      cur.classList.add('revealed');
      if (this.sound) this.sound.perfect();
    }
    this._timers.push(/** @type {any} */ (setTimeout(() => {
      if (this._coinIndex < this._coins.length - 1) {
        this._coinIndex += 1;
        this._layoutCarousel();
        this._cycleCoins();
      } else {
        this._coinsRest = true;
        this._setHint(true);
      }
    }, COIN_DWELL_MS)));
  }

  /** Tap during the carousel: at rest → score; mid-cycle → skip (reveal all at once). */
  _tapUnlocks() {
    if (this._coinsRest) { this._goScore(); return; }
    this._clearTimers();
    const coins = this.carouselEl ? Array.from(this.carouselEl.querySelectorAll('.ro-coin')) : [];
    coins.forEach(c => c.classList.add('snap', 'revealed'));
    this._coinIndex = this._coins.length - 1;
    this._layoutCarousel();
    this._coinsRest = true;
    this._setHint(true);
  }

  // === Step 3: score card =====================================================

  _goScore() {
    this._step = 'score';
    this._showStage('score');
    this._setHint(false);
    if (this.journalBtnEl) this.journalBtnEl.classList.remove('flash');
    if (this.subtitleEl) this.subtitleEl.textContent = this._mode === 'gameover' ? 'Final Score' : 'Day Complete';

    let html = scoreTableHtml(this._stats, this._scoreExtra);
    const ev = this._scoreExtra && this._scoreExtra.recipeEvents;
    if (ev) {
      const cel = [];
      if (ev.unlocked.length) cel.push(`<p class="celebration unlock">🎉 ${ev.unlocked.length} NEW RECIPE${ev.unlocked.length > 1 ? 'S' : ''} UNLOCKED!</p>`);
      if (ev.mastered.length) cel.push(`<p class="celebration master">⭐ ${ev.mastered.length} RECIPE${ev.mastered.length > 1 ? 'S' : ''} MASTERED!</p>`);
      html = cel.join('') + html;
    }
    if (this.scoreStageEl) this.scoreStageEl.innerHTML = html;
    // The score card is the finish: tapping the stage starts the next round / restarts.
    this._setHint(true, this._mode === 'gameover' ? 'tap to try again' : 'tap to continue');
  }

  // === Helpers ================================================================

  /** @param {'challenges'|'carousel'|'score'} which */
  _showStage(which) {
    if (this.challengesEl) this.challengesEl.classList.toggle('hidden', which !== 'challenges');
    if (this.carouselEl) this.carouselEl.classList.toggle('hidden', which !== 'carousel');
    if (this.scoreStageEl) this.scoreStageEl.classList.toggle('hidden', which !== 'score');
  }

  /** @param {boolean} show @param {string} [text] */
  _setHint(show, text = 'tap to continue') {
    if (!this.hintEl) return;
    if (show) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('hidden', !show);
  }

  _clearTimers() {
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
  }
}
