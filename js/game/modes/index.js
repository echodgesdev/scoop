// @ts-check
import { TippingMode } from './tipping.js';

/** @typedef {import('../../game.js').Game} Game */

/**
 * Tipping is the game's only mode. This file stays as the single seam game.js
 * goes through to get its mode, so the concrete class stays decoupled and adding
 * modes back later is a one-liner. DEFAULT_MODE is kept for save/label parity.
 */
export const DEFAULT_MODE = 'tipping';

/** @param {Game} game @returns {TippingMode} */
export function makeMode(game) {
  return new TippingMode(game);
}
