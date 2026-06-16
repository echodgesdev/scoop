// @ts-check
import { COLORS } from '../game/config.js';
import { RECIPE_TARGET, GROUPS } from '../game/recipes.js';
import CUSTOMER_SPRITE from './sprites/customerSprite.js';
import { HUD_SCOOP_COL } from './sprites/hudScoopSprite.js';

const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));

// Regulars collection screen. Faces are cropped out of the shared sprite sheet
// via CSS background-position: each regular's sheet ROW comes from the sprite
// def (animation index), and a fixed COLUMN picks the expression. The .regular-
// face tile size + background-size live in styles.css; keep them in step here.
const REGULAR_FACE_TILE = 120;       // on-screen face tile (px); matches styles.css
const REGULAR_FACE_COL = 1;          // column 1 = Default face — shown unlocked
const REGULAR_EMPTY_COL = 0;         // column 0 = Empty white "shadow" — shown locked (CSS greys it)
/** @type {Map<string, number>} regular name → sprite-sheet row (animation index) */
const REGULAR_ROW_BY_NAME = new Map(CUSTOMER_SPRITE.animations.map((a, i) => [a.name, i]));
// Favorite-flavor display names (the recipe book bakes these at seed time; the
// collection card just needs the label next to the swatch).
const FLAVOR_LABEL = { pink: 'Strawberry', mint: 'Mint', choco: 'Chocolate', vanilla: 'Vanilla', blueberry: 'Blueberry' };

// Recipe-book scoop icon tile (px). The .recipe-scoop background-size in
// styles.css is 7× this wide × this tall — keep them in step.
const RECIPE_SCOOP_TILE = 28;

/** @typedef {import('../game/recipes.js').Recipes} Recipes */

const BEST_KEY = 'scoop.best';

function loadBest() {
  const n = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

export class Hud {
  constructor({
    scoreEl, comboEl, healthFillEl, overlayEl, gaugeEl, flashEl,
    recipesOverlayEl, challengesOverlayEl, regularsOverlayEl, settingsOverlayEl,
    waveTransitionOverlayEl, pauseOverlayEl, challengeToastEl,
    recipes, challenges, regulars, sound, onStart, onHowToPlay, getInGame,
    getVolume, onSetVolume, getSensitivity, onSetSensitivity,
    getHaptics, onSetHaptics, onResetProgress, onPauseToggle
  }) {
    this.scoreEl = scoreEl;
    this.comboEl = comboEl;
    this.healthFillEl = healthFillEl;
    this.overlayEl = overlayEl;
    this.gaugeEl = gaugeEl;
    this.flashEl = flashEl;
    this.recipesOverlayEl = recipesOverlayEl;
    this.challengesOverlayEl = challengesOverlayEl;
    this.regularsOverlayEl = regularsOverlayEl;
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
    /** @type {Array<{ title: string }>} */
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

    const recipesBtn = document.getElementById('recipesBtn');
    if (recipesBtn) recipesBtn.addEventListener('click', () => this.showRecipes());

    const closeBtn = document.getElementById('closeRecipesBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideRecipes());

    const challengesBtn = document.getElementById('challengesBtn');
    if (challengesBtn) challengesBtn.addEventListener('click', () => this.showChallenges());

    const closeChallengesBtn = document.getElementById('closeChallengesBtn');
    if (closeChallengesBtn) closeChallengesBtn.addEventListener('click', () => this.hideChallenges());

    const regularsBtn = document.getElementById('regularsBtn');
    if (regularsBtn) regularsBtn.addEventListener('click', () => this.showRegulars());

    const closeRegularsBtn = document.getElementById('closeRegularsBtn');
    if (closeRegularsBtn && !closeRegularsBtn.dataset.wired) {
      closeRegularsBtn.addEventListener('click', () => this.hideRegulars());
      closeRegularsBtn.dataset.wired = '1';
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
    const pauseRecipesBtn = document.getElementById('pauseRecipesBtn');
    if (pauseRecipesBtn && !pauseRecipesBtn.dataset.wired) {
      pauseRecipesBtn.addEventListener('click', () => this.showRecipes());
      pauseRecipesBtn.dataset.wired = '1';
    }
    const pauseChallengesBtn = document.getElementById('pauseChallengesBtn');
    if (pauseChallengesBtn && !pauseChallengesBtn.dataset.wired) {
      pauseChallengesBtn.addEventListener('click', () => this.showChallenges());
      pauseChallengesBtn.dataset.wired = '1';
    }
    const pauseRegularsBtn = document.getElementById('pauseRegularsBtn');
    if (pauseRegularsBtn && !pauseRegularsBtn.dataset.wired) {
      pauseRegularsBtn.addEventListener('click', () => this.showRegulars());
      pauseRegularsBtn.dataset.wired = '1';
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
        }
      });
      resetBtn.dataset.wired = '1';
    }
  }

  /** Render the full challenges page and reveal the modal. */
  showChallenges() {
    this._renderChallenges();
    if (this.challengesOverlayEl) this.challengesOverlayEl.classList.remove('hidden');
    const btn = document.getElementById('challengesBtn');
    if (btn) btn.classList.remove('flash');
  }

  hideChallenges() {
    if (this.challengesOverlayEl) this.challengesOverlayEl.classList.add('hidden');
  }

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
        : set.status === 'current' ? '<span class="set-badge current">Current Set</span>'
        : '<span class="set-badge locked">Locked</span>';
      html.push(`<div class="${headerCls}">
        <div class="challenge-set-header">
          <span class="set-name">Set ${set.index + 1}: ${set.name}</span>
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
    if (r.type === 'unlock_section') {
      const g = GROUP_BY_ID[r.value];
      return g ? `📖 ${g.name}` : `📖 ${r.value}`;
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

  /** Render the book and reveal the modal. Drops the CTA flash if it was on. */
  showRecipes() {
    this._renderRecipes();
    if (this.recipesOverlayEl) this.recipesOverlayEl.classList.remove('hidden');
    const recipesBtn = document.getElementById('recipesBtn');
    if (recipesBtn) recipesBtn.classList.remove('flash');
  }

  hideRecipes() {
    if (this.recipesOverlayEl) this.recipesOverlayEl.classList.add('hidden');
  }

  /** Render the regulars collection and reveal the modal. */
  showRegulars() {
    this._renderRegulars();
    if (this.regularsOverlayEl) this.regularsOverlayEl.classList.remove('hidden');
  }

  hideRegulars() {
    if (this.regularsOverlayEl) this.regularsOverlayEl.classList.add('hidden');
  }

  /**
   * Collection grid: a card per regular. Unlocked cards show the full face
   * (cropped from the sprite sheet), name, favorite flavor, blurb, and served
   * count. Locked cards show the same face as a darkened silhouette with "???"
   * — a tease of who's still to come, and a preview of the eventual unlock flip.
   */
  _renderRegulars() {
    if (!this.regulars || !this.regularsOverlayEl) return;
    const listEl = this.regularsOverlayEl.querySelector('.regulars-grid');
    const countEl = this.regularsOverlayEl.querySelector('.regulars-count');
    if (!listEl) return;

    const all = this.regulars.getAll();
    if (countEl) countEl.textContent = `${this.regulars.unlockedCount()} / ${this.regulars.total} unlocked`;

    const T = REGULAR_FACE_TILE;
    const html = all.map(r => {
      const row = REGULAR_ROW_BY_NAME.get(r.name) || 0;
      // Unlocked → Default face (col 1); locked → the Empty white-shadow sprite
      // (col 0), which CSS colorizes grey.
      const col = r.unlocked ? REGULAR_FACE_COL : REGULAR_EMPTY_COL;
      const pos = `background-position:-${col * T}px -${row * T}px`;
      const cls = r.unlocked ? 'regular-card' : 'regular-card locked';
      const name = r.unlocked ? r.name : '???';
      const fav = r.unlocked
        ? `<div class="regular-fav"><span class="recipe-swatch" style="background:${COLORS[r.favoriteFlavor]}"></span>${FLAVOR_LABEL[r.favoriteFlavor] || r.favoriteFlavor}</div>`
        : '';
      const blurb = r.unlocked
        ? `<div class="regular-blurb">${r.blurb}</div>`
        : `<div class="regular-blurb locked-hint">Serve them to unlock</div>`;
      return `<div class="${cls}">
        <div class="regular-face" style="${pos}"></div>
        <div class="regular-name">${name}</div>
        ${fav}
        ${blurb}
        <div class="regular-served">Served ${r.served}×</div>
      </div>`;
    }).join('');
    listEl.innerHTML = html;
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
      for (const r of rows) html.push(this._renderRecipeRow(r));
    }
    listEl.innerHTML = html.join('');
  }

  /** A single scoop icon cropped from the HUD scoop sheet. @param {number} col @param {boolean} [empty] */
  _recipeScoop(col, empty = false) {
    const T = RECIPE_SCOOP_TILE;
    const cls = empty ? 'recipe-scoop empty' : 'recipe-scoop';
    return `<span class="${cls}" style="background-position:-${col * T}px 0"></span>`;
  }

  /** @param {ReturnType<Recipes['getAll']>[number]} r */
  _renderRecipeRow(r) {
    if (r.locked) {
      // Unknown recipe: one grey "empty" scoop per slot (the sheet's white scoop,
      // colorized — same treatment as a locked regular's silhouette).
      const blanks = Array.from({ length: r.size }, () => this._recipeScoop(HUD_SCOOP_COL.empty, true)).join('');
      return `<div class="recipe-row locked">
        <div class="recipe-colors">${blanks}</div>
        <div class="recipe-name">???</div>
        <div class="recipe-progress"><div class="recipe-progress-bar" style="width:0%"></div><span class="recipe-progress-text">?/${RECIPE_TARGET}</span></div>
      </div>`;
    }
    const swatches = r.colors.map(c => this._recipeScoop(HUD_SCOOP_COL[c])).join('');
    const pct = Math.min(100, (r.count / RECIPE_TARGET) * 100);
    const star = r.mastered ? ' ⭐' : '';
    const cls = r.mastered ? 'recipe-row mastered' : 'recipe-row';
    return `<div class="${cls}">
      <div class="recipe-colors">${swatches}</div>
      <div class="recipe-name">${r.name}${star}</div>
      <div class="recipe-progress">
        <div class="recipe-progress-bar" style="width:${pct}%"></div>
        <span class="recipe-progress-text">${r.count}/${RECIPE_TARGET}</span>
      </div>
    </div>`;
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
   * Tutorial-only: show/hide the "fill the meter to finish the day" callout by
   * the wave gauge, and pulse the gauge to draw the eye (body.day-hint).
   * @param {boolean} show
   */
  setDayHint(show) {
    const el = document.getElementById('dayHint');
    if (el) el.classList.toggle('hidden', !show);
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

  // === Challenge toast (mid-play "✓ <title>" notification) ==================

  /** @param {{ title: string }} challenge */
  showChallengeToast(challenge) {
    if (!this.challengeToastEl) return;
    this._toastQueue.push({ title: challenge.title });
    if (!this._toastShowing) this._processToastQueue();
  }

  _processToastQueue() {
    if (!this.challengeToastEl) return;
    if (this._toastQueue.length === 0) {
      this._toastShowing = false;
      return;
    }
    this._toastShowing = true;
    const next = /** @type {{ title: string }} */ (this._toastQueue.shift());
    this.challengeToastEl.innerHTML =
      `<span class="toast-check">✓</span><span class="toast-title">${next.title}</span>`;
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
   * Pauses gameplay, runs the cross-off animation on any earned-but-not-
   * committed challenges, optionally fades in a freshly-unlocked set, then
   * starts a 3-second countdown to Resume. Any button click cancels the
   * countdown and converts the centre button to "Play".
   *
   * @param {{ completedWave: number, onResume: () => void }} opts
   */
  showWaveTransition({ completedWave, onResume }) {
    if (!this.waveTransitionOverlayEl || !this.challenges) {
      // No overlay markup — resume immediately so the player isn't stuck.
      onResume();
      return;
    }
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

    if (titleEl) titleEl.textContent = `Day ${completedWave} Complete`;
    if (subtitleEl) {
      subtitleEl.textContent = cur ? `Set ${cur.index + 1}: ${cur.name}` : 'All challenges complete!';
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
   * After cross-offs: if the current set just advanced, fade in the new
   * set's challenges. Either way, start the countdown to resume.
   * @param {HTMLElement | null} rewardsEl
   * @param {HTMLElement | null} challengesEl
   */
  _afterCrossOffs(rewardsEl, challengesEl) {
    if (!this.challenges) return;
    // Peek: would commitEarned advance the set? Easier to just call it,
    // since the visual decision matches the state decision.
    const result = this.challenges.commitEarned();
    if (result.setAdvanced) {
      // Unlocked-rewards box — shown only when the set actually granted rewards.
      // The late "bragging rights" sets advance with none, so skip the box (and
      // its "🎁 Unlocked" header) but still run the new-challenge reveal below.
      if (rewardsEl && result.rewards.length > 0) {
        const rewards = result.rewards.map(r => `<span class="wt-reward">${this._rewardLabel(r)}</span>`).join('');
        rewardsEl.innerHTML = `<div class="wt-rewards-title">🎁 Unlocked</div><div class="wt-reward-list">${rewards}</div>`;
        rewardsEl.classList.remove('hidden');
      }
      // Fade in the fresh set's 3 unchecked challenges after a brief beat.
      setTimeout(() => {
        if (challengesEl && result.nextSet) {
          const html = result.nextSet.challenges.map(ch => this._renderChallengeRow(ch)).join('');
          challengesEl.classList.add('fading-out');
          setTimeout(() => {
            challengesEl.innerHTML = `<div class="wt-new-label">New Challenges</div>${html}`;
            challengesEl.classList.remove('fading-out');
            challengesEl.classList.add('fading-in');
            this._startWtCountdown();
          }, 300);
        } else {
          this._startWtCountdown();
        }
      }, 700);
    } else {
      this._startWtCountdown();
    }
    // NOTE: commitEarned has already run, so the saved state matches what
    // the player is seeing. Game.js's _endWaveTransition calls commitEarned
    // again — that's a no-op now (no remaining earned challenges).
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
    const recipesBtn = this.waveTransitionOverlayEl.querySelector('.wt-recipes-btn');
    const challengesBtn = this.waveTransitionOverlayEl.querySelector('.wt-challenges-btn');

    // Idempotent listener attach via dataset flag.
    if (playBtn && !(/** @type {HTMLElement} */ (playBtn).dataset.wired)) {
      playBtn.addEventListener('click', () => {
        this._wtClearCountdown();
        this._wtResume();
      });
      /** @type {HTMLElement} */ (playBtn).dataset.wired = '1';
    }
    if (recipesBtn && !(/** @type {HTMLElement} */ (recipesBtn).dataset.wired)) {
      recipesBtn.addEventListener('click', () => {
        this._wtInterrupted = true;
        this._wtClearCountdown();
        this._showWtPlayButton();
        this.showRecipes();
      });
      /** @type {HTMLElement} */ (recipesBtn).dataset.wired = '1';
    }
    if (challengesBtn && !(/** @type {HTMLElement} */ (challengesBtn).dataset.wired)) {
      challengesBtn.addEventListener('click', () => {
        this._wtInterrupted = true;
        this._wtClearCountdown();
        this._showWtPlayButton();
        this.showChallenges();
      });
      /** @type {HTMLElement} */ (challengesBtn).dataset.wired = '1';
    }
  }

  hideWaveTransition() {
    this._wtClearCountdown();
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
    // Flash the Recipes button as a CTA when there's something to celebrate.
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
            <span class="set-tag">Set ${cur.index + 1}</span>
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
        <button id="recipesBtn" class="secondary${flashCls}">📖 Recipes</button>
        <button id="startBtn">▶ Play Again</button>
        <button id="challengesBtn" class="secondary">🎯 Challenges</button>
        <button id="regularsBtn" class="secondary">😀 Regulars</button>
        <button id="settingsBtn" class="secondary">⚙️ Settings</button>
      </div>
    `;
    this._wireMenuButtons();
  }
}
