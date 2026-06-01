// @ts-check
/**
 * Debug modal. Opening it pauses the game (via onPauseChange) and exposes the
 * tuning/cheat controls grouped into accordion sections. Boolean cheat/display
 * flags are declared in the HTML via `data-flag="<key>"` and mutated in place
 * here so the game reads them live.
 */
export class DebugPanel {
  /**
   * @param {Record<string, boolean>} flags
   * @param {{
   *   onPauseChange?: (open: boolean) => void,
   *   onWaveJump?: (n: number) => void,
   *   onTimeJump?: (fraction: number) => void,
   *   getWaveFraction?: () => number,
   *   onAspectChange?: (name: string) => void,
   *   getAspect?: () => string,
   *   onDemandBias?: (v: number) => void,
   *   getDemandBias?: () => number,
   *   onPatience?: (sec: number | null) => void,
   *   getPatience?: () => number,
   *   onBubbleRange?: (min: number, max: number) => void,
   *   getBubbleRange?: () => { min: number, max: number },
   *   onBubbleWeights?: (weights: number[]) => void,
   *   getBubbleWeights?: () => number[],
   *   onTutorialFlag?: (v: boolean) => void,
   *   getTutorialFlag?: () => boolean,
   *   onGameMode?: (name: string) => void,
   *   getGameMode?: () => string,
   *   onStoreToggle?: (on: boolean) => void,
   *   getStoreEnabled?: () => boolean,
   *   onTouchScheme?: (name: string) => void,
   *   getTouchScheme?: () => string,
   *   onDeliveryMode?: (name: string) => void,
   *   getDeliveryMode?: () => string,
   *   onMaxStack?: (n: number) => void,
   *   getMaxStack?: () => number,
   *   onMaxLive?: (n: number) => void,
   *   getMaxLive?: () => number,
   *   onSpawnInterval?: (sec: number) => void,
   *   getSpawnInterval?: () => number,
   *   onDragGain?: (g: number) => void,
   *   getDragGain?: () => number,
   *   onComboBreaker?: (n: number) => void,
   *   getComboBreaker?: () => number
   * }} [opts]
   */
  constructor(flags, { onPauseChange, onWaveJump, onTimeJump, getWaveFraction, onAspectChange, getAspect, onDemandBias, getDemandBias, onPatience, getPatience, onBubbleRange, getBubbleRange, onBubbleWeights, getBubbleWeights, onTutorialFlag, getTutorialFlag, onGameMode, getGameMode, onStoreToggle, getStoreEnabled, onTouchScheme, getTouchScheme, onDeliveryMode, getDeliveryMode, onMaxStack, getMaxStack, onMaxLive, getMaxLive, onSpawnInterval, getSpawnInterval, onDragGain, getDragGain, onComboBreaker, getComboBreaker } = {}) {
    this.flags = flags;
    this.onPauseChange = onPauseChange || (() => {});
    this.onWaveJump = onWaveJump || (() => {});
    this.onTimeJump = onTimeJump || (() => {});
    this.getWaveFraction = getWaveFraction || (() => 0);
    this.onAspectChange = onAspectChange || (() => {});
    this.getAspect = getAspect || (() => '4:3');
    this.onDemandBias = onDemandBias || (() => {});
    this.getDemandBias = getDemandBias || (() => 0.65);
    this.onPatience = onPatience || (() => {});
    this.getPatience = getPatience || (() => 0);
    this.onBubbleRange = onBubbleRange || (() => {});
    this.getBubbleRange = getBubbleRange || (() => ({ min: 5.5, max: 10 }));
    this.onBubbleWeights = onBubbleWeights || (() => {});
    this.getBubbleWeights = getBubbleWeights || (() => [0.35, 0.3, 0.2, 0.15]);
    this.onTutorialFlag = onTutorialFlag || (() => {});
    this.getTutorialFlag = getTutorialFlag || (() => false);
    this.onGameMode = onGameMode || (() => {});
    this.getGameMode = getGameMode || (() => 'auto');
    this.onStoreToggle = onStoreToggle || (() => {});
    this.getStoreEnabled = getStoreEnabled || (() => false);
    this.onTouchScheme = onTouchScheme || (() => {});
    this.getTouchScheme = getTouchScheme || (() => 'relative');
    this.onDeliveryMode = onDeliveryMode || (() => {});
    this.getDeliveryMode = getDeliveryMode || (() => 'any');
    this.onMaxStack = onMaxStack || (() => {});
    this.getMaxStack = getMaxStack || (() => 6);
    this.onMaxLive = onMaxLive || (() => {});
    this.getMaxLive = getMaxLive || (() => 7);
    this.onSpawnInterval = onSpawnInterval || (() => {});
    this.getSpawnInterval = getSpawnInterval || (() => 0.85);
    this.onDragGain = onDragGain || (() => {});
    this.getDragGain = getDragGain || (() => 2);
    this.onComboBreaker = onComboBreaker || (() => {});
    this.getComboBreaker = getComboBreaker || (() => 8);
    /** @type {{ id: string, label: string, get: () => number, fmt: (n: number) => string }[]} */
    this._sliders = [];
    this.open = false;

    this.button = /** @type {HTMLElement} */ (document.getElementById('debugBtn'));
    this.panel = /** @type {HTMLElement} */ (document.getElementById('debugPanel'));
    this._wireFlags();
    this._wireGameMode();
    this._wireStoreToggle();
    this._wireTouchScheme();
    this._wireGameplay();
    this._wireAspect();
    this._wireDemandBias();
    this._wirePatience();
    this._wireBubbles();
    this._wireTutorial();
    this._wireWaveJump();
    this._wireTimeSlider();

    this.button.addEventListener('click', () => this.toggle());
    const resumeBtn = document.getElementById('debugResume');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.toggle(false));
  }

  /**
   * Wire every boolean flag checkbox declared in the HTML as `data-flag="key"`.
   * The checkbox writes straight back into the live flags object the game reads.
   */
  _wireFlags() {
    /** @type {NodeListOf<HTMLInputElement>} */
    const els = this.panel.querySelectorAll('input[data-flag]');
    this._flagEls = els;
    els.forEach(el => {
      const key = el.dataset.flag;
      if (!key) return;
      el.checked = !!this.flags[key];
      el.addEventListener('change', () => { this.flags[key] = el.checked; });
    });
  }

  /** Game-mode dropdown: Auto Trigger ⇄ Banked Inventory power-up handling. */
  _wireGameMode() {
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugGameMode'));
    if (!sel) return;
    sel.value = this.getGameMode();
    sel.addEventListener('change', () => this.onGameMode(sel.value));
  }

  /** Between-wave store (loot box) visibility — off by default. */
  _wireStoreToggle() {
    const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('debugStoreToggle'));
    if (!cb) return;
    cb.checked = this.getStoreEnabled();
    cb.addEventListener('change', () => this.onStoreToggle(cb.checked));
  }

  /** Touch movement scheme: relative drag / absolute drag / hold zones. */
  _wireTouchScheme() {
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugTouchScheme'));
    if (!sel) return;
    sel.value = this.getTouchScheme();
    sel.addEventListener('change', () => this.onTouchScheme(sel.value));
  }

  /**
   * Gameplay tuning (all modes): delivery method dropdown + the runtime sliders
   * (max scoops on cone, max falling scoops, spawn interval, relative-drag gain).
   */
  _wireGameplay() {
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugDelivery'));
    if (sel) {
      sel.value = this.getDeliveryMode();
      sel.addEventListener('change', () => this.onDeliveryMode(sel.value));
    }
    const int = n => String(Math.round(n));
    const oneDp = n => n.toFixed(1);
    const twoDp = n => n.toFixed(2);
    this._wireSlider('debugMaxStack', 'debugMaxStackLabel', this.onMaxStack, this.getMaxStack, int);
    this._wireSlider('debugMaxLive', 'debugMaxLiveLabel', this.onMaxLive, this.getMaxLive, int);
    this._wireSlider('debugSpawnInterval', 'debugSpawnIntervalLabel', this.onSpawnInterval, this.getSpawnInterval, twoDp);
    this._wireSlider('debugDragGain', 'debugDragGainLabel', this.onDragGain, this.getDragGain, oneDp);
    this._wireSlider('debugComboBreaker', 'debugComboBreakerLabel', this.onComboBreaker, this.getComboBreaker, int);
  }

  /**
   * Wire one debug range slider to a setter, with a live value label, and
   * register it so it re-syncs to the live value when the panel opens.
   * @param {string} id @param {string} labelId
   * @param {(n: number) => void} onInput @param {() => number} get
   * @param {(n: number) => string} fmt
   */
  _wireSlider(id, labelId, onInput, get, fmt) {
    const slider = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    const label = /** @type {HTMLElement | null} */ (document.getElementById(labelId));
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (Number.isFinite(v)) { onInput(v); if (label) label.textContent = fmt(v); }
    });
    this._sliders.push({ id, label: labelId, get, fmt });
  }

  /** Aspect-ratio selector: switches the locked virtual canvas (4:3 ⇄ 3:4). */
  _wireAspect() {
    const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugAspect'));
    if (!select) return;
    select.value = this.getAspect();
    select.addEventListener('change', () => this.onAspectChange(select.value));
  }

  /** Live demand-bias slider (0..1): lower = more random scoops = tray binds. */
  _wireDemandBias() {
    const slider = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBiasSlider'));
    const label = /** @type {HTMLElement | null} */ (document.getElementById('debugBiasLabel'));
    if (!slider) return;
    const sync = () => { if (label) label.textContent = `${Math.round(parseFloat(slider.value) * 100)}%`; };
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (Number.isFinite(v)) this.onDemandBias(v);
      sync();
    });
    sync();
  }

  /**
   * Customer-patience override (seconds). Empty or 0 hands control back to the
   * wave ramp; a positive number pins patience for newly-spawned orders.
   */
  _wirePatience() {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('debugPatienceInput'));
    if (!input) return;
    const apply = () => {
      const raw = input.value.trim();
      if (raw === '') { this.onPatience(null); return; }
      const v = parseFloat(raw);
      this.onPatience(Number.isFinite(v) && v > 0 ? v : null);
    };
    input.addEventListener('input', apply);
  }

  /**
   * Bubble (pickup) spawn frequency + per-type proportion. Frequency is a
   * min/max seconds range; weights are four relative numbers aligned to
   * heart / ⚡ speed / ❄️ freeze / 🌈 rainbow (any positive scale; 0 = never).
   */
  _wireBubbles() {
    const minEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBubbleMin'));
    const maxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBubbleMax'));
    if (minEl && maxEl) {
      const apply = () => {
        const min = parseFloat(minEl.value);
        const max = parseFloat(maxEl.value);
        if (Number.isFinite(min) && Number.isFinite(max)) this.onBubbleRange(min, max);
      };
      minEl.addEventListener('input', apply);
      maxEl.addEventListener('input', apply);
    }

    /** @type {(HTMLInputElement | null)[]} */
    const weightEls = [
      /** @type {HTMLInputElement | null} */ (document.getElementById('debugWeightHeart')),
      /** @type {HTMLInputElement | null} */ (document.getElementById('debugWeightSpeed')),
      /** @type {HTMLInputElement | null} */ (document.getElementById('debugWeightPause')),
      /** @type {HTMLInputElement | null} */ (document.getElementById('debugWeightRainbow'))
    ];
    this._weightEls = weightEls;
    const applyWeights = () => this.onBubbleWeights(weightEls.map(el => (el ? parseFloat(el.value) : NaN)));
    for (const el of weightEls) {
      if (el) el.addEventListener('input', applyWeights);
    }
  }

  /** "Show tutorial" flag — when checked, the onboarding plays at the next new game. */
  _wireTutorial() {
    const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTutorial'));
    if (!cb) return;
    cb.checked = this.getTutorialFlag();
    cb.addEventListener('change', () => this.onTutorialFlag(cb.checked));
  }

  _wireWaveJump() {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('debugWaveInput'));
    const btn = document.getElementById('debugWaveJump');
    if (!input || !btn) return;
    btn.addEventListener('click', () => {
      const n = parseInt(input.value, 10);
      if (Number.isFinite(n) && n >= 1) this.onWaveJump(n);
    });
    // Pressing Enter inside the field also jumps — convenient when testing.
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });
  }

  /**
   * Time-of-day slider: drag to scrub through the wave (dawn → sunset).
   * Reads as a live preview because the canvas `_draw` runs even while the
   * game is paused, so the sun and gauge re-render on every input event.
   */
  _wireTimeSlider() {
    const slider = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTimeSlider'));
    const label = /** @type {HTMLElement | null} */ (document.getElementById('debugTimeLabel'));
    if (!slider) return;
    const updateLabel = () => {
      if (label) label.textContent = `${Math.round(parseFloat(slider.value) * 100)}%`;
    };
    slider.addEventListener('input', () => {
      const f = parseFloat(slider.value);
      if (Number.isFinite(f)) this.onTimeJump(f);
      updateLabel();
    });
    updateLabel();
  }

  /** Sync the bias slider + patience input to live values when the panel opens. */
  _syncDebugControls() {
    const biasSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBiasSlider'));
    const biasLabel = /** @type {HTMLElement | null} */ (document.getElementById('debugBiasLabel'));
    if (biasSlider) {
      const v = this.getDemandBias();
      biasSlider.value = String(v);
      if (biasLabel) biasLabel.textContent = `${Math.round(v * 100)}%`;
    }
    const patienceInput = /** @type {HTMLInputElement | null} */ (document.getElementById('debugPatienceInput'));
    if (patienceInput && patienceInput.value.trim() === '') {
      patienceInput.placeholder = `${this.getPatience()} (ramp)`;
    }
    const minEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBubbleMin'));
    const maxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugBubbleMax'));
    const range = this.getBubbleRange();
    if (minEl && minEl.value.trim() === '') minEl.value = String(range.min);
    if (maxEl && maxEl.value.trim() === '') maxEl.value = String(range.max);
    const weights = this.getBubbleWeights();
    const els = this._weightEls || [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el && el.value.trim() === '') el.value = String(weights[i]);
    }
    const tut = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTutorial'));
    if (tut) tut.checked = this.getTutorialFlag();

    // Re-sync the flag checkboxes + mode/store controls to live state.
    if (this._flagEls) {
      this._flagEls.forEach(el => {
        const key = el.dataset.flag;
        if (key) el.checked = !!this.flags[key];
      });
    }
    const modeSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugGameMode'));
    if (modeSel) modeSel.value = this.getGameMode();
    const storeCb = /** @type {HTMLInputElement | null} */ (document.getElementById('debugStoreToggle'));
    if (storeCb) storeCb.checked = this.getStoreEnabled();
    const touchSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugTouchScheme'));
    if (touchSel) touchSel.value = this.getTouchScheme();
    const delSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('debugDelivery'));
    if (delSel) delSel.value = this.getDeliveryMode();
    // Re-sync gameplay sliders to live values (they can change between games).
    for (const s of this._sliders) {
      const slider = /** @type {HTMLInputElement | null} */ (document.getElementById(s.id));
      const label = /** @type {HTMLElement | null} */ (document.getElementById(s.label));
      const v = s.get();
      if (slider) slider.value = String(v);
      if (label) label.textContent = s.fmt(v);
    }
  }

  /** Sync the slider to the live wave fraction. Called when the panel opens. */
  _syncTimeSlider() {
    const slider = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTimeSlider'));
    const label = /** @type {HTMLElement | null} */ (document.getElementById('debugTimeLabel'));
    if (!slider) return;
    const f = this.getWaveFraction();
    slider.value = String(Math.max(0, Math.min(0.999, f)));
    if (label) label.textContent = `${Math.round(f * 100)}%`;
  }

  /** @param {boolean} [force] */
  toggle(force) {
    this.open = force === undefined ? !this.open : force;
    this.panel.classList.toggle('hidden', !this.open);
    this.button.classList.toggle('active', this.open);
    if (this.open) {
      this._syncTimeSlider();
      this._syncDebugControls();
    }
    this.onPauseChange(this.open);
  }
}
