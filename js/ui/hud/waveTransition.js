// @ts-check
// The between-day wave-transition overlay and its flow: pause, animate the
// cross-off of any earned-but-not-committed challenges, commit them, play ONE
// coin-flip queue for everything unlocked today (regulars → rewards → discovered
// recipes), then run a countdown to Resume (cancelled by any mouse move or button
// click). Owns the overlay element + all of its transient timers/state; reaches
// the Journal hub and Home via injected callbacks. Markup from the template builders.

import { RECIPE_BY_ID } from '../../game/recipes.js';
import { challengeRow } from './templates/challengeTemplate.js';
import { weekMeterHtml, wtStatsHtml, rewardToCard, unlockCardHtml } from './templates/waveTransitionTemplate.js';

// Unlock-reveal queue timing (one coin flips at a time). Tuned to match the
// .wt-coin-flip CSS animation (0.4s hold + 0.9s flip) plus a short read beat
// before the next card cuts in.
const UNLOCK_ITEM_MS = 1650;

export class WaveTransition {
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
    /** @type {() => void} */
    this.onShowJournal = onShowJournal || (() => {});
    /** @type {() => void} — abandon the current run and return to the title screen. */
    this.onHome = onHome || (() => {});

    // Timers & state. Created fresh in show().
    /** @type {number | null} */
    this._wtCountdownTimer = null;
    // Unlock-reveal queue (regulars/power-ups/sections flipping one at a time).
    /** @type {number | null} */
    this._unlockQueueTimer = null;
    /** @type {string[]} regular names to flip-reveal this transition (set in show) */
    this._pendingRegularReveals = [];
    /** @type {string[]} recipe ids discovered today to flip-reveal (set in show) */
    this._pendingDiscoveries = [];
    /** @type {'first'|'replay'|null} tutorial-end transition mode (set in show) */
    this._wtTutorialMode = null;
    /** @type {number} the day just completed (for the Week meter / week-complete check) */
    this._wtCompletedWave = 0;
    /** @type {number} completed day's per-week position (1..weekDays) */
    this._wtDayInWeek = 1;
    /** @type {number} days per week (meter denominator) */
    this._wtWeekDays = 7;
    this._wtInterrupted = false;
    /** @type {() => void} */
    this._wtResume = () => {};
    // Whether the one-time mouse-move-cancels-countdown listener is attached.
    this._wtMouseWired = false;
  }

  /**
   * Play an unlock-reveal QUEUE: show one coin, let it flip, then cut to the next
   * until all have spun. Calls `done` when the queue empties (or immediately if
   * there's nothing to reveal). One timer at a time so hide() can stop it.
   * @param {Array<{ kind: string, name?: string, emoji?: string, ring?: string, label?: string }>} items
   * @param {() => void} done
   */
  _runUnlockQueue(items, done) {
    const el = this.overlayEl && this.overlayEl.querySelector('.wt-reveal');
    this._clearUnlockQueue();
    if (!el || !items || items.length === 0) {
      if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
      done();
      return;
    }
    el.classList.remove('hidden');
    let i = 0;
    const showNext = () => {
      if (i >= items.length) {
        this._unlockQueueTimer = null;
        done();
        return;
      }
      el.innerHTML = unlockCardHtml(items[i]);
      if (this.sound) this.sound.perfect();   // a little "ding" on each flip
      i += 1;
      this._unlockQueueTimer = /** @type {any} */ (setTimeout(showNext, UNLOCK_ITEM_MS));
    };
    showNext();
  }

  _clearUnlockQueue() {
    if (this._unlockQueueTimer !== null) {
      clearTimeout(this._unlockQueueTimer);
      this._unlockQueueTimer = null;
    }
  }

  /**
   * Pauses gameplay, runs the cross-off animation on any earned-but-not-
   * committed challenges, optionally fades in a freshly-unlocked set, then
   * starts a countdown to Resume. Any button click cancels the countdown and
   * converts the centre button to "Play".
   *
   * @param {{ completedWave: number, completedDayInWeek?: number, weekDays?: number, reveals?: string[], discoveries?: string[], stats?: ({ score: number, dayCombo: number, bestCombo: number, favFlavor: string } | null), onResume: () => void, tutorialMode?: ('first'|'replay'|null) }} opts
   */
  show({ completedWave, completedDayInWeek = 1, weekDays = 7, reveals = [], discoveries = [], stats = null, onResume, tutorialMode = null }) {
    if (!this.overlayEl || !this.challenges) {
      // No overlay markup — resume immediately so the player isn't stuck.
      onResume();
      return;
    }
    this._wtTutorialMode = tutorialMode;
    this._wtCompletedWave = completedWave;
    this._wtDayInWeek = completedDayInWeek;
    this._wtWeekDays = weekDays;
    // The reveals (regulars met today) flip AFTER the cross-offs, together with
    // any rewards the commit grants + recipes discovered today — built into one
    // queue in _afterCrossOffs.
    this._pendingRegularReveals = reveals || [];
    this._pendingDiscoveries = discoveries || [];
    this._clearUnlockQueue();
    const revealEl = this.overlayEl.querySelector('.wt-reveal');
    if (revealEl) { revealEl.classList.add('hidden'); revealEl.innerHTML = ''; }
    this._wtResume = onResume;
    this._wtInterrupted = false;
    this._wtClearCountdown();

    // Any mouse movement during the transition cancels the auto-countdown and
    // hands control to the Play button — so reading the recap isn't rushed.
    if (!this._wtMouseWired) {
      this._wtMouseWired = true;
      window.addEventListener('mousemove', () => this._onWtMouseMove());
    }

    // Snapshot what's earned-but-not-committed BEFORE we render — these
    // are the rows we'll cross off.
    const earnedNow = this.challenges.getEarnedNotCommitted();
    const earnedIds = new Set(earnedNow.map(c => c.id));
    const cur = this.challenges.getCurrentSet();

    const titleEl = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-title'));
    const subtitleEl = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-subtitle'));
    const challengesEl = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-challenges'));
    const rewardsEl = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-rewards'));

    // Header: the Week is the H1, "Day Complete" the H2.
    if (titleEl) titleEl.textContent = cur ? `Week ${cur.index + 1}: ${cur.name}` : 'All Weeks Complete';
    if (subtitleEl) subtitleEl.textContent = 'Day Complete';
    const statsEl = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-stats'));
    if (statsEl) statsEl.innerHTML = stats ? wtStatsHtml(stats) : '';
    if (rewardsEl) {
      rewardsEl.classList.add('hidden');
      rewardsEl.innerHTML = '';
    }

    // Render current-set rows. Earned rows get marked so the animation
    // step below knows which to strike.
    if (challengesEl && cur) {
      challengesEl.innerHTML = cur.challenges.map(ch => {
        const row = challengeRow(ch);
        if (!ch.completed && earnedIds.has(ch.id)) {
          // Insert the marker class — keep it hidden until the stagger
          // sequence below adds .struck which triggers the CSS strike.
          return row.replace('class="challenge-row"', 'class="challenge-row earned-pending"');
        }
        return row;
      }).join('');
    }

    // Show overlay, then begin the cross-off sequence.
    this.overlayEl.classList.remove('hidden');
    this._wireButtons();
    this._animateCrossOffs(challengesEl, earnedIds, () => this._afterCrossOffs(rewardsEl, challengesEl));
  }

  /**
   * Three-beat completion animation, staggered per row:
   *   1. Progress bar slides from 0% → 100% (the "earning" finishes visually).
   *   2. Checkmark pops in with fanfare — bouncy scale + glow + a "ding" SFX.
   *   3. Progress bar fades out while the strike-through line-through fades
   *      onto the title text.
   * Calls `done` when the last row has finished its full sequence.
   *
   * @param {HTMLElement | null} container
   * @param {Set<string>} earnedIds
   * @param {() => void} done
   */
  _animateCrossOffs(container, earnedIds, done) {
    if (!container || earnedIds.size === 0) {
      done();
      return;
    }
    const rows = /** @type {HTMLElement[]} */ (Array.from(container.querySelectorAll('.challenge-row.earned-pending')));
    if (rows.length === 0) {
      done();
      return;
    }

    // Pin each earned row's progress bar to 0% so the fill animation has
    // somewhere to travel to. The renderer set it to 100% (since progress
    // already met the target) — override here before any reflow.
    rows.forEach(row => {
      const bar = /** @type {HTMLElement | null} */ (row.querySelector('.challenge-progress-bar'));
      if (bar) bar.style.width = '0%';
    });

    // Force a layout flush so the width:0% lands before we transition to
    // 100% — otherwise the browser may collapse the two assignments and
    // skip the animation.
    void container.offsetWidth;

    const stagger = 450;
    const fillDuration = 500;
    const popDuration = 450;
    const fadeDuration = 400;

    rows.forEach((row, i) => {
      const t0 = i * stagger;

      // 1. Fill the progress bar to 100%.
      setTimeout(() => {
        const bar = /** @type {HTMLElement | null} */ (row.querySelector('.challenge-progress-bar'));
        if (bar) bar.style.width = '100%';
      }, t0 + 10);

      // 2. Checkmark + fanfare: swap "3/3" → "✓", trigger the pop animation,
      //    play the celebratory "ding".
      setTimeout(() => {
        const count = row.querySelector('.challenge-count');
        if (count) count.textContent = '✓';
        row.classList.add('check-pop');
        if (this.sound) this.sound.perfect();
      }, t0 + fillDuration);

      // 3. Progress fades out, title gets line-through fade. The crossOff
      //    sound plays here — feels like the strike landing on the text.
      setTimeout(() => {
        row.classList.add('struck-fade');
        if (this.sound) this.sound.crossOff();
      }, t0 + fillDuration + popDuration);
    });

    const totalDuration = (rows.length - 1) * stagger + fillDuration + popDuration + fadeDuration + 200;
    setTimeout(done, totalDuration);
  }

  /**
   * After cross-offs: commit the day's earned challenges (which APPLIES any newly-
   * earned rewards once), then play ONE coin-flip queue for everything unlocked
   * today — the regulars you met, then the rewards (coin / power-up / recipe
   * section / challenge regular). When the queue finishes, _afterUnlocks handles
   * the set-complete nudge + the resume countdown.
   * @param {HTMLElement | null} rewardsEl
   * @param {HTMLElement | null} challengesEl
   */
  _afterCrossOffs(rewardsEl, challengesEl) {
    if (!this.challenges) return;
    // Commit now so the saved state matches what the player is seeing.
    const result = this.challenges.commitEarned();
    // The flip queue replaces the old static "🎁 Unlocked" text box — keep it hidden.
    if (rewardsEl) { rewardsEl.classList.add('hidden'); rewardsEl.innerHTML = ''; }

    // Recipes discovered today flip in as coins too (capped so the queue stays short).
    const discoveryCards = this._pendingDiscoveries.slice(0, 6).map(id => {
      const rec = RECIPE_BY_ID.get(id);
      return rec ? { kind: 'recipe', name: rec.name, colors: rec.colors } : null;
    }).filter(Boolean);
    const queue = [
      ...this._pendingRegularReveals.map(name => ({ kind: 'regular', name })),
      ...result.rewards.map(r => rewardToCard(r)).filter(Boolean),
      ...discoveryCards
    ];
    this._pendingRegularReveals = [];
    this._pendingDiscoveries = [];
    this._runUnlockQueue(/** @type {any[]} */ (queue), () => this._afterUnlocks(challengesEl));
    // NOTE: commitEarned is idempotent (rewardsClaimed guard), so _endGame's
    // later commit is a no-op. The next set is only revealed by advanceSet(),
    // which runs at the start of the FOLLOWING run — never mid-life.
  }

  /**
   * Queue done. If the set is now fully cleared, the next set won't appear until
   * this run ends — swap the challenge list for a "finish your run" nudge. Either
   * way, start the countdown to resume.
   * @param {HTMLElement | null} challengesEl
   */
  _afterUnlocks(challengesEl) {
    const mode = this._wtTutorialMode;

    // Tutorial end (first play): the "finish your run to unlock the next set" gate
    // does NOT apply — advance to Set 2 now and transition the panel to it.
    if (mode === 'first' && this.challenges) {
      this.challenges.advanceSet();   // coordinator restarts the week (day/difficulty) on resume
      if (challengesEl) {
        challengesEl.classList.add('fading-out');
        setTimeout(() => {
          const cur = this.challenges.getCurrentSet();
          const rows = cur ? cur.challenges.map(ch => challengeRow(ch)).join('') : '';
          const label = cur ? `Next up — Week ${cur.index + 1}: ${cur.name}` : 'All challenges complete!';
          challengesEl.innerHTML = `<div class="wt-new-label">${label}</div>${rows}`;
          challengesEl.classList.remove('fading-out');
          challengesEl.classList.add('fading-in');
          this._startWtCountdown();
        }, 300);
      } else {
        this._startWtCountdown();
      }
      return;
    }

    // Tutorial replay (sandbox): challenges are frozen — no advance, no nudge.
    if (mode === 'replay') { this._startWtCountdown(); return; }

    // Normal day. Once all of the Week's challenges are done, the panel swaps to
    // the "Complete the Week" meter (days played toward weekDays). When the Week is
    // fully done — challenges AND the 7th day — advance to next Week's challenges
    // (the coordinator restarts the week's day/difficulty on resume).
    const days = this._wtDayInWeek, target = this._wtWeekDays;
    if (this.challenges && this.challenges.isCurrentSetComplete() && challengesEl) {
      const weekDone = days >= target;
      challengesEl.classList.add('fading-out');
      setTimeout(() => {
        if (weekDone) {
          const advanced = this.challenges.advanceSet();
          const next = advanced ? this.challenges.getCurrentSet() : null;
          if (next) {
            const rows = next.challenges.map(ch => challengeRow(ch)).join('');
            challengesEl.innerHTML =
              `<div class="wt-new-label">🎉 Week complete!</div>` +
              `<div class="wt-new-label">Next up — Week ${next.index + 1}: ${next.name}</div>${rows}`;
          } else {
            challengesEl.innerHTML = `<div class="wt-new-label">🏆 All Weeks complete!</div>`;
          }
        } else {
          challengesEl.innerHTML = weekMeterHtml({ days, target });
        }
        challengesEl.classList.remove('fading-out');
        challengesEl.classList.add('fading-in');
        this._startWtCountdown();
      }, 300);
    } else {
      this._startWtCountdown();
    }
  }

  _startWtCountdown() {
    if (!this.overlayEl) return;
    if (this._wtInterrupted) {
      this._showWtPlayButton();
      return;
    }
    const playLabel = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-play-label'));
    if (!playLabel) return;
    let secondsLeft = 8;  // generous — gives time to read the cross-offs / rewards
    const tick = () => {
      if (this._wtInterrupted) {
        this._wtClearCountdown();
        this._showWtPlayButton();
        return;
      }
      if (secondsLeft <= 0) {
        this._wtClearCountdown();
        this._wtResume();
        return;
      }
      playLabel.textContent = `Next Day in ${secondsLeft}…`;
      secondsLeft -= 1;
    };
    tick();
    this._wtCountdownTimer = /** @type {any} */ (setInterval(tick, 1000));
  }

  /**
   * Mouse moved while the overlay is up: stop the countdown and reveal the Play
   * button. Wired once; a no-op outside the transition or after it's already
   * been interrupted.
   */
  _onWtMouseMove() {
    if (!this.overlayEl) return;
    if (this.overlayEl.classList.contains('hidden')) return;
    if (this._wtInterrupted) return;
    this._wtInterrupted = true;
    this._wtClearCountdown();
    this._showWtPlayButton();
  }

  _showWtPlayButton() {
    if (!this.overlayEl) return;
    const playLabel = /** @type {HTMLElement | null} */ (this.overlayEl.querySelector('.wt-play-label'));
    if (playLabel) playLabel.textContent = '▶ Play';
  }

  _wtClearCountdown() {
    if (this._wtCountdownTimer !== null) {
      clearInterval(this._wtCountdownTimer);
      this._wtCountdownTimer = null;
    }
  }

  /** Wire the overlay's buttons each time it's shown (idempotent via dataset flag). */
  _wireButtons() {
    if (!this.overlayEl) return;
    const playBtn = this.overlayEl.querySelector('.wt-play-btn');
    const journalBtn = this.overlayEl.querySelector('.wt-journal-btn');

    if (playBtn && !(/** @type {HTMLElement} */ (playBtn).dataset.wired)) {
      playBtn.addEventListener('click', () => {
        this._wtClearCountdown();
        this._wtResume();
      });
      /** @type {HTMLElement} */ (playBtn).dataset.wired = '1';
    }
    if (journalBtn && !(/** @type {HTMLElement} */ (journalBtn).dataset.wired)) {
      journalBtn.addEventListener('click', () => {
        this._wtInterrupted = true;
        this._wtClearCountdown();
        this._showWtPlayButton();
        this.onShowJournal();
      });
      /** @type {HTMLElement} */ (journalBtn).dataset.wired = '1';
    }
    const homeBtn = this.overlayEl.querySelector('.wt-home-btn');
    if (homeBtn && !(/** @type {HTMLElement} */ (homeBtn).dataset.wired)) {
      homeBtn.addEventListener('click', () => {
        if (!window.confirm('Quit this run and return to the title? Your current score will be lost.')) return;
        this._wtClearCountdown();
        this.onHome();
      });
      /** @type {HTMLElement} */ (homeBtn).dataset.wired = '1';
    }
  }

  hide() {
    this._wtClearCountdown();
    this._clearUnlockQueue();
    if (this.overlayEl) this.overlayEl.classList.add('hidden');
  }
}
