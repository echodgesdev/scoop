// @ts-check
const HAPTICS_KEY = 'scoop.haptics';

/**
 * Thin wrapper over the Vibration API (navigator.vibrate) for tactile feedback
 * on mobile. A NO-OP where unsupported (notably iOS Safari and most desktops),
 * so callers fire freely without guards. User-toggleable from Settings; the
 * preference persists. Patterns mirror the audio cues — a light tick for
 * confirmations, a stutter for errors, a longer roll for wave-ups. A single ms
 * value is one buzz; an array is buzz/pause/buzz… in ms.
 */
export class Haptics {
  constructor() {
    this.canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    // iOS Safari has NO Vibration API. The only web-accessible haptic there is
    // toggling a native <input type="checkbox" switch> (Safari 17.4+), which
    // plays the system "switch" tick. Best-effort iOS/iPadOS detection.
    this.isIOS = this._detectIOS();
    /** @type {HTMLInputElement | null} lazily-created hidden switch for the iOS tick */
    this._switch = null;
    this.supported = this.canVibrate || this.isIOS;
    this.enabled = this._load();
  }

  _detectIOS() {
    if (this.canVibrate || typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iP(hone|ad|od)/.test(ua)) return true;
    // iPadOS 13+ reports as desktop Safari ("MacIntel") but has a touch screen.
    return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  }

  /**
   * iOS-only fallback: a hidden native switch we flip to fire the system tick.
   * Kept rendered but invisible (display:none would suppress the haptic).
   */
  _iosTick() {
    if (!this._switch && typeof document !== 'undefined') {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');  // native iOS switch (Safari 17.4+)
      label.appendChild(input);
      (document.body || document.documentElement).appendChild(label);
      this._switch = input;
    }
    // Clicking toggles the switch's state, which is what fires the tick. A single
    // fixed tap — pattern/intensity from the caller is ignored on iOS.
    if (this._switch) { try { this._switch.click(); } catch {} }
  }

  /** Default ON (where supported); honor a stored 0/1 preference. */
  _load() {
    try {
      const v = localStorage.getItem(HAPTICS_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  }

  /** @param {boolean} v */
  setEnabled(v) {
    this.enabled = !!v;
    try { localStorage.setItem(HAPTICS_KEY, this.enabled ? '1' : '0'); } catch {}
    if (!this.enabled && this.canVibrate) { try { navigator.vibrate(0); } catch {} }  // cancel any buzz
  }

  /**
   * @param {number | number[]} pattern Android/vibrate honors the full pattern;
   *   iOS collapses everything to one fixed tick (its only web-accessible haptic).
   */
  _buzz(pattern) {
    if (!this.enabled) return;
    if (this.canVibrate) { try { navigator.vibrate(pattern); } catch {} return; }
    if (this.isIOS) this._iosTick();
  }

  catch_()  { this._buzz(8); }                  // perfect catch — tiny tick
  powerup() { this._buzz(14); }                 // a power-up fired (catch / tip / breaker)
  serve()   { this._buzz(18); }                 // order completed
  error()   { this._buzz([10, 40, 10]); }       // wrong tap / tray full — double stutter
  expire()  { this._buzz(45); }                 // customer left / took damage
  phaseUp() { this._buzz(12); }                 // phase cleared
  wave()    { this._buzz([20, 50, 20, 50, 80]); } // wave cleared — celebratory roll
  gameOver(){ this._buzz(30); }                 // round over — medium pulse
}
