// @ts-check
// Live in-game readouts: score, combo (with its decay bar), the wave gauge ring,
// the health bar, and the tutorial day-hint — plus the one-shot "flash" effects
// (phase-up pulse, wave-up celebration, health-damage shake). Pure DOM writes,
// each change-guarded so the per-frame pull from game.js only touches the DOM
// when a value visibly changed (the gauge's SVG filter and the health/combo
// transitions aren't invalidated 60× a second). No game state lives here — game.js
// pushes values in via the setters.

export class LiveHud {
  /** @param {{ scoreEl: HTMLElement, comboEl: HTMLElement, gaugeEl: HTMLElement, healthFillEl: HTMLElement, flashEl: HTMLElement }} els */
  constructor({ scoreEl, comboEl, gaugeEl, healthFillEl, flashEl }) {
    this.scoreEl = scoreEl;
    this.gaugeEl = gaugeEl;
    this.healthFillEl = healthFillEl;
    this.flashEl = flashEl;

    // Last-written values for the per-frame pull. The setters early-out when
    // nothing visibly changed, so the DOM is only touched on actual changes.
    // (These caches always mirror the DOM because the setters are the only writers.)
    this._lastScore = NaN;
    this._lastHealthQ = NaN;
    this._lastGaugeOff = NaN;
    this._lastComboKey = '';

    if (this.gaugeEl) {
      this.gaugeFillEl = /** @type {SVGElement | null} */ (this.gaugeEl.querySelector('.ring-fill'));
      this.gaugeNumEl  = /** @type {HTMLElement | null} */ (this.gaugeEl.querySelector('.wave-num'));
    }

    // Combo readout = a label + a decay bar that drains as the chain ages.
    this.comboEl = comboEl;
    this.comboEl.innerHTML =
      '<span class="combo-text"></span>' +
      '<div class="combo-decay"><div class="combo-decay-fill"></div></div>';
    this.comboTextEl = /** @type {HTMLElement} */ (this.comboEl.querySelector('.combo-text'));
    this.comboDecayFillEl = /** @type {HTMLElement} */ (this.comboEl.querySelector('.combo-decay-fill'));
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
}
