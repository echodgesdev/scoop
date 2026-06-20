// @ts-check
// HUD coordinator. The DOM UI is split into focused controllers, each owning its
// elements + its own rendering/wiring:
//   liveHud.js        — the always-on readouts (score / combo / gauge / health / day-hint + flashes)
//   journal.js        — the tabbed collection hub + the tap-a-coin detail popup
//   roundOver.js      — the full-screen round-over modal (next-wave AND game over): tap-gated
//                       sequence of cross-offs → unlock carousel → score card
//   screens.js        — title / settings / pause overlays + their button wiring
//   toastUI.js        — mid-play toasts
// This file builds those controllers, injects the few cross-concern callbacks
// between them (e.g. "open the Journal", "go Home", re-render on reset), and
// forwards the public API that game.js / reactions.js call. No DOM or rendering
// logic lives here — it coordinates, it doesn't render.
import { Toasts } from './toastUI.js';
import { LiveHud } from './liveHud.js';
import { Journal } from './journal.js';
import { RoundOver } from './roundOver.js';
import { NightSky } from './nightSky.js';
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

    // The full-screen round-over modal (next-wave + game over). Reaches the Journal
    // + Home via callbacks.
    this.roundOver = new RoundOver({
      overlayEl: waveTransitionOverlayEl, challenges, sound,
      onShowJournal: () => this.journal.show(),
      onHome
    });

    // The between-round night sequence: challenges in the sky + the countdown.
    this.nightSky = new NightSky({ challenges });

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
  /** Home target: hide the journal + round-over modal, then rebuild the title. */
  showTitle() {
    this.journal.hide();
    this.roundOver.hide();
    this.screens.showTitle();
  }
  hideOverlay() { this.screens.hideOverlay(); }
  /**
   * Game over routes through the same full-screen modal as the next-wave recap
   * (item: identical except the primary button). Screens owns the best-score, so
   * record it there first, then hand the result to the modal's score card.
   * @param {{ score: number, dayCombo: number, bestCombo: number, favFlavor: string }} stats
   * @param {() => void} onRestart
   * @param {{ unlocked: string[], mastered: string[] }} [recipeEvents]
   */
  showGameOver(stats, onRestart, recipeEvents) {
    const { isRecord, best } = this.screens.recordScore(stats.score);
    this.roundOver.showGameOver({ stats, onRestart, recipeEvents, isRecord, best });
  }
  /** @param {{ onResume: () => void }} opts */
  showPauseMenu(opts) { this.screens.showPauseMenu(opts); }
  hidePauseMenu() { this.screens.hidePauseMenu(); }

  // === Round-over modal → RoundOver ===========================================
  /** @param {Parameters<RoundOver['showNextWave']>[0]} opts */
  showWaveTransition(opts) { this.roundOver.showNextWave(opts); }
  hideWaveTransition() { this.roundOver.hide(); }

  // === Night sequence → NightSky ==============================================
  /** @param {number} fraction night-cycle progress 0..1 */
  setNightSky(fraction) { this.nightSky.showChallenges(fraction); }
  hideNightSky() { this.nightSky.hideChallenges(); }
  /** @param {string|null} label round-start countdown beat, or null to hide */
  setRoundIntro(label) { this.nightSky.setCountdown(label); }
}
