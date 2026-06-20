// @ts-check
// The customer ROSTER — the static catalog of playable "regulars" on the
// customer sheet (sprite rows 1..13; row 0 is the sheet's legend, not a
// character — see view/sprites/customerSprite.js). Each regular carries the data
// the "unlockable characters" epic hangs off of:
//   · favoriteRecipe — canonical recipe id (recipeIdFor — see recipes.js) of their
//                      go-to order; shown on their collection card.
//   · blurb          — one-line flavor text (shown on their collection card).
//   · starter        — true = unlocked from the start (the rest are mystery
//                      unlocks: one locked regular per run starts appearing on a
//                      random day and unlocks when first served — see world.js).
// `name` MUST match the sprite-sheet row name; the renderer resolves a customer
// to their face row by that string.
//
// This module is pure catalog data + the selection waterfall. The MUTABLE
// progression (which regulars are unlocked, lifetime served counts) lives in the
// persisted Regulars store (game/regulars.js), keyed by `name`.

import { recipeIdFor, PINK, MINT, CHOCO, VANILLA, BLUEBERRY } from './recipes.js';

/**
 * @typedef {object} CharacterDef
 * @property {string} name             display name; must match the sprite-sheet row
 * @property {string} favoriteRecipe   canonical recipe id (e.g. 'pink+pink') of their go-to order
 * @property {string} blurb            one-line flavor text
 * @property {boolean} [starter]       unlocked from the start (no unlock needed)
 * @property {boolean} [mystery]       eligible for the per-run random encounter (days 3–7);
 *                                     unlocked by serving them. Challenge-reward regulars
 *                                     (Freddie/Harvey Green/Karen/Poop) have neither flag —
 *                                     they unlock only from their challenge set (challenges.js).
 */

/** @type {CharacterDef[]} The 13 playable regulars (sprite rows 1..13):
 *  · 5 STARTERS (always available so the spawn pool is never starved)
 *  · 4 MYSTERY (random encounters, days 3–7)
 *  · 4 CHALLENGE rewards (no flag) — Freddie/Harvey Green/Karen/Poop. */
export const CHARACTERS = [
  { name: 'Annie',        favoriteRecipe: recipeIdFor([PINK, PINK]),            blurb: 'Overachiever — wants her scoop just so.',          starter: true },
  { name: 'Amara',        favoriteRecipe: recipeIdFor([CHOCO, CHOCO, CHOCO]),   blurb: "Globetrotter chasing the world's best cone.",       starter: true },
  { name: 'Sanjay',       favoriteRecipe: recipeIdFor([MINT, MINT]),            blurb: 'Codes by day, craves mint by night.',               starter: true },
  { name: 'Gerald',       favoriteRecipe: recipeIdFor([VANILLA]),               blurb: 'Retired, particular, tips in wisdom.',              starter: true },
  { name: 'Chad',         favoriteRecipe: recipeIdFor([BLUEBERRY, BLUEBERRY]),  blurb: "Surf's up, scoops down. Brah.",                      starter: true },
  { name: 'Missy',        favoriteRecipe: recipeIdFor([PINK]),                  blurb: 'Sweet tooth, zero patience.',                       mystery: true },
  { name: 'Axel',         favoriteRecipe: recipeIdFor([CHOCO, CHOCO]),          blurb: 'Rides hard, eats harder.',                          mystery: true },
  { name: 'Reginald',     favoriteRecipe: recipeIdFor([MINT]),                  blurb: 'Insists on a spoon. And a napkin.',                 mystery: true },
  { name: 'Chris',        favoriteRecipe: recipeIdFor([BLUEBERRY]),             blurb: 'Just happy to be here, honestly.',                  mystery: true },
  { name: 'Karen',        favoriteRecipe: recipeIdFor([MINT, VANILLA]),         blurb: 'Would like to speak to the scooper.' },
  { name: 'Freddie',      favoriteRecipe: recipeIdFor([PINK, PINK, PINK]),      blurb: 'Showman — demands a standing-ovation cone.' },
  { name: 'Harvey Green', favoriteRecipe: recipeIdFor([MINT, MINT, MINT]),      blurb: 'A little green, a lot hungry.' },
  { name: 'Poop',         favoriteRecipe: recipeIdFor([CHOCO, CHOCO, CHOCO]),   blurb: '...how is he even ordering?' }
];

/** Roster lookup by name. */
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
