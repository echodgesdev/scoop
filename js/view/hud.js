// @ts-check
import { COLORS, PICKUP_TYPES } from '../game/config.js';
import { RECIPE_TARGET, GROUPS, RECIPE_BY_ID, GROUP_BY_ID } from '../game/recipes.js';
import CUSTOMER_SPRITE from './sprites/customerSprite.js';
import { HUD_SCOOP_COL } from './sprites/hudScoopSprite.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR, PICKUP_NAME, PICKUP_DESC } from './powerupVisuals.js';

// Unlock-reveal queue timing (one coin flips at a time). Tuned to match the
// .wt-coin-flip CSS animation (0.4s hold + 0.9s flip) plus a short read beat
// before the next card cuts in.
const UNLOCK_ITEM_MS = 1650;

// Regulars collection screen. Faces are cropped out of the shared sprite sheet
// via CSS background-position: each regular's sheet ROW comes from the sprite
// def (animation index), and a fixed COLUMN picks the expression. The .regular-
// face tile size + background-size live in styles.css; keep them in step here.
const REGULAR_FACE_TILE = 120;       // on-screen face tile (px); matches styles.css
const REGULAR_FACE_COL = 1;          // column 1 = Default face — shown unlocked
const REGULAR_EMPTY_COL = 0;         // column 0 = Empty white "shadow" — shown locked (CSS greys it)
/** @type {Map<string, number>} regular name → sprite-sheet row (animation index) */
const REGULAR_ROW_BY_NAME = new Map(CUSTOMER_SPRITE.animations.map((a, i) => [a.name, i]));

// Journal coin tuning: a small scoop tile (stacked vertically inside the recipe
// coin) and the gauge denominators for each collection (recipes use RECIPE_TARGET).
const JCOIN_SCOOP_TILE = 20;
const JCOIN_FACE_TILE = 70;           // regular face crop sized to the coin (vs the 120px collection tile)
const REGULAR_GAUGE_MAX = 50;
const POWERUP_GAUGE_MAX = 100;
// Ring-gauge fill colors per collection (powerups use their own token color).
const REGULAR_RING = '#06d6a0';
const RECIPE_RING = '#ffb703';

/** @typedef {import('../game/recipes.js').Recipes} Recipes */

const BEST_KEY = 'scoop.best';

function loadBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

export class Hud {
  constructor({
    scoreEl, comboEl, healthFillEl, overlayEl, gaugeEl, flashEl,
    journalOverlayEl, settingsOverlayEl,
    waveTransitionOverlayEl, pauseOverlayEl, challengeToastEl,
    recipes, challenges, regulars, sound, onStart, onHowToPlay, getInGame,
    getVolume, onSetVolume, getSensitivity, onSetSensitivity,
    getHaptics, onSetHaptics, onResetProgress, onPauseToggle, onHome
  }) {
    this.scoreEl = scoreEl;
    this.comboEl = comboEl;
    this.healthFillEl = healthFillEl;
    this.overlayEl = overlayEl;
    // Snapshot the title markup now (from index.html) so Home can rebuild it —
    // showGameOver overwrites overlayEl's contents with the game-over card.
    this._titleHtml = overlayEl ? overlayEl.innerHTML : '';
    this.gaugeEl = gaugeEl;
    this.flashEl = flashEl;
    // One Journal hub holds the four collection panels. Derive each panel element
    // so the existing _render* methods (which query within their panel) are reused
    // verbatim — the panels keep the original .recipes-list / .regulars-grid / etc.
    this.journalOverlayEl = journalOverlayEl;
    const journalPanel = (tab) => journalOverlayEl
      ? journalOverlayEl.querySelector(`.journal-panel[data-tab="${tab}"]`) : null;
    this.recipesOverlayEl = journalPanel('recipes');
    this.challengesOverlayEl = journalPanel('challenges');
    this.regularsOverlayEl = journalPanel('regulars');
    this.powerupsOverlayEl = journalPanel('powerups');
    // Tap-a-coin detail popup (lives outside the journal so it layers above it).
    this.journalDetailEl = document.getElementById('journalDetail');
    this.settingsOverlayEl = settingsOverlayEl;
    this.waveTransitionOverlayEl = waveTransitionOverlayEl;
    this.pauseOverlayEl = pauseOverlayEl;
    this.challengeToastEl = challengeToastEl;
    /** @type {Recipes} */
    this.recipes = recipes;
    /** @type {import('../game/challenges.js').Challenges} */
    this.challenges = challenges;
    /** @type {import('../game/regulars.js').Regulars} */
    this.regulars = regulars;
    /** @type {import('../engine/audio.js').Sound} */
    this.sound = sound;

    // Toast queue: challenges that just hit their requirement during play.
    // Shown one at a time at the bottom of the screen, each fades in/out.
    /** @type {Array<{ title: string, icon: string }>} */
    this._toastQueue = [];
    this._toastShowing = false;

    // Last-written values for the per-frame HUD pull (_syncHud). The setters
    // below early-out when nothing visibly changed, so the gauge's SVG filter,
    // the health bar's transition, etc. aren't invalidated 60× a second — the
    // DOM is only touched on actual changes. (These caches always mirror the
    // DOM because the setters are the only writers.)
    this._lastScore = NaN;
    this._lastHealthQ = NaN;
    this._lastGaugeOff = NaN;
    this._lastComboKey = '';

    // Wave-transition timers & state. Created fresh in showWaveTransition.
    /** @type {number | null} */
    this._wtCountdownTimer = null;
    // Unlock-reveal queue (regulars/power-ups/sections flipping one at a time).
    /** @type {number | null} */
    this._unlockQueueTimer = null;
    /** @type {string[]} regular names to flip-reveal this transition (set in showWaveTransition) */
    this._pendingRegularReveals = [];
    /** @type {string[]} recipe ids discovered today to flip-reveal (set in showWaveTransition) */
    this._pendingDiscoveries = [];
    /** @type {'first'|'replay'|null} tutorial-end transition mode (set in showWaveTransition) */
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

    // Pause-menu resume callback (set by showPauseMenu, fired by the
    // Resume button click). Wired once at construction so re-opening the
    // pause menu doesn't double-attach listeners.
    /** @type {() => void} */
    this._pauseResume = () => {};
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
    this.best = loadBest();

    // Initial state: title screen is visible so the HUD should be faded out
    // until the player presses Start. Managed via body.menu-visible.
    this._setMenuVisible(true);

    if (this.gaugeEl) {
      this.gaugeFillEl = /** @type {SVGElement | null} */ (this.gaugeEl.querySelector('.ring-fill'));
      this.gaugeNumEl  = /** @type {HTMLElement | null} */ (this.gaugeEl.querySelector('.wave-num'));
    }

    // Combo readout = a label + a decay bar that drains as the chain ages.
    this.comboEl.innerHTML =
      '<span class="combo-text"></span>' +
      '<div class="combo-decay"><div class="combo-decay-fill"></div></div>';
    this.comboTextEl = /** @type {HTMLElement} */ (this.comboEl.querySelector('.combo-text'));
    this.comboDecayFillEl = /** @type {HTMLElement} */ (this.comboEl.querySelector('.combo-decay-fill'));

    this.showTitleBest();
    this._wireMenuButtons();
  }

  /**
   * Wire the menu buttons that live in the overlay (start screen + game-
   * over screen) plus the recipes-modal close button. Idempotent: called
   * once on construction for the initial start markup, and again after
   * every overlay rewrite so freshly-created buttons get listeners.
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
    if (journalBtn) journalBtn.addEventListener('click', () => this.showJournal());

    // 🏠 Home on the game-over card (recreated each showGameOver, like #journalBtn,
    // so it re-wires each call). The run already ended here — no confirm.
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.addEventListener('click', () => this.onHome());

    // Close + tab buttons live in the persistent Journal markup — wire once.
    const closeJournalBtn = document.getElementById('closeJournalBtn');
    if (closeJournalBtn && !closeJournalBtn.dataset.wired) {
      closeJournalBtn.addEventListener('click', () => this.hideJournal());
      closeJournalBtn.dataset.wired = '1';
    }
    if (this.journalOverlayEl && !this.journalOverlayEl.dataset.tabsWired) {
      this.journalOverlayEl.querySelectorAll('.journal-tab').forEach(tab => {
        tab.addEventListener('click', () => this._setJournalTab(tab.getAttribute('data-tab') || 'recipes'));
      });
      // Tap a coin → its detail popup (delegated; coins are re-rendered each open).
      this.journalOverlayEl.addEventListener('click', (e) => {
        const coin = /** @type {HTMLElement} */ (e.target).closest('.jcoin');
        if (coin) this.showJournalDetail(coin.getAttribute('data-kind') || '', coin.getAttribute('data-id') || '');
      });
      this.journalOverlayEl.dataset.tabsWired = '1';
    }
    // Journal detail popup: backdrop or Close dismisses it. Wired once.
    if (this.journalDetailEl && !this.journalDetailEl.dataset.wired) {
      this.journalDetailEl.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t === this.journalDetailEl || t.closest('.journal-detail-close')) this.hideJournalDetail();
      });
      this.journalDetailEl.dataset.wired = '1';
    }

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
      pauseJournalBtn.addEventListener('click', () => this.showJournal());
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
          this.onResetProgress();
          // Re-render any open modals so the wipe is visible immediately.
          this._renderRecipes();
          this._renderChallenges();
          this._renderRegulars();
          this._renderPowerups();
        }
      });
      resetBtn.dataset.wired = '1';
    }
  }

  // === Journal hub (tabbed collections) =====================================

  /**
   * Open the Journal hub to a given tab (recipes | regulars | powerups |
   * challenges) and clear the CTA flash. The four show* methods are thin deep-link
   * wrappers so existing callers (wave-transition, game-over CTA) keep working.
   * @param {string} [tab]
   */
  showJournal(tab = 'recipes') {
    this._setJournalTab(tab);
    if (this.journalOverlayEl) this.journalOverlayEl.classList.remove('hidden');
    const jb = document.getElementById('journalBtn');
    if (jb) jb.classList.remove('flash');
    const pjb = document.getElementById('pauseJournalBtn');
    if (pjb) pjb.classList.remove('flash');
  }

  hideJournal() {
    if (this.journalOverlayEl) this.journalOverlayEl.classList.add('hidden');
  }

  /**
   * Activate a Journal tab + its panel, then render that panel's content (so a
   * tab only renders when first shown / re-shown). @param {string} tab
   */
  _setJournalTab(tab) {
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

  /** Deep-link wrapper → open the Journal to the Challenges tab. */
  showChallenges() { this.showJournal('challenges'); }

  /**
   * Master-list view: every set rendered as a section, with the player's
   * current set highlighted and future sets greyed out. Each challenge
   * shows a progress bar so the player can see what's tracking.
   */
  _renderChallenges() {
    if (!this.challenges || !this.challengesOverlayEl) return;
    const listEl = this.challengesOverlayEl.querySelector('.challenges-list');
    if (!listEl) return;

    const sets = this.challenges.getAllSets();
    const html = [];
    for (const set of sets) {
      const headerCls = `challenge-set ${set.status}`;
      const badge =
        set.status === 'completed' ? '<span class="set-badge done">Completed</span>'
        : set.status === 'current' ? '<span class="set-badge current">This Week</span>'
        : '<span class="set-badge locked">Locked</span>';
      html.push(`<div class="${headerCls}">
        <div class="challenge-set-header">
          <span class="set-name">Week ${set.index + 1}: ${set.name}</span>
          ${badge}
        </div>`);
      // Rewards summary
      if (set.rewards.length > 0) {
        const rewardsText = set.rewards.map(r => this._rewardLabel(r)).join(', ');
        html.push(`<div class="challenge-set-rewards">Unlocks: ${rewardsText}</div>`);
      }
      // Challenges in this set — hide details for fully-locked future sets
      // so the player doesn't get spoiled on what's coming.
      if (set.status === 'locked') {
        html.push(`<div class="challenge-row locked"><div class="challenge-title">???</div></div>`);
      } else {
        for (const ch of set.challenges) html.push(this._renderChallengeRow(ch));
      }
      html.push(`</div>`);
    }
    listEl.innerHTML = html.join('');
  }

  /** @param {{ type: string, value: string }} r */
  _rewardLabel(r) {
    if (r.type === 'unlock_powerup') {
      const names = { heart: '❤️ Heart', feather: '⚡ Speed', pause: '❄️ Freeze', rainbow: '🌈 Rainbow' };
      return names[r.value] || r.value;
    }
    if (r.type === 'unlock_coin') return '🪙 Coin tips';
    if (r.type === 'unlock_regular') return `😀 ${r.value}`;
    if (r.type === 'unlock_section') {
      const g = GROUP_BY_ID.get(r.value);
      return g ? `${g.emoji} ${g.name}` : r.value;
    }
    return r.value;
  }

  /** @param {{ type: string, param?: string }} ch */
  _challengeIcon(ch) {
    if (ch.type === 'use_powerup_type') {
      switch (ch.param) {
        case 'heart':   return '❤️';
        case 'feather': return '⚡';
        case 'pause':   return '❄️';
        case 'rainbow': return '🌈';
      }
    }
    switch (ch.type) {
      case 'discover_recipes':  return '📖';
      case 'master_recipes':    return '⭐';
      case 'complete_section':  return '📚';
      case 'serve_customers':   return '🍦';
      case 'serve_regular':     return '😀';
      case 'use_powerup_wave':
      case 'use_powerup_total': return '⚡';
      case 'combo_reach':       return '🔥';
      case 'wave_reach':        return '🌊';
      default:                  return '•';
    }
  }

  /** @param {{ id: string, type: string, param?: string, title: string, progress: number, target: number, completed: boolean }} ch */
  _renderChallengeRow(ch) {
    const pct = Math.min(100, (ch.progress / ch.target) * 100);
    const cls = ch.completed ? 'challenge-row completed' : 'challenge-row';
    const icon = this._challengeIcon(ch);
    return `<div class="${cls}">
      <span class="challenge-icon">${icon}</span>
      <div class="challenge-body">
        <div class="challenge-title">${ch.title}</div>
        <div class="challenge-progress">
          <div class="challenge-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="challenge-count">${ch.completed ? '✓' : `${ch.progress}/${ch.target}`}</div>
    </div>`;
  }

  /** Deep-link wrappers → open the Journal to a specific tab. */
  showRecipes()  { this.showJournal('recipes'); }
  showRegulars() { this.showJournal('regulars'); }
  showPowerups() { this.showJournal('powerups'); }

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
    const tokens = [...PICKUP_TYPES, 'coin'];   // 4 power-ups + the coin cash tip
    listEl.innerHTML = `<div class="jcoin-grid">` + tokens.map(t => {
      const unlocked = !this.challenges
        ? true
        : (t === 'coin' ? this.challenges.isCoinUnlocked() : this.challenges.isPowerupUnlocked(t));
      const used = !this.challenges ? 0
        : (t === 'coin' ? this.challenges.coinCollectedCount() : this.challenges.powerupUsedCount(t));
      const pct = unlocked ? Math.min(100, (used / POWERUP_GAUGE_MAX) * 100) : 0;
      return this._coinHtml({
        kind: 'powerup', id: t,
        inner: `<span class="jcoin-emoji">${PICKUP_ICONS[t]}</span>`,
        ring: PICKUP_RING_COLOR[t], pct,
        name: unlocked ? (PICKUP_NAME[t] || t) : '???',
        locked: !unlocked
      });
    }).join('') + `</div>`;
  }

  // === Journal coin component (shared by recipes / regulars / power-ups) ======

  /** Just the gauge ring + face (no button/name) — reused by the grid + detail popup. */
  _coinVisual({ inner, ring, pct, badge = '' }) {
    return `<span class="jcoin-gauge" style="--pct:${pct};--ring:${ring}"><span class="jcoin-face">${inner}</span>${badge}</span>`;
  }

  /** A tappable coin: gauge ring + face + name. data-kind/id drive the detail popup. */
  _coinHtml({ kind, id, inner, ring, pct, name, locked, badge = '' }) {
    return `<button class="jcoin${locked ? ' locked' : ''}" data-kind="${kind}" data-id="${id}">${this._coinVisual({ inner, ring, pct, badge })}<span class="jcoin-name">${name}</span></button>`;
  }

  /** Regular face cropped from the customer sheet, sized to the coin. */
  _regularFaceInner(name, unlocked) {
    const T = JCOIN_FACE_TILE;
    const row = REGULAR_ROW_BY_NAME.get(name) || 0;
    const col = unlocked ? REGULAR_FACE_COL : REGULAR_EMPTY_COL;
    return `<span class="jcoin-face-img${unlocked ? '' : ' locked'}" style="background-position:-${col * T}px -${row * T}px"></span>`;
  }

  /** Recipe scoops stacked vertically inside a coin (grey blanks when locked). */
  _coinScoops(colors, locked, size) {
    const T = JCOIN_SCOOP_TILE;
    const cols = locked ? Array.from({ length: size }, () => HUD_SCOOP_COL.empty) : colors.map(c => HUD_SCOOP_COL[c]);
    const scoops = cols.map(col => `<span class="jcoin-scoop${locked ? ' empty' : ''}" style="background-position:-${col * T}px 0"></span>`).join('');
    return `<span class="jcoin-scoops">${scoops}</span>`;
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

    listEl.innerHTML = `<div class="jcoin-grid">` + this.regulars.getAll().map(r => {
      const pct = r.unlocked ? Math.min(100, (r.served / REGULAR_GAUGE_MAX) * 100) : 0;
      return this._coinHtml({
        kind: 'regular', id: r.name,
        inner: this._regularFaceInner(r.name, r.unlocked),
        ring: REGULAR_RING, pct,
        name: r.unlocked ? r.name : '???',
        locked: !r.unlocked
      });
    }).join('') + `</div>`;
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
      html.push(`<div class="jcoin-grid">${rows.map(r => this._recipeCoin(r)).join('')}</div>`);
    }
    listEl.innerHTML = html.join('');
  }

  /** One recipe coin: scoops stacked vertically, ring = completions / RECIPE_TARGET. */
  _recipeCoin(r) {
    const pct = r.locked ? 0 : Math.min(100, (r.count / RECIPE_TARGET) * 100);
    return this._coinHtml({
      kind: 'recipe', id: r.id,
      inner: this._coinScoops(r.colors, r.locked, r.size),
      ring: RECIPE_RING, pct,
      name: r.locked ? '???' : r.name,
      locked: r.locked,
      badge: (!r.locked && r.mastered) ? '<span class="jcoin-star">⭐</span>' : ''
    });
  }

  // === Journal detail popup (tap a coin → the info that used to crowd the card) =

  /** @param {string} kind @param {string} id */
  showJournalDetail(kind, id) {
    if (!this.journalDetailEl) return;
    let html = '';
    if (kind === 'regular' && this.regulars) {
      const r = this.regulars.getAll().find(x => x.name === id);
      if (r) html = this._regularDetailHtml(r);
    } else if (kind === 'powerup') {
      html = this._powerupDetailHtml(id);
    } else if (kind === 'recipe' && this.recipes) {
      const r = this.recipes.getAll().find(x => x.id === id);
      if (r) html = this._recipeDetailHtml(r);
    }
    if (!html) return;
    const body = this.journalDetailEl.querySelector('.journal-detail-body');
    if (body) body.innerHTML = html;
    this.journalDetailEl.classList.remove('hidden');
  }

  hideJournalDetail() {
    if (this.journalDetailEl) this.journalDetailEl.classList.add('hidden');
  }

  /** @param {{ name: string, unlocked: boolean, served: number, favoriteRecipe: string, blurb: string }} r */
  _regularDetailHtml(r) {
    const visual = this._coinVisual({
      inner: this._regularFaceInner(r.name, r.unlocked), ring: REGULAR_RING,
      pct: r.unlocked ? Math.min(100, (r.served / REGULAR_GAUGE_MAX) * 100) : 0
    });
    if (!r.unlocked) {
      return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">Serve them to unlock</div>`;
    }
    let fav = '';
    const recipe = RECIPE_BY_ID.get(r.favoriteRecipe);
    if (recipe) {
      const dots = recipe.colors.map(c => `<span class="recipe-swatch" style="background:${COLORS[c]}"></span>`).join('');
      fav = `<div class="regular-fav"><span class="regular-fav-pre">♥</span>${dots}<span class="regular-fav-name">${recipe.name}</span></div>`;
    }
    return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${r.name}</div>
      ${fav}<div class="jdetail-blurb">${r.blurb}</div>
      <div class="jdetail-line">Served ${r.served} / ${REGULAR_GAUGE_MAX}</div>`;
  }

  /** @param {string} t power-up type or 'coin' */
  _powerupDetailHtml(t) {
    const unlocked = !this.challenges ? true
      : (t === 'coin' ? this.challenges.isCoinUnlocked() : this.challenges.isPowerupUnlocked(t));
    const used = !this.challenges ? 0
      : (t === 'coin' ? this.challenges.coinCollectedCount() : this.challenges.powerupUsedCount(t));
    const visual = this._coinVisual({
      inner: `<span class="jcoin-emoji">${PICKUP_ICONS[t]}</span>`, ring: PICKUP_RING_COLOR[t],
      pct: unlocked ? Math.min(100, (used / POWERUP_GAUGE_MAX) * 100) : 0
    });
    if (!unlocked) {
      return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">🔒 Unlock by clearing challenges</div>`;
    }
    return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${PICKUP_NAME[t] || t}</div>
      <div class="jdetail-blurb">${PICKUP_DESC[t] || ''}</div>
      <div class="jdetail-line">Used ${used} / ${POWERUP_GAUGE_MAX}</div>`;
  }

  /** @param {ReturnType<Recipes['getAll']>[number]} r */
  _recipeDetailHtml(r) {
    const visual = this._coinVisual({
      inner: this._coinScoops(r.colors, r.locked, r.size), ring: RECIPE_RING,
      pct: r.locked ? 0 : Math.min(100, (r.count / RECIPE_TARGET) * 100),
      badge: (!r.locked && r.mastered) ? '<span class="jcoin-star">⭐</span>' : ''
    });
    if (r.locked) {
      return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">Serve it once to discover it</div>`;
    }
    const group = GROUP_BY_ID.get(r.group);
    return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${r.name}${r.mastered ? ' ⭐' : ''}</div>
      <div class="jdetail-blurb">${group ? group.name : ''}</div>
      <div class="jdetail-line">Completed ${r.count} / ${RECIPE_TARGET}${r.mastered ? ' · Mastered!' : ''}</div>`;
  }

  /** @param {number} score */
  setScore(score) {
    if (score === this._lastScore) return;
    this._lastScore = score;
    // Score panel is just the number — the HUD's panel style + position is
    // identity enough; the "Score:" label was visual clutter.
    this.scoreEl.textContent = String(score);
  }

  /**
   * @param {number} combo
   * @param {number} [fraction] combo-decay bar fill (time left before the chain drops)
   * @param {number} [breakerTarget] Tipping mode: the combo-breaker threshold.
   *   When > 0 the readout reframes as a charge meter ("🔥 6 / 8") and pulses
   *   as it nears the break; 0 (other modes) keeps the plain "N× combo" text.
   */
  setCombo(combo, fraction = 0, breakerTarget = 0) {
    // Quantize the decay-bar fill to 2% steps so the per-frame pull only
    // touches the DOM ~10×/s while the bar drains (the CSS width transition
    // smooths between steps), instead of restarting a transition every frame.
    const fillPct = combo > 1 ? Math.round(Math.max(0, Math.min(1, fraction)) * 50) * 2 : 0;
    const key = `${combo}|${fillPct}|${breakerTarget}`;
    if (key === this._lastComboKey) return;
    this._lastComboKey = key;
    if (combo > 1) {
      if (breakerTarget > 0) {
        this.comboTextEl.textContent = `🔥 ${combo} / ${breakerTarget}`;
        this.comboEl.classList.toggle('near-break', combo >= breakerTarget - 1);
      } else {
        this.comboTextEl.textContent = `🔥 ${combo}× combo`;
        this.comboEl.classList.remove('near-break');
      }
      this.comboDecayFillEl.style.width = `${fillPct}%`;
      this.comboEl.classList.add('show');
    } else {
      this.comboEl.classList.remove('show', 'near-break');
    }
  }

  /**
   * @param {number} wave the wave number shown inside the ring
   * @param {number} fraction wave-wide progress 0..1 (each phase is one quarter)
   */
  setGauge(wave, fraction) {
    if (!this.gaugeEl) return;
    if (this.gaugeNumEl && this.gaugeNumEl.textContent !== String(wave)) {
      this.gaugeNumEl.textContent = String(wave);
    }
    if (this.gaugeFillEl) {
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      // Inline style so the CSS transition fires reliably. With dasharray
      // pinned to 100 in the stylesheet, dashoffset alone drives the arc.
      // Quantized + change-guarded: the ring carries a drop-shadow filter, so
      // an every-frame write kept the compositor re-rendering it continuously.
      const off = Math.round((100 - pct) * 10) / 10;
      if (off !== this._lastGaugeOff) {
        this._lastGaugeOff = off;
        this.gaugeFillEl.style.strokeDashoffset = String(off);
      }
    }
  }

  /** Brief pulse on the ring stroke — called when a phase has just been cleared. */
  flashPhaseUp() {
    if (!this.gaugeFillEl) return;
    this.gaugeFillEl.classList.remove('phase-up');
    void this.gaugeFillEl.getBoundingClientRect();
    this.gaugeFillEl.classList.add('phase-up');
  }

  /** Big level-up effect on the gauge + a screen-wide flash. */
  flashWaveUp() {
    if (this.gaugeEl) {
      this.gaugeEl.classList.remove('celebrate', 'wave-up');
      void this.gaugeEl.offsetWidth;
      this.gaugeEl.classList.add('celebrate', 'wave-up');
      setTimeout(() => this.gaugeEl.classList.remove('celebrate', 'wave-up'), 900);
    }
    if (this.flashEl) {
      this.flashEl.classList.remove('go');
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add('go');
    }
  }

  /** Flash + shake the health bar to telegraph taking damage (fired on 'expire'). */
  flashHealthDamage() {
    const el = document.getElementById('health-track');
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;   // restart the CSS animation
    el.classList.add('hit');
  }

  /** Center of the gauge element in viewport coords (for particle bursts). */
  gaugeCenter() {
    if (!this.gaugeEl) return null;
    const r = this.gaugeEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** @param {number} fraction */
  setHealth(fraction) {
    // 0.5% steps — health only moves on damage/heal, so the guard makes this
    // write-free on the steady-state frames in between.
    const f = Math.round(Math.max(0, Math.min(1, fraction)) * 200) / 200;
    if (f === this._lastHealthQ) return;
    this._lastHealthQ = f;
    this.healthFillEl.style.width = `${f * 100}%`;
    // green -> amber -> red as it drains
    this.healthFillEl.style.background = `hsl(${120 * f}, 75%, 48%)`;
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
    this._setMenuVisible(false);
  }

  /**
   * Rebuild + show the title screen and hide every other menu — the Home target.
   * showGameOver replaced the start markup with the game-over card, so restore the
   * snapshot taken at construction, then re-wire and refresh the best-score line.
   */
  showTitle() {
    this.hideJournal();
    this.hideSettings();
    this.hidePauseMenu();
    this.hideWaveTransition();
    this.overlayEl.innerHTML = this._titleHtml;
    this._setMenuVisible(true);
    this.overlayEl.classList.remove('hidden');
    this._wireMenuButtons();
    this.showTitleBest();
  }

  /**
   * Tutorial-only: show/hide the day-meter callout by the wave gauge, and pulse
   * the gauge to draw the eye (body.day-hint). The scripted tutorial passes the
   * callout text per beat ("Complete orders…", "Finish the day!").
   * @param {boolean} show
   * @param {string|null} [text] optional override for the callout body text
   */
  setDayHint(show, text = null) {
    const el = document.getElementById('dayHint');
    if (el) {
      el.classList.toggle('hidden', !show);
      if (text) {
        const body = el.querySelector('.day-hint-body');
        if (body) body.textContent = text;
      }
    }
    document.body.classList.toggle('day-hint', show);
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
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.remove('hidden');
  }

  hidePauseMenu() {
    if (this.pauseOverlayEl) this.pauseOverlayEl.classList.add('hidden');
  }

  // === Mid-play toasts (challenge met / flavor discovered) ==================

  /** @param {{ title: string }} challenge */
  showChallengeToast(challenge) {
    if (!this.challengeToastEl) return;
    this._toastQueue.push({ title: challenge.title, icon: '✓' });
    if (!this._toastShowing) this._processToastQueue();
  }

  /** First-time flavor discovery — a quick named toast. @param {string} name */
  showDiscoveryToast(name) {
    if (!this.challengeToastEl) return;
    this._toastQueue.push({ title: `New flavor — ${name}`, icon: '🍦' });
    if (!this._toastShowing) this._processToastQueue();
  }

  _processToastQueue() {
    if (!this.challengeToastEl) return;
    if (this._toastQueue.length === 0) {
      this._toastShowing = false;
      return;
    }
    this._toastShowing = true;
    const next = /** @type {{ title: string, icon: string }} */ (this._toastQueue.shift());
    this.challengeToastEl.innerHTML =
      `<span class="toast-check">${next.icon}</span><span class="toast-title">${next.title}</span>`;
    // Trigger reflow so the class transition fires every time.
    void this.challengeToastEl.offsetWidth;
    this.challengeToastEl.classList.add('show');
    setTimeout(() => {
      if (this.challengeToastEl) this.challengeToastEl.classList.remove('show');
      setTimeout(() => this._processToastQueue(), 400);
    }, 1800);
  }

  // === Wave transition (between-wave overlay with cross-offs + countdown) ===

  /**
   * Map a committed challenge Reward to an unlock-reveal card descriptor, or null
   * for reward types that don't get a coin (none today). Power-ups / coin /
   * sections flip an emoji coin; a regular flips their silhouette → face.
   * @param {{ type: string, value: string }} r
   * @returns {{ kind: string, name?: string, emoji?: string, ring?: string, label?: string } | null}
   */
  _rewardToCard(r) {
    if (r.type === 'unlock_regular') return { kind: 'regular', name: r.value };
    if (r.type === 'unlock_coin') {
      return { kind: 'coin', emoji: PICKUP_ICONS.coin, ring: PICKUP_RING_COLOR.coin, label: 'Coin Tips Unlocked!' };
    }
    if (r.type === 'unlock_powerup') {
      return {
        kind: 'powerup',
        emoji: PICKUP_ICONS[r.value] || '⚡',
        ring: PICKUP_RING_COLOR[r.value] || '#ffd166',
        label: `New Power-up — ${PICKUP_NAME[r.value] || r.value}!`
      };
    }
    if (r.type === 'unlock_section') {
      const g = GROUP_BY_ID.get(r.value);
      return { kind: 'section', emoji: g ? g.emoji : '🍨', ring: '#ffd166', label: `New Recipes — ${g ? g.name : r.value}!` };
    }
    return null;
  }

  /**
   * Markup for one unlock coin. A 'regular' card crops silhouette/face from the
   * customer sheet (back → front); the emoji kinds (coin/power-up/section) show a
   * "?" coin that flips to the unlocked thing's emoji. Fresh markup each call so
   * the CSS flip replays.
   * @param {{ kind: string, name?: string, emoji?: string, ring?: string, label?: string }} item
   */
  _unlockCardHtml(item) {
    if (item.kind === 'regular') {
      const T = REGULAR_FACE_TILE;
      const row = REGULAR_ROW_BY_NAME.get(item.name || '') || 0;
      const back  = `background-position:-${REGULAR_EMPTY_COL * T}px -${row * T}px`;  // silhouette
      const front = `background-position:-${REGULAR_FACE_COL * T}px -${row * T}px`;   // full face
      return `<div class="wt-reveal-item">
        <div class="wt-reveal-coin"><div class="wt-reveal-inner">
          <div class="wt-reveal-face wt-reveal-back" style="${back}"></div>
          <div class="wt-reveal-face wt-reveal-front" style="${front}"></div>
        </div></div>
        <div class="wt-reveal-label">New Regular — <b>${item.name}</b>!</div>
      </div>`;
    }
    if (item.kind === 'recipe') {
      // A "?" coin that flips to the recipe's scoops stacked vertically.
      const scoops = this._coinScoops(item.colors || [], false, (item.colors || []).length);
      return `<div class="wt-reveal-item">
        <div class="wt-reveal-coin"><div class="wt-reveal-inner">
          <div class="wt-reveal-face wt-reveal-back wt-reveal-emoji" style="--ring:${RECIPE_RING}">?</div>
          <div class="wt-reveal-face wt-reveal-front wt-reveal-scoops" style="--ring:${RECIPE_RING}">${scoops}</div>
        </div></div>
        <div class="wt-reveal-label">New Flavor — <b>${item.name}</b>!</div>
      </div>`;
    }
    const ring = item.ring || '#ffd166';
    return `<div class="wt-reveal-item">
      <div class="wt-reveal-coin"><div class="wt-reveal-inner">
        <div class="wt-reveal-face wt-reveal-back wt-reveal-emoji" style="--ring:${ring}">?</div>
        <div class="wt-reveal-face wt-reveal-front wt-reveal-emoji" style="--ring:${ring}">${item.emoji || ''}</div>
      </div></div>
      <div class="wt-reveal-label">${item.label || ''}</div>
    </div>`;
  }

  /**
   * Play an unlock-reveal QUEUE: show one coin, let it flip, then cut to the next
   * until all have spun. Calls `done` when the queue empties (or immediately if
   * there's nothing to reveal). One timer at a time so hideWaveTransition can stop it.
   * @param {Array<{ kind: string, name?: string, emoji?: string, ring?: string, label?: string }>} items
   * @param {() => void} done
   */
  _runUnlockQueue(items, done) {
    const el = this.waveTransitionOverlayEl && this.waveTransitionOverlayEl.querySelector('.wt-reveal');
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
      el.innerHTML = this._unlockCardHtml(items[i]);
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
   * starts a 3-second countdown to Resume. Any button click cancels the
   * countdown and converts the centre button to "Play".
   *
   * @param {{ completedWave: number, completedDayInWeek?: number, weekDays?: number, reveals?: string[], discoveries?: string[], onResume: () => void, tutorialMode?: ('first'|'replay'|null) }} opts
   */
  showWaveTransition({ completedWave, completedDayInWeek = 1, weekDays = 7, reveals = [], discoveries = [], onResume, tutorialMode = null }) {
    if (!this.waveTransitionOverlayEl || !this.challenges) {
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
    const revealEl = this.waveTransitionOverlayEl.querySelector('.wt-reveal');
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

    const titleEl = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-title'));
    const subtitleEl = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-subtitle'));
    const challengesEl = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-challenges'));
    const rewardsEl = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-rewards'));

    if (titleEl) titleEl.textContent = `Day ${completedDayInWeek} Complete`;
    if (subtitleEl) {
      subtitleEl.textContent = cur ? `Week ${cur.index + 1}: ${cur.name}` : 'All challenges complete!';
    }
    if (rewardsEl) {
      rewardsEl.classList.add('hidden');
      rewardsEl.innerHTML = '';
    }

    // Render current-set rows. Earned rows get marked so the animation
    // step below knows which to strike.
    if (challengesEl && cur) {
      challengesEl.innerHTML = cur.challenges.map(ch => {
        const row = this._renderChallengeRow(ch);
        if (!ch.completed && earnedIds.has(ch.id)) {
          // Insert the marker class — keep it hidden until the stagger
          // sequence below adds .struck which triggers the CSS strike.
          return row.replace('class="challenge-row"', 'class="challenge-row earned-pending"');
        }
        return row;
      }).join('');
    }

    // Show overlay, then begin the cross-off sequence.
    this.waveTransitionOverlayEl.classList.remove('hidden');
    this._wireWaveTransitionButtons();
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
      ...result.rewards.map(r => this._rewardToCard(r)).filter(Boolean),
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
          const rows = cur ? cur.challenges.map(ch => this._renderChallengeRow(ch)).join('') : '';
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
            const rows = next.challenges.map(ch => this._renderChallengeRow(ch)).join('');
            challengesEl.innerHTML =
              `<div class="wt-new-label">🎉 Week complete!</div>` +
              `<div class="wt-new-label">Next up — Week ${next.index + 1}: ${next.name}</div>${rows}`;
          } else {
            challengesEl.innerHTML = `<div class="wt-new-label">🏆 All Weeks complete!</div>`;
          }
        } else {
          challengesEl.innerHTML =
            `<div class="wt-new-label">Challenges done — finish the Week!</div>` +
            this._weekMeterHtml({ days, target }) +
            `<div class="wt-finish-note">Reach Day ${target} to unlock next week's challenges.</div>`;
        }
        challengesEl.classList.remove('fading-out');
        challengesEl.classList.add('fading-in');
        this._startWtCountdown();
      }, 300);
    } else {
      this._startWtCountdown();
    }
  }

  /**
   * The "Complete the Week" meter, styled as a challenge row (icon + title +
   * progress bar + count) so it reads consistently with the challenges above it.
   */
  _weekMeterHtml(wp) {
    const pct = Math.min(100, (wp.days / wp.target) * 100);
    return `<div class="challenge-row">
      <span class="challenge-icon">📅</span>
      <div class="challenge-body">
        <div class="challenge-title">Complete the Week</div>
        <div class="challenge-progress">
          <div class="challenge-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="challenge-count">${wp.days}/${wp.target}</div>
    </div>`;
  }

  _startWtCountdown() {
    if (!this.waveTransitionOverlayEl) return;
    if (this._wtInterrupted) {
      this._showWtPlayButton();
      return;
    }
    const playLabel = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-play-label'));
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
   * Mouse moved while the wave-transition overlay is up: stop the countdown
   * and reveal the Play button. Wired once; a no-op outside the transition or
   * after it's already been interrupted.
   */
  _onWtMouseMove() {
    if (!this.waveTransitionOverlayEl) return;
    if (this.waveTransitionOverlayEl.classList.contains('hidden')) return;
    if (this._wtInterrupted) return;
    this._wtInterrupted = true;
    this._wtClearCountdown();
    this._showWtPlayButton();
  }

  _showWtPlayButton() {
    if (!this.waveTransitionOverlayEl) return;
    const playLabel = /** @type {HTMLElement | null} */ (this.waveTransitionOverlayEl.querySelector('.wt-play-label'));
    if (playLabel) playLabel.textContent = '▶ Play';
  }

  _wtClearCountdown() {
    if (this._wtCountdownTimer !== null) {
      clearInterval(this._wtCountdownTimer);
      this._wtCountdownTimer = null;
    }
  }

  /** Wire the wave-transition buttons each time the overlay is shown. */
  _wireWaveTransitionButtons() {
    if (!this.waveTransitionOverlayEl) return;
    const playBtn = this.waveTransitionOverlayEl.querySelector('.wt-play-btn');
    const journalBtn = this.waveTransitionOverlayEl.querySelector('.wt-journal-btn');

    // Idempotent listener attach via dataset flag.
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
        this.showJournal();
      });
      /** @type {HTMLElement} */ (journalBtn).dataset.wired = '1';
    }
    const homeBtn = this.waveTransitionOverlayEl.querySelector('.wt-home-btn');
    if (homeBtn && !(/** @type {HTMLElement} */ (homeBtn).dataset.wired)) {
      homeBtn.addEventListener('click', () => {
        if (!window.confirm('Quit this run and return to the title? Your current score will be lost.')) return;
        this._wtClearCountdown();
        this.onHome();
      });
      /** @type {HTMLElement} */ (homeBtn).dataset.wired = '1';
    }
  }

  hideWaveTransition() {
    this._wtClearCountdown();
    this._clearUnlockQueue();
    if (this.waveTransitionOverlayEl) this.waveTransitionOverlayEl.classList.add('hidden');
  }

  /** Title screen: surface the current best so there's something to beat. */
  showTitleBest() {
    const el = document.getElementById('title-best');
    if (el) el.textContent = this.best > 0 ? `Best: ${this.best}` : '';
  }

  /**
   * @param {string} title
   * @param {number} score
   * @param {number} bestCombo
   * @param {number} wave
   * @param {() => void} onRestart
   * @param {{ unlocked: string[], mastered: string[] }} [recipeEvents]
   */
  showGameOver(title, score, bestCombo, wave, onRestart, recipeEvents = { unlocked: [], mastered: [] }) {
    const isRecord = score > this.best;
    if (isRecord) {
      this.best = score;
      localStorage.setItem(BEST_KEY, String(score));
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

    // Suppress the dramatic title text — the overlay's appearance is signal
    // enough that the round ended. The stats card is the focus now.
    void title;

    // Build the current-challenges section that lives inside the card.
    let challengesSection = '';
    if (this.challenges) {
      const cur = this.challenges.getCurrentSet();
      if (cur) {
        const rows = cur.challenges.map(ch => this._renderChallengeRow(ch)).join('');
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
        <div class="stats-row">
          <div class="stat">
            <div class="stat-label">Score</div>
            <div class="stat-value">${score}${isRecord ? ' <span class="record-pill">🏆 NEW BEST</span>' : ''}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Day</div>
            <div class="stat-value">${wave}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Best Combo</div>
            <div class="stat-value">${bestCombo}×</div>
          </div>
        </div>
        <div class="best-line">Best ever <strong>${this.best}</strong></div>
        ${challengesSection}
      </div>
      <div class="menu-buttons gameover-buttons">
        <button id="journalBtn" class="secondary${flashCls}">📔 Journal</button>
        <button id="startBtn">▶ Play Again</button>
        <button id="settingsBtn" class="secondary">⚙️ Settings</button>
        <button id="homeBtn" class="secondary gameover-home-btn">🏠 Home</button>
      </div>
    `;
    this._wireMenuButtons();
  }
}
