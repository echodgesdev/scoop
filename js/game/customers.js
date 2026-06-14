// @ts-check
// The customer ROSTER — the playable "regulars" on the customer sheet (sprite
// rows 1..13; row 0 is the sheet's legend, not a character — see
// view/sprites/customerSprite.js). Each regular carries the data the upcoming
// "unlockable characters" epic hangs off of:
//   · favoriteFlavor — the scoop they love (seeds favorite-flavor challenges)
//   · blurb          — one-line flavor text (shown on their unlock card)
//   · served         — lifetime completed orders (seeds "Served N times")
// `name` MUST match the sprite-sheet row name; the renderer resolves a customer
// to their face row by that string.
//
// `served` is an in-session counter for now (resets on reload); persistence
// rides along with the challenge/recipe save when that epic lands.

/** @typedef {import('../types.js').ScoopColor} ScoopColor */

/**
 * @typedef {object} CharacterDef
 * @property {string} name             display name; must match the sprite-sheet row
 * @property {ScoopColor} favoriteFlavor
 * @property {string} blurb            one-line flavor text
 * @property {number} served           lifetime completed orders (runtime counter)
 */

/** @type {CharacterDef[]} The 13 playable regulars (sprite rows 1..13). */
export const CHARACTERS = [
  { name: 'Annie',        favoriteFlavor: 'pink',      blurb: 'Overachiever — wants her scoop just so.',          served: 0 },
  { name: 'Amara',        favoriteFlavor: 'choco',     blurb: "Globetrotter chasing the world's best cone.",       served: 0 },
  { name: 'Sanjay',       favoriteFlavor: 'mint',      blurb: 'Codes by day, craves mint by night.',               served: 0 },
  { name: 'Gerald',       favoriteFlavor: 'vanilla',   blurb: 'Retired, particular, tips in wisdom.',              served: 0 },
  { name: 'Chad',         favoriteFlavor: 'blueberry', blurb: "Surf's up, scoops down. Brah.",                      served: 0 },
  { name: 'Missy',        favoriteFlavor: 'pink',      blurb: 'Sweet tooth, zero patience.',                       served: 0 },
  { name: 'Karen',        favoriteFlavor: 'vanilla',   blurb: 'Would like to speak to the scooper.',               served: 0 },
  { name: 'Axel',         favoriteFlavor: 'choco',     blurb: 'Rides hard, eats harder.',                          served: 0 },
  { name: 'Reginald',     favoriteFlavor: 'mint',      blurb: 'Insists on a spoon. And a napkin.',                 served: 0 },
  { name: 'Chris',        favoriteFlavor: 'blueberry', blurb: 'Just happy to be here, honestly.',                  served: 0 },
  { name: 'Freddie',      favoriteFlavor: 'pink',      blurb: 'Showman — demands a standing-ovation cone.',        served: 0 },
  { name: 'Harvey Green', favoriteFlavor: 'mint',      blurb: 'A little green, a lot hungry.',                     served: 0 },
  { name: 'Poop',         favoriteFlavor: 'choco',     blurb: '...how is he even ordering?',                       served: 0 }
];

/** Roster lookup by name (e.g. to bump `served` on a completed order). */
export const CHARACTER_BY_NAME = new Map(CHARACTERS.map(c => [c.name, c]));

/**
 * Selection waterfall — pick which regular walks up next.
 *
 * The rules cascade from strict to loose; each looser tier is reached ONLY when
 * the stricter one above it would leave nobody to pick:
 *   1. (hard) a regular appears at most once on screen at a time — drop anyone in
 *      `onScreen`. If that empties the pool there's genuinely no one free → null.
 *   2. (soft) a regular never immediately replaces themselves — drop `justLeft`,
 *      the one who just departed. Relaxed if it would empty the pool.
 * The pick is uniform-random within the surviving pool. Add stricter tiers above
 * (e.g. cooldown / locked-until-unlocked) as the epic grows — keep them in
 * strict→loose order so the cascade still degrades gracefully.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.onScreen]  names already present (any state)
 * @param {string|null} [opts.justLeft]  name of the most recent departure
 * @param {CharacterDef[]} [opts.roster]  candidate pool (defaults to all regulars)
 * @param {() => number} [opts.rng]  random source in [0,1) (injectable for tests)
 * @returns {CharacterDef | null}
 */
export function pickCustomer({ onScreen = [], justLeft = null, roster = CHARACTERS, rng = Math.random } = {}) {
  const taken = new Set(onScreen);
  // Tier 1 (hard): only regulars not already on screen.
  const free = roster.filter(c => !taken.has(c.name));
  if (free.length === 0) return null;
  // Tier 2 (soft): exclude the just-departed regular, unless that leaves no one.
  const withoutRepeat = justLeft ? free.filter(c => c.name !== justLeft) : free;
  const pool = withoutRepeat.length > 0 ? withoutRepeat : free;
  return pool[Math.floor(rng() * pool.length)];
}
