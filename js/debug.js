// @ts-check
const LABELS = {
  patternTimer: 'Customer patience',
  speedRamp:    'Speed ramp',
  invincible:   'Invincible',
  pickupKeys:   'Cheat keys: Q/W/E/R',
  showHitboxes: 'Show hitboxes',
  showFps:      'Show FPS'
};

/**
 * Bottom-left debug toggle. Opening it pauses the game (via onPauseChange)
 * and exposes a checkbox per flag plus a wave-jumper for fast-forwarding.
 * Flags are mutated in place so the game reads them live.
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
   *   getTutorialFlag?: () => boolean
   * }} [opts]
   */
  constructor(flags, { onPauseChange, onWaveJump, onTimeJump, getWaveFraction, onAspectChange, getAspect, onDemandBias, getDemandBias, onPatience, getPatience, onBubbleRange, getBubbleRange, onBubbleWeights, getBubbleWeights, onTutorialFlag, getTutorialFlag } = {}) {
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
    this.open = false;

    this.button = /** @type {HTMLElement} */ (document.getElementById('debugBtn'));
    this.panel = /** @type {HTMLElement} */ (document.getElementById('debugPanel'));
    this._buildOptions();
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

  _buildOptions() {
    const container = /** @type {HTMLElement} */ (this.panel.querySelector('.debug-options'));
    container.innerHTML = '';
    for (const key of Object.keys(this.flags)) {
      const row = document.createElement('label');
      row.className = 'debug-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.flags[key];
      cb.addEventListener('change', () => { this.flags[key] = cb.checked; });

      const span = document.createElement('span');
      span.textContent = LABELS[/** @type {keyof typeof LABELS} */ (key)] || key;

      row.append(cb, span);
      container.appendChild(row);
    }
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
