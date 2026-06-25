// @ts-check
const VOLUME_KEY = 'scoop.volume';

// Catch pitch climbs a major-pentatonic scale as the stack grows: each added
// scoop plays the next degree, so building a tall stack rings out a rising riff.
// Rooted at E5 (≈ the previous flat 660Hz catch), so a no-arg catch_() — used by
// serves, discards, and the tipping mode — keeps its original pitch.
const CATCH_ROOT_HZ = 659.25;             // E5
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9]; // semitone offsets from the root; wraps an octave per lap

/**
 * Tiny WebAudio sound bank — synthesised tones, no asset files.
 * Must be unlocked from a user gesture (call resume() on Start).
 */
export class Sound {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    this.muted = false;
    this.volume = this._loadVolume();
  }

  _loadVolume() {
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY) || '');
      if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
    } catch {}
    return 1;
  }

  /**
   * Master volume multiplier 0..1. Persisted across sessions.
   * @param {number} v
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch {}
  }

  resume() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * @param {number} freq
   * @param {number} start
   * @param {number} dur
   * @param {OscillatorType} [type]
   * @param {number} [vol]
   */
  _tone(freq, start, dur, type = 'sine', vol = 0.2) {
    if (!this.ctx || this.muted) return;
    // Apply master volume; bail entirely if the user has dragged it to 0.
    const effectiveVol = vol * this.volume;
    if (effectiveVol <= 0.0001) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(effectiveVol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * Scoop landed on the stack. `step` is the scale degree (0 = root): catches step
   * up the major-pentatonic, pops step down. Negative steps are valid — they dip
   * below the root (popping the last scoop), via a floored modulo so the wrap is
   * musical instead of NaN.
   * @param {number} [step]
   */
  catch_(step = 0) {
    const n = MAJOR_PENTATONIC.length;
    const idx = ((step % n) + n) % n;          // floored mod — correct for negative steps too
    const semis = MAJOR_PENTATONIC[idx] + 12 * Math.floor(step / n);
    this._tone(CATCH_ROOT_HZ * Math.pow(2, semis / 12), 0, 0.09, 'triangle', 0.18);
  }

  /**
   * A scoop handed to a customer — a soft, friendly "here you go" up-tick. Kept
   * distinct from the catch/pop pentatonic tone so delivery never sounds like the
   * stack; order COMPLETION still gets the bigger match() fanfare.
   */
  deliver() {
    this._tone(587.33, 0,     0.05, 'sine', 0.15);  // D5
    this._tone(880,    0.045, 0.09, 'sine', 0.16);  // A5 — quick warm rise
  }

  /** A snappy descending "pop" — used for tip coins + the wave-end cashout. */
  bubblePop() {
    this._tone(1400, 0,    0.035, 'triangle', 0.20);
    this._tone(900,  0.03, 0.06,  'triangle', 0.15);
  }

  /** A power-up firing — a confident rising "power-on" sweep. */
  powerupTrigger() {
    this._tone(392, 0,    0.08, 'sawtooth', 0.16);
    this._tone(587, 0.05, 0.10, 'sawtooth', 0.16);
    this._tone(880, 0.10, 0.18, 'triangle', 0.18);
  }

  perfect() {
    this._tone(988, 0, 0.08, 'triangle', 0.16);
    this._tone(1318.5, 0.05, 0.12, 'triangle', 0.16);
  }

  phaseUp() {
    this._tone(659.25, 0, 0.10, 'triangle', 0.20);
    this._tone(987.77, 0.05, 0.14, 'triangle', 0.20);
  }

  levelUp() {
    // Triumphant rising chord for clearing a wave.
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this._tone(f, i * 0.07, 0.32, 'triangle', 0.22)
    );
    this._tone(1568, 0.40, 0.45, 'sine', 0.18);
  }

  // ----- Power-up sounds -----
  heart() {
    this._tone(880,  0,    0.14, 'sine', 0.22);
    this._tone(1175, 0.08, 0.20, 'sine', 0.20);
  }

  feather() {
    [988, 1318, 1568].forEach((f, i) =>
      this._tone(f, i * 0.05, 0.14, 'triangle', 0.18)
    );
  }

  pausePickup() {
    this._tone(440, 0,    0.22, 'sine',     0.18);
    this._tone(330, 0.10, 0.32, 'sine',     0.16);
  }

  rainbowPickup() {
    [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5].forEach((f, i) =>
      this._tone(f, i * 0.04, 0.18, 'triangle', 0.18)
    );
  }

  match() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone(f, i * 0.06, 0.22, 'triangle', 0.2)
    );
  }

  bad() {
    this._tone(140, 0, 0.22, 'sawtooth', 0.22);
    this._tone(90, 0.04, 0.22, 'sawtooth', 0.18);
  }

  expire() {
    this._tone(420, 0, 0.14, 'square', 0.16);
    this._tone(250, 0.12, 0.2, 'square', 0.16);
  }

  gameOver() {
    [440, 349.23, 293.66, 220].forEach((f, i) =>
      this._tone(f, i * 0.18, 0.3, 'sine', 0.22)
    );
  }

  /**
   * "Strike" sound for the challenge cross-off animation between waves.
   * A short descending pair of saw-tooth tones — reads as a quick pen
   * stroke / line being drawn through the text.
   */
  crossOff() {
    this._tone(900, 0,    0.05, 'sawtooth', 0.16);
    this._tone(520, 0.03, 0.08, 'sawtooth', 0.13);
  }
}
