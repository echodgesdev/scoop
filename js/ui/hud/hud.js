// @ts-check
// HUD coordinator. The DOM UI is split into focused controllers, each owning its
// elements + its own rendering/wiring:
//   liveHud.js        — the always-on readouts (score / combo / gauge / health / day-hint + flashes)
//   journal.js        — the tabbed collection hub + the tap-a-coin detail popup
//   waveTransition.js — the between-day flow (cross-offs → unlock flips → countdown)
//   screens.js        — title / game-over / settings / pause overlays + their button wiring
//   toastUI.js        — mid-play toasts
// This file builds those controllers, injects the few cross-concern callbacks
// between them (e.g. "open the Journal", "go Home", re-render on reset), and
// forwards the public API that game.js / reactions.js call. No DOM or rendering
// logic lives here — it coordinates, it doesn't render.
import { Toasts } from './toastUI.js';
import { LiveHud } from './liveHud.js';
import { Journal } from './journal.js';
import { WaveTransition } from './waveTransition.js';
import { Screens } from './screens.js';

export class Hud {
  constructor({
    scoreEl, comboEl, healthFillEl, overlayEl, gaugeEl, flashEl,
    journalOverlayEl, settingsOverlayEl,
    waveTransitionOverlayEl, pauseOverlayEl, challengeToastEl,
    recipes, challenges, regulars, sound, onStart, onHowToPlay, getInGame,
    getVolume, onSetVolume, getSensitivity, onSetSensitivity,
    getHaptics, onSetHaptics, onResetProgress, onPauseToggle, onHome
  }) {
    // Mid-play toasts (challenge met / flavor discovered) — self-contained module.
    this.toasts = new Toasts(challengeToastEl);

    // Always-on readouts, pulled each frame by game.js via the setters below.
    this.live = new LiveHud({ scoreEl, comboEl, gaugeEl, healthFillEl, flashEl });

    // The tabbed Journal hub + its tap-a-coin detail popup.
    this.journal = new Journal({ journalOverlayEl, recipes, challenges, regulars });

    // The between-day wave-transition flow. Reaches the Journal + Home via callbacks.
    this.waveTransition = new WaveTransition({
      overlayEl: waveTransitionOverlayEl, challenges, sound,
      onShowJournal: () => this.journal.show(),
      onHome
    });

    // Title / game-over / settings / pause overlays + all menu-button wiring.
    // Reset is wrapped to also re-render the open Journal panels so a wipe shows
    // immediately.
    this.screens = new Screens({
      overlayEl, settingsOverlayEl, pauseOverlayEl, challenges,
      getInGame, getVolume, onSetVolume, getSensitivity, onSetSensitivity, getHaptics, onSetHaptics,
      onStart, onHowToPlay, onPauseToggle, onHome,
      onShowJournal: () => this.journal.show(),
      onResetProgress: () => { onResetProgress(); this.journal.renderAll(); }
    });
  }

  // === Live readouts → LiveHud ================================================
  /** @param {number} score */
  setScore(score) { this.live.setScore(score); }
  /** @param {number} fraction */
  setHealth(fraction) { this.live.setHealth(fraction); }
  /** @param {number} wave @param {number} fraction */
  setGauge(wave, fraction) { this.live.setGauge(wave, fraction); }
  /** @param {number} combo @param {number} [fraction] @param {number} [breakerTarget] */
  setCombo(combo, fraction, breakerTarget) { this.live.setCombo(combo, fraction, breakerTarget); }
  /** @param {boolean} show @param {string|null} [text] */
  setDayHint(show, text) { this.live.setDayHint(show, text); }
  gaugeCenter() { return this.live.gaugeCenter(); }
  flashPhaseUp() { this.live.flashPhaseUp(); }
  flashWaveUp() { this.live.flashWaveUp(); }
  flashHealthDamage() { this.live.flashHealthDamage(); }

  // === Mid-play toasts → Toasts ===============================================
  /** @param {{ title: string }} challenge */
  showChallengeToast(challenge) { this.toasts.challenge(challenge); }
  /** First-time flavor discovery — a quick named toast. @param {string} name */
  showDiscoveryToast(name) { this.toasts.discovery(name); }

  // === Menu screens → Screens =================================================
  /** Home target: hide the journal + wave transition, then rebuild the title. */
  showTitle() {
    this.journal.hide();
    this.waveTransition.hide();
    this.screens.showTitle();
  }
  hideOverlay() { this.screens.hideOverlay(); }
  /**
   * @param {{ score: number, dayCombo: number, bestCombo: number, favFlavor: string }} stats
   * @param {() => void} onRestart
   * @param {{ unlocked: string[], mastered: string[] }} [recipeEvents]
   */
  showGameOver(stats, onRestart, recipeEvents) { this.screens.showGameOver(stats, onRestart, recipeEvents); }
  /** @param {{ onResume: () => void }} opts */
  showPauseMenu(opts) { this.screens.showPauseMenu(opts); }
  hidePauseMenu() { this.screens.hidePauseMenu(); }

  // === Wave transition → WaveTransition =======================================
  /** @param {Parameters<WaveTransition['show']>[0]} opts */
  showWaveTransition(opts) { this.waveTransition.show(opts); }
  hideWaveTransition() { this.waveTransition.hide(); }
}
