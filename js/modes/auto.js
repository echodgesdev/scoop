// @ts-check
import { GameMode } from './game-mode.js';
import { TutorialBase } from '../tutorial.js';
import { POWERUP_TYPE } from '../config.js';

/** @typedef {import('../game.js').Game} Game */

/** Auto Trigger tutorial: catching a ⚡ bubble fires it on the spot. */
class AutoTutorial extends TutorialBase {
  /** @param {Game} game */
  _updatePowerLesson(game) {
    if (!this.powerLessonDone && game.powerups.active(POWERUP_TYPE.SPEED)) this.powerLessonDone = true;
  }

  /** @param {Game} game */
  _powerHint(game) {
    if (this.powerLessonDone) return null;
    if (this._featherPresent(game)) {
      return this._touch(game)
        ? 'Swipe up to pop the ⚡ — it fires instantly!'
        : 'Space to pop the ⚡ — it fires instantly!';
    }
    return null;
  }
}

/**
 * Auto Trigger: a caught power-up fires the instant it's caught
 * (replace-on-catch). This is exactly the base GameMode behavior, so the class
 * only names itself and picks its tutorial.
 */
export class AutoMode extends GameMode {
  get id() { return 'auto'; }
  get label() { return 'Auto Trigger'; }
  makeTutorial() { return new AutoTutorial(); }
}
