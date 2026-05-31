// @ts-check
import { PowerupMode } from './powerup-mode.js';

/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

/**
 * Auto Trigger mode: a caught power-up fires the instant it's caught
 * (replace-on-catch). There is no queue, no Shift verb, and nothing to draw or
 * cash out — every method either forwards to the shared Game._firePower or is a
 * no-op inherited from the base.
 */
export class AutoPowerupMode extends PowerupMode {
  /** @param {PickupTypeName} type @param {number} x @param {number} y */
  onCatch(type, x, y) { this.game._firePower(type, x, y); }

  /** @param {PickupTypeName} type @param {number} x @param {number} y */
  onLootboxSpend(type, x, y) { this.game._firePower(type, x, y); }
}
