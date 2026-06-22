// @ts-check
// The full-screen end-of-RUN modal (game over). The between-day beat no longer uses
// it — that plays in the night sky. It runs a tap-gated SEQUENCE so the recap isn't a
// wall of information all at once:
//
//   1. Challenges — the current week's set; any newly-earned rows cross off with checks.
//   2. New Challenges — ONLY if the set was cleared this run: advance to the next set
//      and fade its challenges in (the next set surfaces on death, never mid-run).
//   3. Unlocks — anything unlocked this run flips in as coins in a CAROUSEL (current
//      coin large + centered, neighbours smaller / translucent), auto-cycled.
//   4. Score — the end-of-run card as a table ("tap to try again").
//
// Tapping the stage skips the current animation / advances to the next beat; a
// "tap to continue" hint marks each rest point. Home / Journal live in a fixed bottom
// bar. Commit happens at the cross-off; the set only ADVANCES on the new-challenges
// screen, so finishing a set's goals mid-run never reveals the next set until death.

import { RECIPE_BY_ID } from '../../game/recipes.js';
import { challengeListHtml } from './templates/challengeTemplate.js';
import { rewardToCard, scoreTableHtml } from './templates/roundOverTemplate.js';
import { CoinCarousel } from './coinCarousel.js';

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
    /** @type {() => void} */
    this._final = () => {};
    /** @type {number[]} */
    this._timers = [];
    this._step = null;            // 'challenges' | 'unlocks' | 'score'
    this._settled = false;        // challenges step finalized once
    /** @type {(() => void) | null} jump the cross-off animation to its end state */
    this._crossoffFinalize = null;
    this._coins = [];
    // The unlock-coins step is a shared auto-cycling carousel (also used by the
    // night sky). On the last coin it rests and shows the "tap to continue" hint.
    this.carousel = new CoinCarousel({ el: this.carouselEl, sound: this.sound });

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
    // Game over has already ended the run, so Home just navigates — no confirm.
    if (home) home.addEventListener('click', () => this.onHome());
  }

  // === Entry points ===========================================================

  /**
   * @param {{ stats: any, onRestart: () => void, recipeEvents?: { unlocked: string[], mastered: string[] }, isRecord?: boolean, best?: number, reveals?: string[], discoveries?: string[] }} opts
   *   reveals (regulars met) + discoveries (recipes made) are the final run's earnings —
   *   they flip in as coins after the challenges, alongside any set reward just granted.
   */
  showGameOver({ stats, onRestart, recipeEvents = { unlocked: [], mastered: [] }, isRecord = false, best = 0, reveals = [], discoveries = [] }) {
    if (!this.overlayEl) { if (onRestart) onRestart(); return; }
    this._final = onRestart || (() => {});
    this._reveals = reveals || [];
    this._discoveries = discoveries || [];
    this._stats = stats;
    this._scoreExtra = { isRecord, best, recipeEvents };
    this._open();
  }

  _open() {
    this._clearTimers();
    this._settled = false;
    this._crossoffFinalize = null;
    this._coins = [];
    this._setCleared = false;
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
        // Cleared the whole set this run → reveal the next set on its own screen
        // first; otherwise straight to the unlock coins.
        if (this._setCleared) this._goNewChallenges();
        else this._goUnlocks();
      }
    } else if (this._step === 'newchallenges') {
      this._goUnlocks();
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
    if (this.subtitleEl) this.subtitleEl.textContent = 'Game Over';

    const earnedIds = new Set(this.challenges.getEarnedNotCommitted().map(c => c.id));
    if (this.challengesEl) {
      this.challengesEl.classList.remove('fading-out', 'fading-in');
      this.challengesEl.innerHTML = challengeListHtml(cur, { earnedIds, doneNote: false });
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

  /** Cross-offs are done (or skipped). Commit, flag a cleared set, build the coin queue. */
  _challengesSettled() {
    if (this._settled) return;
    this._settled = true;
    this._crossoffFinalize = null;

    // Commit now (game.js no longer pre-commits on death, so the cross-off can show
    // first) — this captures any set reward to flip in the coins. Idempotent. Advancing
    // to the next set waits for the dedicated "new challenges" screen (a tap away).
    let result = { rewards: [], setComplete: false };
    if (this.challenges) result = this.challenges.commitEarned() || result;
    this._setCleared = !!result.setComplete;

    const discoveryCards = this._discoveries.slice(0, 6).map(id => {
      const rec = RECIPE_BY_ID.get(id);
      return rec ? { kind: 'recipe', name: rec.name, colors: rec.colors } : null;
    }).filter(Boolean);
    this._coins = [
      ...this._reveals.map(name => ({ kind: 'regular', name })),
      ...(result.rewards || []).map(r => rewardToCard(r)).filter(Boolean),
      ...discoveryCards
    ];
    this._setHint(true);
  }

  /**
   * Game over only: the player cleared the current set this run, so reveal the next
   * set on its own screen — advance, then fade its challenges in. The next set only
   * surfaces here (on death), never mid-run. A tap moves on to the unlock coins.
   */
  _goNewChallenges() {
    this._step = 'newchallenges';
    this._showStage('challenges');
    this._setHint(false);
    const advanced = this.challenges.advanceSet();
    const next = advanced ? this.challenges.getCurrentSet() : null;
    if (this.titleEl) this.titleEl.textContent = next ? `Week ${next.index + 1}: ${next.name}` : 'All Weeks Complete';
    if (this.subtitleEl) this.subtitleEl.textContent = next ? '✨ New Challenges' : '🏆 All Weeks Complete!';
    if (this.challengesEl) {
      this.challengesEl.classList.remove('fading-out', 'fading-in');
      this.challengesEl.innerHTML = next
        ? challengeListHtml(next, { doneNote: false })
        : `<div class="wt-new-label">🏆 You've cleared every week — bragging rights unlocked!</div>`;
      void this.challengesEl.offsetWidth;       // reflow so the fade-in plays
      this.challengesEl.classList.add('fading-in');
    }
    this._setHint(true);
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
    // The shared carousel flips the coins in turn, then rests + shows the hint.
    this.carousel.start(this._coins, () => this._setHint(true));
  }

  /** Tap during the carousel: mid-cycle → skip (reveal all); at rest → score. */
  _tapUnlocks() {
    if (this.carousel.cycling) this.carousel.skip();
    else this._goScore();
  }

  // === Step 3: score card =====================================================

  _goScore() {
    this._step = 'score';
    this._showStage('score');
    this._setHint(false);
    if (this.journalBtnEl) this.journalBtnEl.classList.remove('flash');
    if (this.subtitleEl) this.subtitleEl.textContent = 'Final Score';

    let html = scoreTableHtml(this._stats, this._scoreExtra);
    const ev = this._scoreExtra && this._scoreExtra.recipeEvents;
    if (ev) {
      const cel = [];
      if (ev.unlocked.length) cel.push(`<p class="celebration unlock">🎉 ${ev.unlocked.length} NEW RECIPE${ev.unlocked.length > 1 ? 'S' : ''} UNLOCKED!</p>`);
      if (ev.mastered.length) cel.push(`<p class="celebration master">⭐ ${ev.mastered.length} RECIPE${ev.mastered.length > 1 ? 'S' : ''} MASTERED!</p>`);
      html = cel.join('') + html;
    }
    if (this.scoreStageEl) this.scoreStageEl.innerHTML = html;
    // The score card is the finish: tapping the stage restarts the run.
    this._setHint(true, 'tap to try again');
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
    if (this.carousel) this.carousel.clear();   // the carousel runs its own timers
  }
}
