// @ts-check
// The menu overlays: the title screen (tap-to-begin + a Journal/High-Scores/Settings
// bottom bar), the Settings + High Scores modals, and the Pause menu — plus the
// best-score record and the idempotent wiring for every menu button. Persistent
// buttons (settings sliders, pause, reset…) wire once via a dataset guard; the title
// buttons + tap target are recreated on each rebuild, so they re-wire each call.
// Cross-concern buttons (open Journal) fire injected callbacks. (Game over routes
// through the round-over modal.)

import { challengeListHtml } from './templates/challengeTemplate.js';

const BEST_KEY = 'scoop.best';

function loadBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

export class Screens {
  /**
   * @param {{
   *   overlayEl: HTMLElement, settingsOverlayEl: HTMLElement, pauseOverlayEl: HTMLElement,
   *   challenges: import('../../game/challenges.js').Challenges,
   *   getInGame: () => boolean,
   *   getVolume: () => number, onSetVolume: (v: number) => void,
   *   getSensitivity: () => number, onSetSensitivity: (g: number) => void,
   *   getHaptics: () => boolean, onSetHaptics: (v: boolean) => void,
   *   onStart: () => void, onHowToPlay: () => void, onPauseToggle: () => void,
   *   onHome: () => void, onResetProgress: () => void, onShowJournal: () => void
   * }} opts
   */
  constructor({
    overlayEl, settingsOverlayEl, pauseOverlayEl, challenges,
    getInGame, getVolume, onSetVolume, getSensitivity, onSetSensitivity, getHaptics, onSetHaptics,
    onStart, onHowToPlay, onPauseToggle, onHome, onResetProgress, onShowJournal
  }) {
    this.overlayEl = overlayEl;
    // Snapshot the title markup so showTitle can rebuild it with fresh button
    // elements, keeping the (guard-less) re-wiring idempotent.
    this._titleHtml = overlayEl ? overlayEl.innerHTML : '';
    this.settingsOverlayEl = settingsOverlayEl;
    this.pauseOverlayEl = pauseOverlayEl;
    this.highScoresOverlayEl = document.getElementById('highScoresOverlay');
    /** @type {import('../../game/challenges.js').Challenges} */
    this.challenges = challenges;

    /** @type {() => void} */
    this.onStart = onStart || (() => {});
    this.onHowToPlay = onHowToPlay || (() => {});
    /** @type {() => boolean} true while an active run is in progress (How to Play is disabled then). */
    this.getInGame = getInGame || (() => false);
    /** @type {() => number} */
    this.getVolume = getVolume || (() => 1);
    /** @type {(v: number) => void} */
    this.onSetVolume = onSetVolume || (() => {});
    /** @type {() => number} relative-drag gain ("movement sensitivity") */
    this.getSensitivity = getSensitivity || (() => 2);
    /** @type {(g: number) => void} */
    this.onSetSensitivity = onSetSensitivity || (() => {});
    /** @type {() => boolean} vibration (haptics) enabled */
    this.getHaptics = getHaptics || (() => false);
    /** @type {(v: boolean) => void} */
    this.onSetHaptics = onSetHaptics || (() => {});
    /** @type {() => void} */
    this.onResetProgress = onResetProgress || (() => {});
    /** @type {() => void} — opens (or closes) the pause menu from the in-game ⏸ button. */
    this.onPauseToggle = onPauseToggle || (() => {});
    /** @type {() => void} — abandon the current run and return to the title screen. */
    this.onHome = onHome || (() => {});
    /** @type {() => void} — open the Journal hub (owned by another controller). */
    this.onShowJournal = onShowJournal || (() => {});

    this.best = loadBest();

    // Pause-menu resume callback (set by showPauseMenu, fired by the Resume
    // button click). Wired once so re-opening the menu doesn't double-attach.
    /** @type {() => void} */
    this._pauseResume = () => {};

    // Initial state: title screen is visible so the HUD should be faded out
    // until the player presses Start. Managed via body.menu-visible.
    this._setMenuVisible(true);
    this._wireMenuButtons();
  }

  /**
   * Wire the menu buttons that live in the overlay (start screen + game-
   * over screen) plus the settings/pause controls. Idempotent: called once on
   * construction for the initial start markup, and again after every overlay
   * rewrite so freshly-created buttons get listeners.
   */
  _wireMenuButtons() {
    // Tap anywhere on the title content (not the bottom bar) to begin — the same
    // "tap" verb as the round-over modal. Recreated each title rebuild, so re-wired.
    const titleContent = this.overlayEl ? this.overlayEl.querySelector('.title-content') : null;
    if (titleContent) titleContent.addEventListener('click', () => this.onStart());

    // High Scores modal (placeholder for now). #highScoresBtn is recreated on the
    // title rebuild so it re-wires each call; its Close button is persistent (guard).
    const highScoresBtn = document.getElementById('highScoresBtn');
    if (highScoresBtn) highScoresBtn.addEventListener('click', () => this.showHighScores());
    const closeHighScoresBtn = document.getElementById('closeHighScoresBtn');
    if (closeHighScoresBtn && !closeHighScoresBtn.dataset.wired) {
      closeHighScoresBtn.addEventListener('click', () => this.hideHighScores());
      closeHighScoresBtn.dataset.wired = '1';
    }

    // How to Play lives in the Settings modal now (persistent element → guard
    // against re-wiring). Close Settings first, then launch the tutorial. The
    // button is disabled mid-run by showSettings, so a click can't restart an
    // active game out from under the player.
    const howBtn = document.getElementById('howBtn');
    if (howBtn && !howBtn.dataset.wired) {
      howBtn.addEventListener('click', () => { this.hideSettings(); this.onHowToPlay(); });
      howBtn.dataset.wired = '1';
    }

    // Journal hub: one button that opens the tabbed collections. #journalBtn is
    // recreated on each title rebuild, so it re-wires itself each call — no guard.
    const journalBtn = document.getElementById('journalBtn');
    if (journalBtn) journalBtn.addEventListener('click', () => this.onShowJournal());

    // Settings is a menu item on the title + pause overlays.
    // Each wires once via the dataset guard; #settingsBtn is recreated on every
    // overlay rewrite, so it re-wires itself then.
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn && !settingsBtn.dataset.wired) {
      settingsBtn.addEventListener('click', () => this.showSettings());
      settingsBtn.dataset.wired = '1';
    }
    const pauseSettingsBtn = document.getElementById('pauseSettingsBtn');
    if (pauseSettingsBtn && !pauseSettingsBtn.dataset.wired) {
      pauseSettingsBtn.addEventListener('click', () => this.showSettings());
      pauseSettingsBtn.dataset.wired = '1';
    }
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn && !closeSettingsBtn.dataset.wired) {
      closeSettingsBtn.addEventListener('click', () => this.hideSettings());
      closeSettingsBtn.dataset.wired = '1';
    }
    const volumeSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('volumeSlider'));
    const volumeLabel  = /** @type {HTMLElement | null} */ (document.getElementById('volumeValue'));
    if (volumeSlider && !volumeSlider.dataset.wired) {
      volumeSlider.addEventListener('input', () => {
        const pct = parseInt(volumeSlider.value, 10);
        if (Number.isFinite(pct)) {
          this.onSetVolume(pct / 100);
          if (volumeLabel) volumeLabel.textContent = `${pct}%`;
        }
      });
      volumeSlider.dataset.wired = '1';
    }
    const sensSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('sensitivitySlider'));
    const sensLabel  = /** @type {HTMLElement | null} */ (document.getElementById('sensitivityValue'));
    if (sensSlider && !sensSlider.dataset.wired) {
      sensSlider.addEventListener('input', () => {
        const g = parseFloat(sensSlider.value);
        if (Number.isFinite(g)) {
          this.onSetSensitivity(g);
          if (sensLabel) sensLabel.textContent = `${g.toFixed(1)}×`;
        }
      });
      sensSlider.dataset.wired = '1';
    }
    const hapticsToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('hapticsToggle'));
    if (hapticsToggle && !hapticsToggle.dataset.wired) {
      hapticsToggle.addEventListener('change', () => this.onSetHaptics(hapticsToggle.checked));
      hapticsToggle.dataset.wired = '1';
    }
    // In-game ⏸ button (bottom-right, visible only during play). One-shot
    // wiring — clicking it opens the pause menu via the game-side toggle.
    const inGamePauseBtn = document.getElementById('pauseBtn');
    if (inGamePauseBtn && !inGamePauseBtn.dataset.wired) {
      inGamePauseBtn.addEventListener('click', () => this.onPauseToggle());
      inGamePauseBtn.dataset.wired = '1';
    }

    // Pause menu — wired once. The Resume callback is stored as
    // `this._pauseResume`, set fresh each time the menu opens, so the
    // listener fires whichever callback is current.
    const pauseResumeBtn = document.getElementById('pauseResumeBtn');
    if (pauseResumeBtn && !pauseResumeBtn.dataset.wired) {
      pauseResumeBtn.addEventListener('click', () => this._pauseResume());
      pauseResumeBtn.dataset.wired = '1';
    }
    const pauseJournalBtn = document.getElementById('pauseJournalBtn');
    if (pauseJournalBtn && !pauseJournalBtn.dataset.wired) {
      pauseJournalBtn.addEventListener('click', () => this.onShowJournal());
      pauseJournalBtn.dataset.wired = '1';
    }
    const pauseHomeBtn = document.getElementById('pauseHomeBtn');
    if (pauseHomeBtn && !pauseHomeBtn.dataset.wired) {
      pauseHomeBtn.addEventListener('click', () => {
        if (window.confirm('Quit this run and return to the title? Your current score will be lost.')) this.onHome();
      });
      pauseHomeBtn.dataset.wired = '1';
    }

    const resetBtn = document.getElementById('resetProgressBtn');
    if (resetBtn && !resetBtn.dataset.wired) {
      resetBtn.addEventListener('click', () => {
        if (window.confirm('Wipe ALL progress — challenges, recipes, power-ups, and unlocked regulars? This cannot be undone.')) {
          // onResetProgress is wrapped by the coordinator to also re-render the
          // open Journal panels, so the wipe is visible immediately.
          this.onResetProgress();
        }
      });
      resetBtn.dataset.wired = '1';
    }
  }

  hideOverlay() {
    this._clearHomeLayers();   // fade the title / buttons back out
    this._setMenuVisible(false);
  }

  /** Fade the title / buttons out (keeps the HUD hidden — used on tap-to-play). */
  fadeHomeOut() {
    this._clearHomeLayers();
  }

  /** Drop the staged-reveal classes so the title / buttons fade out together. */
  _clearHomeLayers() {
    this.overlayEl.classList.remove('home-title', 'home-buttons');
  }

  /**
   * Rebuild + show the title screen and hide the settings/pause menus — the Home
   * target. Rebuilds the title markup from the construction snapshot so its buttons
   * get fresh listeners on re-wire, then refreshes the best-score line. (The
   * coordinator hides the Journal + round-over modal first.)
   */
  showTitle() {
    this.hideSettings();
    this.hidePauseMenu();
    this.overlayEl.innerHTML = this._titleHtml;
    this._setMenuVisible(true);
    this.overlayEl.classList.remove('hidden');
    this._wireMenuButtons();
  }

  /**
   * Rebuild + wire the title screen but leave it faded OUT — the attract screen
   * plops the scoops onto the cone first, then fades the title in and the buttons
   * after it (revealHome*). Mirrors showTitle() minus the reveal.
   */
  beginAttract() {
    this.hideSettings();
    this.hidePauseMenu();
    this.overlayEl.innerHTML = this._titleHtml;
    this._setMenuVisible(true);
    this._clearHomeLayers();
    this.overlayEl.classList.remove('hidden');
    this._wireMenuButtons();
  }

  /** Fade the title/header in (above the scoops) + enable tap-to-begin. */
  revealHomeTitle() {
    if (this.overlayEl) this.overlayEl.classList.add('home-title');
  }
  /** Fade the bottom buttons in (after the title) + make them clickable. */
  revealHomeButtons() {
    if (this.overlayEl) this.overlayEl.classList.add('home-buttons');
  }

  /**
   * Toggles body.menu-visible. Used by CSS to fade the HUD out while the
   * start/game-over overlay is up and fade it back in when the player
   * resumes, and to hide the in-game ⏸ button on menu screens.
   * @param {boolean} visible
   */
  _setMenuVisible(visible) {
    document.body.classList.toggle('menu-visible', visible);
  }

  // === Settings modal =======================================================

  showSettings() {
    if (!this.settingsOverlayEl) return;
    // Sync the slider to the live volume each time the modal opens so it
    // reflects whatever the user dragged it to last session.
    const slider = /** @type {HTMLInputElement | null} */ (document.getElementById('volumeSlider'));
    const label = /** @type {HTMLElement | null} */ (document.getElementById('volumeValue'));
    if (slider) {
      const pct = Math.round(this.getVolume() * 100);
      slider.value = String(pct);
      if (label) label.textContent = `${pct}%`;
    }
    const sens = /** @type {HTMLInputElement | null} */ (document.getElementById('sensitivitySlider'));
    const sensLabel = /** @type {HTMLElement | null} */ (document.getElementById('sensitivityValue'));
    if (sens) {
      const g = this.getSensitivity();
      sens.value = String(g);
      if (sensLabel) sensLabel.textContent = `${g.toFixed(1)}×`;
    }
    const haptics = /** @type {HTMLInputElement | null} */ (document.getElementById('hapticsToggle'));
    if (haptics) haptics.checked = this.getHaptics();
    // How to Play restarts into the tutorial — disable it during an active run so
    // it can't blow away the game in progress (it's reachable here via the pause
    // menu). Enabled from the title / game-over, where there's nothing to lose.
    const howBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('howBtn'));
    if (howBtn) howBtn.disabled = this.getInGame();
    this.settingsOverlayEl.classList.remove('hidden');
  }

  hideSettings() {
    if (this.settingsOverlayEl) this.settingsOverlayEl.classList.add('hidden');
  }

  // === High scores (placeholder) ============================================

  showHighScores() {
    if (!this.highScoresOverlayEl) return;
    const body = this.highScoresOverlayEl.querySelector('.highscores-body');
    if (body) {
      body.innerHTML = this.best > 0
        ? `<div class="highscore-row"><span class="highscore-label">Best</span><span class="highscore-value">${this.best}</span></div>`
        : `<div class="highscore-empty">No runs yet — tap to begin!</div>`;
    }
    this.highScoresOverlayEl.classList.remove('hidden');
  }

  hideHighScores() {
    if (this.highScoresOverlayEl) this.highScoresOverlayEl.classList.add('hidden');
  }

  // === Pause menu ===========================================================

  /** @param {{ onResume: () => void }} opts */
  showPauseMenu({ onResume }) {
    this._pauseResume = onResume;
    if (!this.pauseOverlayEl) return;
    // Surface the current week's challenges (with live % progress) so the player
    // can check what they're working toward without leaving the run.
    const listEl = this.pauseOverlayEl.querySelector('.pause-challenges');
    if (listEl) {
      const cur = this.challenges && this.challenges.getCurrentSet();
      listEl.innerHTML = cur
        ? `<div class="wt-new-label">Week ${cur.index + 1}: ${cur.name}</div>` + challengeListHtml(cur)
        : '';
    }
    this.pauseOverlayEl.classList.remove('hidden');
  }

  hidePauseMenu() {
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.add('hidden');
  }

  // === Best score ============================================================

  /**
   * Record a final score: persist the best and report whether it set a new record
   * (shown on the round-over score card + the High Scores modal).
   * @param {number} score @returns {{ isRecord: boolean, best: number }}
   */
  recordScore(score) {
    const isRecord = score > this.best;
    if (isRecord) {
      this.best = score;
      localStorage.setItem(BEST_KEY, String(score));
    }
    return { isRecord, best: this.best };
  }
}
