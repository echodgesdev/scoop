// @ts-check
// The single home for everything a pickup token carries into the presentation
// layer: how it LOOKS (icon glyph + ring color + the cone-vortex palette fired on
// trigger), what it's CALLED (name + one-line desc for the Power-ups reference
// modal), and which synthesised SOUND plays when it fires. One row per token, so
// adding or retuning a pickup is a single-object edit — every drawer (the on-cone
// active indicator, the customer tip token), the journal, the round-over reveal,
// and reactions.js all read from here.
//
// `sound` is the name of a Sound method (engine/audio.js); reactions dispatches
// game.sound[sound](). The type names stay "feather"/"pause" for code stability,
// but the icons/names are chosen for legibility (⚡ reads "fast", ❄️ "frozen").
// 'coin' uses '$' because the coin emoji doesn't render everywhere.

/**
 * @typedef {Object} PickupDef
 * @property {string} name      display name (matches the challenge reward labels)
 * @property {string} desc      one-line blurb for the Power-ups reference modal
 * @property {string} icon      emoji glyph (becomes a sprite/atlas lookup later)
 * @property {string} ring      ring / accent color
 * @property {string[]} palette cone-vortex shard colors fired on trigger
 * @property {string} sound     Sound (engine/audio.js) method name fired on trigger
 */

/** @type {Record<string, PickupDef>} */
export const PICKUPS = {
  heart: {
    name: 'Heart',
    desc: 'Patches you up — restores some health instantly.',
    icon: '❤️',
    ring: '#ff6fa3',
    palette: ['#ff4d6d', '#ff8fa3', '#ffd1dc'],
    sound: 'heart'
  },
  feather: {
    name: 'Speed',
    desc: 'Your cone zips around faster for a few seconds.',
    icon: '⚡',
    ring: '#bfdcff',
    palette: ['#ffe14d', '#ffd166', '#fff3a0'],
    sound: 'feather'
  },
  pause: {
    name: 'Freeze',
    desc: "Freezes every customer's patience — serve with no clock ticking.",
    icon: '❄️',
    ring: '#c9b6ff',
    palette: ['#7ec8ff', '#bfe3ff', '#5cb8ff'],
    sound: 'pausePickup'
  },
  rainbow: {
    name: 'Rainbow',
    desc: 'Every scoop counts as any color — serve any order for a few seconds.',
    icon: '🌈',
    ring: '#ffd166',
    palette: ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'],
    sound: 'rainbowPickup'
  },
  coin: {
    name: 'Coin Tip',
    desc: 'A cash tip: bonus points, no power-up effect.',
    icon: '$',
    ring: '#ffd700',
    palette: ['#ffd700', '#ffb703', '#ffe9a0'],
    sound: 'bubblePop'
  }
};

// Legacy per-attribute projections, DERIVED from PICKUPS so the table stays the
// one source of truth. Existing consumers read these by-attribute maps; new code
// reads PICKUPS directly.
const _defs = /** @type {[string, PickupDef][]} */ (Object.entries(PICKUPS));
/** @param {keyof PickupDef} key @returns {Record<string, any>} */
function _project(key) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [type, def] of _defs) out[type] = def[key];
  return out;
}
export const PICKUP_ICONS      = _project('icon');
export const PICKUP_RING_COLOR = _project('ring');
export const PICKUP_NAME       = _project('name');
export const PICKUP_DESC       = _project('desc');
