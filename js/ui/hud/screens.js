// @ts-check
// The menu overlays: the title screen ↔ game-over card (they share one element),
// the Settings modal, and the Pause menu — plus the best-score line and the
// idempotent wiring for every menu button across them. The persistent buttons
// (settings sliders, pause, reset…) wire once via a dataset guard; the buttons
// recreated on each overlay rewrite (#startBtn, #journalBtn, #homeBtn, #settingsBtn)
// re-wire themselves each call. Cross-concern buttons (open Journal, Home) fire
// injected callbacks. Card markup from the template builders.

import { challengeRow } from './templates/challengeTemplate.js';
import { wtStatsHtml } from './templates/waveTransitionTemplate.js';

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
    // Snapshot the title markup now (from index.html) so Home can rebuild it —
    // showGameOver overwrites overlayEl's contents with the game-over card.
    this._titleHtml = overlayEl ? overlayEl.innerHTML : '';
    this.settingsOverlayEl = settingsOverlayEl;
    this.pauseOverlayEl = pauseOverlayEl;
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
    this.showTitleBest();
    this._wireMenuButtons();
  }

  /**
   * Wire the menu buttons that live in the overlay (start screen + game-
   * over screen) plus the settings/pause controls. Idempotent: called once on
   * construction for the initial start markup, and again after every overlay
   * rewrite so freshly-created buttons get listeners.
   */
  _wireMenuButtons() {
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.addEventListener('click', () => this.onStart());

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
    // recreated on the title + game-over overlays, so (like #startBtn) it re-wires
    // itself each call — no dataset guard.
    const journalBtn = document.getElementById('journalBtn');
    if (journalBtn) journalBtn.addEventListener('click', () => this.onShowJournal());

    // 🏠 Home on the game-over card (recreated each showGameOver, like #journalBtn,
    // so it re-wires each call). The run already ended here — no confirm.
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.addEventListener('click', () => this.onHome());

    // Settings is a menu item on three overlays (home, game-over card, pause).
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
    this.overlayEl.classList.add('hidden');
    this._setMenuVisible(false);
  }

  /**
   * Rebuild + show the title screen and hide the settings/pause menus — the Home
   * target. showGameOver replaced the start markup with the game-over card, so
   * restore the snapshot taken at construction, then re-wire and refresh the
   * best-score line. (The coordinator hides the Journal + wave-transition first.)
   */
  showTitle() {
    this.hideSettings();
    this.hidePauseMenu();
    this.overlayEl.innerHTML = this._titleHtml;
    this._setMenuVisible(true);
    this.overlayEl.classList.remove('hidden');
    this._wireMenuButtons();
    this.showTitleBest();
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
        ? `<div class="wt-new-label">Week ${cur.index + 1}: ${cur.name}</div>`
          + cur.challenges.map(ch => challengeRow(ch)).join('')
        : '';
    }
    this.pauseOverlayEl.classList.remove('hidden');
  }

  hidePauseMenu() {
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.add('hidden');
  }

  // === Title / game-over ====================================================

  /** Title screen: surface the current best so there's something to beat. */
  showTitleBest() {
    const el = document.getElementById('title-best');
    if (el) el.textContent = this.best > 0 ? `Best: ${this.best}` : '';
  }

  /**
   * @param {{ score: number, dayCombo: number, bestCombo: number, favFlavor: string }} stats
   * @param {() => void} onRestart
   * @param {{ unlocked: string[], mastered: string[] }} [recipeEvents]
   */
  showGameOver(stats, onRestart, recipeEvents = { unlocked: [], mastered: [] }) {
    const isRecord = stats.score > this.best;
    if (isRecord) {
      this.best = stats.score;
      localStorage.setItem(BEST_KEY, String(stats.score));
    }

    this.onStart = onRestart;

    const nUnlocked = recipeEvents.unlocked.length;
    const nMastered = recipeEvents.mastered.length;
    const celebrations = [];
    if (nUnlocked > 0) {
      celebrations.push(`<p class="celebration unlock">🎉 ${nUnlocked} NEW RECIPE${nUnlocked > 1 ? 'S' : ''} UNLOCKED!</p>`);
    }
    if (nMastered > 0) {
      celebrations.push(`<p class="celebration master">⭐ ${nMastered} RECIPE${nMastered > 1 ? 'S' : ''} MASTERED!</p>`);
    }
    // Flash the Journal button as a CTA when there's something to celebrate.
    const flashCls = (nUnlocked > 0 || nMastered > 0) ? ' flash' : '';

    // Build the current-challenges section that lives inside the card.
    let challengesSection = '';
    if (this.challenges) {
      const cur = this.challenges.getCurrentSet();
      if (cur) {
        const rows = cur.challenges.map(ch => challengeRow(ch)).join('');
        challengesSection = `
          <div class="card-divider"></div>
          <div class="gameover-challenges-header">
            <span class="set-tag">Week ${cur.index + 1}</span>
            <span class="set-tag-name">${cur.name}</span>
          </div>
          <div class="gameover-challenges-list">${rows}</div>`;
      } else {
        challengesSection = `
          <div class="card-divider"></div>
          <p class="celebration master">🏆 ALL CHALLENGES COMPLETE!</p>`;
      }
    }

    this._setMenuVisible(true);
    this.overlayEl.classList.remove('hidden');
    this.overlayEl.innerHTML = `
      ${celebrations.join('')}
      <div class="gameover-card">
        <div class="wt-stats">${wtStatsHtml(stats)}</div>
        <div class="best-line">${isRecord ? '🏆 NEW BEST!' : `Best ever <strong>${this.best}</strong>`}</div>
        ${challengesSection}
      </div>
      <div class="menu-buttons gameover-buttons">
        <button id="journalBtn" class="secondary${flashCls}">📔 Journal</button>
        <button id="startBtn">▶ Play Again</button>
        <button id="homeBtn" class="secondary">🏠 Home</button>
        <button id="settingsBtn" class="secondary gameover-settings-btn">⚙️ Settings</button>
      </div>
    `;
    this._wireMenuButtons();
  }
}
