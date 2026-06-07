// @ts-check
import { TippingMode } from './tipping.js';

/** @typedef {import('../world.js').World} World */

/**
 * Tipping is the game's only mode. This file stays as the single seam World goes
 * through to get its mode, so the concrete class stays decoupled and adding modes
 * back later is a one-liner. DEFAULT_MODE is kept for save/label parity.
 */
export const DEFAULT_MODE = 'tipping';

/** @param {World} world @returns {TippingMode} */
export function makeMode(world) {
  return new TippingMode(world);
}
