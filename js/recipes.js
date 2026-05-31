// @ts-check
import { COLOR_KEYS } from './config.js';

/** @typedef {import('./types.js').ScoopColor} ScoopColor */

const STORAGE_KEY = 'scoop.recipes';
export const RECIPE_TARGET = 10; // serves to "master" a recipe

/** @type {Record<ScoopColor, string>} */
const FLAVOR_NAMES = {
  pink:      'Strawberry',
  mint:      'Mint',
  choco:     'Chocolate',
  vanilla:   'Vanilla',
  blueberry: 'Blueberry'
};

/**
 * Recipe groups. Order here drives the display order in the book and the
 * unlock order across waves. Each group sets the points awarded and the
 * combo-weight bump for its recipes — values increase down the list so
 * harder recipes pay more.
 */
export const GROUPS = [
  { id: 'JUNIOR_SCOOP',         name: 'Junior Scoop',          size: 1, value: 60,   weight: 1 },
  { id: 'DAILY_DOUBLE',         name: 'Daily Double',          size: 2, value: 140,  weight: 1 },
  { id: 'YIN_YANG',             name: 'Yin & Yang',            size: 2, value: 180,  weight: 1 },
  { id: 'THREES_COMPANY',       name: "Three's Company",       size: 3, value: 280,  weight: 2 },
  { id: 'BEST_TWO_OF_THREE',    name: 'Best Two Out Of Three', size: 3, value: 320,  weight: 2 },
  { id: 'HOLY_TRINITY',         name: 'Holy Trinity',          size: 3, value: 400,  weight: 2 },
  { id: 'FAB_FOUR',             name: 'Fab Four',              size: 4, value: 600,  weight: 3 },
  { id: 'ROYAL_FLUSH',          name: 'Royal Flush',           size: 4, value: 700,  weight: 3 },
  { id: 'DIABETES',             name: 'Diabetes',              size: 5, value: 1000, weight: 4 },
  { id: 'RAINBOW',              name: 'Rainbow',               size: 5, value: 1500, weight: 5 }
];

const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));

/**
 * Canonical key for a color multiset. Order-independent.
 * @param {ScoopColor[]} colors
 */
export function recipeIdFor(colors) {
  return [...colors].sort().join('+');
}

/** @param {ScoopColor[]} colors */
function defaultRecipeName(colors) {
  const n = colors.length;
  /** @type {Record<string, number>} */
  const counts = {};
  for (const c of colors) counts[c] = (counts[c] || 0) + 1;
  const unique = Object.keys(counts);

  if (n === 1) return FLAVOR_NAMES[colors[0]];
  if (unique.length === 1) {
    const flavor = FLAVOR_NAMES[/** @type {ScoopColor} */ (unique[0])];
    if (n === 2) return `Double ${flavor}`;
    if (n === 3) return `Triple ${flavor}`;
    if (n === 4) return `Quad ${flavor}`;
    if (n === 5) return `Mega ${flavor}`;
  }
  if (n === 5 && unique.length === 5) return 'Rainbow';

  // "Strawberry + Mint + Chocolate" — unique colors only, alphabetised.
  return unique.sort().map(c => FLAVOR_NAMES[/** @type {ScoopColor} */ (c)]).join(' + ');
}

/**
 * Build the master list of *active* recipes. Each recipe belongs to exactly
 * one group and inherits that group's point value + combo weight. Groups
 * with more theoretical combos than the design wants are trimmed to a
 * deterministic subset (sorted by canonical id) so the picks are stable
 * across sessions.
 *
 * @returns {Array<{ id: string, colors: ScoopColor[], name: string, group: string, size: number, value: number, weight: number }>}
 */
function generateActiveRecipes() {
  const recipes = [];
  const seen = new Set();

  /**
   * @param {(typeof GROUPS)[number]} group
   * @param {ScoopColor[]} colors
   */
  function add(group, colors) {
    const id = recipeIdFor(colors);
    if (seen.has(id)) return;
    seen.add(id);
    recipes.push({
      id,
      colors: colors.slice(),
      name: defaultRecipeName(colors),
      group: group.id,
      size: group.size,
      value: group.value,
      weight: group.weight
    });
  }

  /**
   * Sort and trim a candidate list down to `limit` items by canonical id —
   * deterministic so the same combos are picked every session.
   * @template T
   * @param {ScoopColor[][]} candidates
   * @param {number} limit
   * @returns {ScoopColor[][]}
   */
  function trim(candidates, limit) {
    candidates.sort((a, b) => recipeIdFor(a).localeCompare(recipeIdFor(b)));
    return candidates.slice(0, limit);
  }

  // 1. Junior Scoop — every single color (5)
  for (const c of COLOR_KEYS) add(GROUP_BY_ID.JUNIOR_SCOOP, [c]);

  // 2. Daily Double — every 2-same (5)
  for (const c of COLOR_KEYS) add(GROUP_BY_ID.DAILY_DOUBLE, [c, c]);

  // 3. Yin & Yang — 7 of the 10 possible 2-diff pairs
  /** @type {ScoopColor[][]} */
  const yyAll = [];
  for (let i = 0; i < COLOR_KEYS.length; i++) {
    for (let j = i + 1; j < COLOR_KEYS.length; j++) {
      yyAll.push([COLOR_KEYS[i], COLOR_KEYS[j]]);
    }
  }
  for (const c of trim(yyAll, 7)) add(GROUP_BY_ID.YIN_YANG, c);

  // 4. Three's Company — every 3-same (5)
  for (const c of COLOR_KEYS) add(GROUP_BY_ID.THREES_COMPANY, [c, c, c]);

  // 5. Best Two Out Of Three — 10 of the 20 possible AAB combos
  /** @type {ScoopColor[][]} */
  const b2o3All = [];
  for (const a of COLOR_KEYS) {
    for (const b of COLOR_KEYS) {
      if (a !== b) b2o3All.push([a, a, b]);
    }
  }
  for (const c of trim(b2o3All, 10)) add(GROUP_BY_ID.BEST_TWO_OF_THREE, c);

  // 6. Holy Trinity — 5 of the 10 possible 3-all-diff
  /** @type {ScoopColor[][]} */
  const htAll = [];
  for (let i = 0; i < COLOR_KEYS.length; i++) {
    for (let j = i + 1; j < COLOR_KEYS.length; j++) {
      for (let k = j + 1; k < COLOR_KEYS.length; k++) {
        htAll.push([COLOR_KEYS[i], COLOR_KEYS[j], COLOR_KEYS[k]]);
      }
    }
  }
  for (const c of trim(htAll, 5)) add(GROUP_BY_ID.HOLY_TRINITY, c);

  // 7. Fab Four — every 4-all-diff (5; this is C(5,4) which is the natural max)
  for (let leaveOut = 0; leaveOut < COLOR_KEYS.length; leaveOut++) {
    const four = COLOR_KEYS.filter((_, i) => i !== leaveOut);
    add(GROUP_BY_ID.FAB_FOUR, /** @type {ScoopColor[]} */ (four));
  }

  // 8. Royal Flush — every 4-same (5)
  for (const c of COLOR_KEYS) add(GROUP_BY_ID.ROYAL_FLUSH, [c, c, c, c]);

  // 9. Diabetes — every 5-same (5)
  for (const c of COLOR_KEYS) add(GROUP_BY_ID.DIABETES, [c, c, c, c, c]);

  // 10. Rainbow — the single 5-all-diff combo (every color, once)
  add(GROUP_BY_ID.RAINBOW, /** @type {ScoopColor[]} */ (COLOR_KEYS.slice()));

  return recipes;
}

export const ALL_RECIPES = generateActiveRecipes();

// Wave -> set of accessible group ids. Waves 1-3 ramp through 1/2-scoop;
// 4-6 introduce the 3-scoop core; 7-10 stagger the rare 4 and 5 combos so
// the player meets one new group per wave through the late game.
const _CORE = ['JUNIOR_SCOOP', 'DAILY_DOUBLE', 'YIN_YANG', 'THREES_COMPANY', 'BEST_TWO_OF_THREE', 'HOLY_TRINITY'];
/** @type {(string[] | null)[]} */
const WAVE_GROUPS = [
  ['JUNIOR_SCOOP'], // wave 0 — the tutorial wave: single-color juniors only
  ['JUNIOR_SCOOP'],
  ['JUNIOR_SCOOP', 'DAILY_DOUBLE'],
  ['JUNIOR_SCOOP', 'DAILY_DOUBLE', 'YIN_YANG'],
  ['JUNIOR_SCOOP', 'DAILY_DOUBLE', 'YIN_YANG', 'THREES_COMPANY'],
  ['JUNIOR_SCOOP', 'DAILY_DOUBLE', 'YIN_YANG', 'THREES_COMPANY', 'BEST_TWO_OF_THREE'],
  _CORE,
  [..._CORE, 'FAB_FOUR'],
  [..._CORE, 'FAB_FOUR', 'ROYAL_FLUSH'],
  [..._CORE, 'FAB_FOUR', 'ROYAL_FLUSH', 'DIABETES'],
  [..._CORE, 'FAB_FOUR', 'ROYAL_FLUSH', 'DIABETES', 'RAINBOW']
];

/**
 * Recipes available at a given wave, optionally intersected with a set of
 * challenge-unlocked section ids. When `unlockedSections` is provided, only
 * sections in both the wave pool AND the unlocked set are eligible — this
 * lets challenges gate progression independently of wave number.
 *
 * @param {number} wave
 * @param {Set<string>} [unlockedSections] if omitted, no challenge gating applied
 */
export function recipesForWave(wave, unlockedSections) {
  const idx = Math.min(wave, WAVE_GROUPS.length - 1);
  const groups = WAVE_GROUPS[idx];
  if (!groups) return [];
  return ALL_RECIPES.filter(r => {
    if (!groups.includes(r.group)) return false;
    if (unlockedSections && !unlockedSections.has(r.group)) return false;
    return true;
  });
}

/**
 * Recipe book. Tracks completion counts (capped at RECIPE_TARGET) and
 * persists across sessions. Counts saved against ids that aren't in the
 * current active set sit dormant — harmless if you change the active
 * combos later.
 */
export class Recipes {
  constructor() {
    this.all = ALL_RECIPES;
    this.counts = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return /** @type {Record<string, number>} */ ({});
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.counts));
    } catch {}
  }

  /** Wipe all recipe completion counts back to a fresh save. */
  reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.counts = this._load();
  }

  /**
   * @param {ScoopColor[]} colors
   * @returns {{ id: string, wasNew: boolean, justMastered: boolean, count: number }}
   */
  recordComplete(colors) {
    const id = recipeIdFor(colors);
    const prev = this.counts[id] || 0;
    const next = Math.min(RECIPE_TARGET, prev + 1);
    this.counts[id] = next;
    this._save();
    return {
      id,
      wasNew: prev === 0,
      justMastered: prev < RECIPE_TARGET && next === RECIPE_TARGET,
      count: next
    };
  }

  /**
   * Decorated recipe list for the book UI.
   * @returns {Array<{ id: string, colors: ScoopColor[], name: string, group: string, size: number, value: number, weight: number, count: number, locked: boolean, mastered: boolean }>}
   */
  getAll() {
    return this.all.map(r => {
      const count = this.counts[r.id] || 0;
      return {
        ...r,
        count,
        locked: count === 0,
        mastered: count >= RECIPE_TARGET
      };
    });
  }
}
