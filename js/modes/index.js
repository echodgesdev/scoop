// @ts-check
import { AutoMode } from './auto.js';
import { BankedMode } from './banked.js';
import { TippingMode } from './tipping.js';

/** @typedef {import('../game.js').Game} Game */
/** @typedef {import('./game-mode.js').GameMode} GameMode */

/**
 * The game-mode registry. ADD a mode = write modes/<id>.js (its config, power-up
 * handling, verbs, and tutorial all live there) and add ONE line below. REMOVE a
 * mode = delete that file and its line. Nothing else references it — the debug
 * dropdown and game.js both go through here.
 * @type {Record<string, new (game: Game) => GameMode>}
 */
const MODE_CLASSES = {
  auto: AutoMode,
  banked: BankedMode,
  tipping: TippingMode
};

/** Mode that boots by default + the fallback for an unknown id. */
export const DEFAULT_MODE = 'tipping';

/**
 * {id, label} for each registered mode, in registry order. Built from the modes
 * themselves (each owns its label) so the debug dropdown stays in sync.
 * @type {{ id: string, label: string }[]}
 */
export const MODE_LIST = Object.keys(MODE_CLASSES).map(id => ({
  id,
  // Labels are literal getters; the dummy instance never touches `game`.
  label: new MODE_CLASSES[id](/** @type {any} */ (null)).label
}));

/**
 * Build the GameMode instance for an id, falling back to the default.
 * @param {string} id @param {Game} game @returns {GameMode}
 */
export function makeMode(id, game) {
  const Cls = MODE_CLASSES[id] || MODE_CLASSES[DEFAULT_MODE];
  return new Cls(game);
}
