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
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.enabled = this._load();
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
    if (!this.enabled && this.supported) { try { navigator.vibrate(0); } catch {} }  // cancel any buzz
  }

  /** @param {number | number[]} pattern */
  _buzz(pattern) {
    if (!this.enabled || !this.supported) return;
    try { navigator.vibrate(pattern); } catch {}
  }

  catch_()  { this._buzz(8); }                  // perfect catch — tiny tick
  powerup() { this._buzz(14); }                 // a power-up fired (catch / tip / breaker)
  serve()   { this._buzz(18); }                 // order completed
  error()   { this._buzz([10, 40, 10]); }       // wrong tap / tray full — double stutter
  expire()  { this._buzz(45); }                 // customer left / took damage
  phaseUp() { this._buzz(12); }                 // phase cleared
  wave()    { this._buzz([20, 50, 20, 50, 80]); } // wave cleared — celebratory roll
}
