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
   *   onDemandBias?: (v: number) => void,
   *   getDemandBias?: () => number,
   *   onPatience?: (sec: number | null) => void,
   *   getPatience?: () => number,
   *   onTipGap?: (min: number, max: number) => void,
   *   getTipGap?: () => { min: number, max: number },
   *   onPowerupWeights?: (weights: number[]) => void,
   *   getPowerupWeights?: () => number[],
   *   onTutorialFlag?: (v: boolean) => void,
   *   getTutorialFlag?: () => boolean,
   *   onMaxStack?: (n: number) => void,
   *   getMaxStack?: () => number,
   *   onMaxLive?: (n: number) => void,
   *   getMaxLive?: () => number,
   *   onSpawnInterval?: (sec: number) => void,
   *   getSpawnInterval?: () => number,
   *   onComboBreakerToggle?: (on: boolean) => void,
   *   getComboBreakerEnabled?: () => boolean,
   *   onFallSpeed?: (m: number) => void,
   *   getFallSpeed?: () => number
   * }} [opts]
   */
  constructor(flags, { onPauseChange, onWaveJump, onTimeJump, getWaveFraction, onDemandBias, getDemandBias, onPatience, getPatience, onTipGap, getTipGap, onPowerupWeights, getPowerupWeights, onTutorialFlag, getTutorialFlag, onMaxStack, getMaxStack, onMaxLive, getMaxLive, onSpawnInterval, getSpawnInterval, onComboBreakerToggle, getComboBreakerEnabled, onFallSpeed, getFallSpeed } = {}) {
    this.flags = flags;
    this.onPauseChange = onPauseChange || (() => {});
    this.onWaveJump = onWaveJump || (() => {});
    this.onTimeJump = onTimeJump || (() => {});
    this.getWaveFraction = getWaveFraction || (() => 0);
    this.onDemandBias = onDemandBias || (() => {});
    this.getDemandBias = getDemandBias || (() => 0.65);
    this.onPatience = onPatience || (() => {});
    this.getPatience = getPatience || (() => 0);
    this.onTipGap = onTipGap || (() => {});
    this.getTipGap = getTipGap || (() => ({ min: 5.5, max: 10 }));
    this.onPowerupWeights = onPowerupWeights || (() => {});
    this.getPowerupWeights = getPowerupWeights || (() => [0.35, 0.3, 0.2, 0.15]);
    this.onTutorialFlag = onTutorialFlag || (() => {});
    this.getTutorialFlag = getTutorialFlag || (() => false);
    this.onMaxStack = onMaxStack || (() => {});
    this.getMaxStack = getMaxStack || (() => 6);
    this.onMaxLive = onMaxLive || (() => {});
    this.getMaxLive = getMaxLive || (() => 7);
    this.onSpawnInterval = onSpawnInterval || (() => {});
    this.getSpawnInterval = getSpawnInterval || (() => 0.85);
    this.onComboBreakerToggle = onComboBreakerToggle || (() => {});
    this.getComboBreakerEnabled = getComboBreakerEnabled || (() => false);
    this.onFallSpeed = onFallSpeed || (() => {});
    this.getFallSpeed = getFallSpeed || (() => 1);
    /** @type {{ id: string, label: string, get: () => number, fmt: (n: number) => string }[]} */
    this._sliders = [];
    this.open = false;

    this.button = /** @type {HTMLElement} */ (document.getElementById('debugBtn'));
    this.panel = /** @type {HTMLElement} */ (document.getElementById('debugPanel'));
    this._wireFlags();
    this._wireGameplay();
    this._wireDemandBias();
    this._wirePatience();
    this._wirePowerups();
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

  /**
   * Gameplay tuning: the runtime sliders (max scoops on cone, max falling scoops,
   * spawn interval, fall speed) plus the combo-breaker toggle. Movement
   * sensitivity lives in the Settings modal.
   */
  _wireGameplay() {
    const int = n => String(Math.round(n));
    const oneDp = n => n.toFixed(1);
    const twoDp = n => n.toFixed(2);
    this._wireSlider('debugMaxStack', 'debugMaxStackLabel', this.onMaxStack, this.getMaxStack, int);
    this._wireSlider('debugMaxLive', 'debugMaxLiveLabel', this.onMaxLive, this.getMaxLive, int);
    this._wireSlider('debugSpawnInterval', 'debugSpawnIntervalLabel', this.onSpawnInterval, this.getSpawnInterval, twoDp);
    this._wireSlider('debugFallSpeed', 'debugFallSpeedLabel', this.onFallSpeed, this.getFallSpeed, oneDp);

    const breakerCb = /** @type {HTMLInputElement | null} */ (document.getElementById('debugComboBreakerToggle'));
    if (breakerCb) {
      breakerCb.checked = this.getComboBreakerEnabled();
      breakerCb.addEventListener('change', () => this.onComboBreakerToggle(breakerCb.checked));
    }
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
   * Power-up economy: tip frequency + the per-type mix. Frequency is a min/max
   * seconds gap (wider = rarer tips); weights are four relative numbers aligned
   * to heart / ⚡ speed / ❄️ freeze / 🌈 rainbow (any positive scale; 0 = never).
   */
  _wirePowerups() {
    const minEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTipMin'));
    const maxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTipMax'));
    if (minEl && maxEl) {
      const apply = () => {
        const min = parseFloat(minEl.value);
        const max = parseFloat(maxEl.value);
        if (Number.isFinite(min) && Number.isFinite(max)) this.onTipGap(min, max);
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
    const applyWeights = () => this.onPowerupWeights(weightEls.map(el => (el ? parseFloat(el.value) : NaN)));
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
    const minEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTipMin'));
    const maxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('debugTipMax'));
    const range = this.getTipGap();
    if (minEl && minEl.value.trim() === '') minEl.value = String(range.min);
    if (maxEl && maxEl.value.trim() === '') maxEl.value = String(range.max);
    const weights = this.getPowerupWeights();
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
    const breakerCb = /** @type {HTMLInputElement | null} */ (document.getElementById('debugComboBreakerToggle'));
    if (breakerCb) breakerCb.checked = this.getComboBreakerEnabled();
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
