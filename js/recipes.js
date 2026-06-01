// @ts-check
/** @typedef {import('./types.js').ScoopColor} ScoopColor */

const STORAGE_KEY = 'scoop.recipes';
export const RECIPE_TARGET = 10; // serves to "master" a recipe

// The five flavor-key constants — the ScoopColor ids used everywhere (recipe
// matching, demand bias, rendering). Referenced by the GROUPS catalog below
// instead of raw strings, so the flavor set lives in one place and a typo is a
// reference error. Display NAMES are baked into each recipe at seed time
// (seed/gen-recipes.mjs builds them); there's no runtime name builder here.
const PINK = 'pink', MINT = 'mint', CHOCO = 'choco', VANILLA = 'vanilla', BLUEBERRY = 'blueberry';

/**
 * Recipe catalog — defined EXPLICITLY here, no combinatorial generation: each
 * group lists its recipes as color arrays. Sizes cap at 3 scoops (no 4-scoop,
 * hence no four-of-a-kind). Every group holds exactly 5 recipes of one uniform
 * size; together the 11 groups cover the entire 1/2/3-scoop multiset space
 * (5 + 15 + 35 = 55). Order drives the recipe-book display + the wave/challenge
 * unlock order; value rises down the list so harder recipes pay more, and
 * `weight` is the combo bump. Each recipe is { name, colors } with the display
 * name BAKED at seed time. Regenerate the whole block with seed/gen-recipes.mjs.
 * @typedef {{ name: string, colors: ScoopColor[] }} Recipe
 * @typedef {{ id: string, name: string, size: number, value: number, weight: number, recipes: Recipe[] }} RecipeGroup
 */
/** @type {RecipeGroup[]} */
export const GROUPS = [
  { id: 'JUNIOR_SCOOP', name: "Junior Scoop", size: 1, value: 60, weight: 1,
    recipes: [
      { name: "Strawberry", colors: [PINK] },
      { name: "Mint", colors: [MINT] },
      { name: "Chocolate", colors: [CHOCO] },
      { name: "Vanilla", colors: [VANILLA] },
      { name: "Blueberry", colors: [BLUEBERRY] },
    ] },
  { id: 'DAILY_DOUBLE', name: "Daily Double", size: 2, value: 140, weight: 1,
    recipes: [
      { name: "Double Strawberry", colors: [PINK, PINK] },
      { name: "Double Mint", colors: [MINT, MINT] },
      { name: "Double Chocolate", colors: [CHOCO, CHOCO] },
      { name: "Double Vanilla", colors: [VANILLA, VANILLA] },
      { name: "Double Blueberry", colors: [BLUEBERRY, BLUEBERRY] },
    ] },
  { id: 'YIN_YANG', name: "Yin & Yang", size: 2, value: 170, weight: 1,
    recipes: [
      { name: "Blueberry + Chocolate", colors: [CHOCO, BLUEBERRY] },
      { name: "Blueberry + Mint", colors: [MINT, BLUEBERRY] },
      { name: "Blueberry + Strawberry", colors: [PINK, BLUEBERRY] },
      { name: "Blueberry + Vanilla", colors: [VANILLA, BLUEBERRY] },
      { name: "Chocolate + Mint", colors: [MINT, CHOCO] },
    ] },
  { id: 'ODD_COUPLE', name: "Odd Couple", size: 2, value: 190, weight: 1,
    recipes: [
      { name: "Chocolate + Strawberry", colors: [PINK, CHOCO] },
      { name: "Chocolate + Vanilla", colors: [CHOCO, VANILLA] },
      { name: "Mint + Strawberry", colors: [PINK, MINT] },
      { name: "Mint + Vanilla", colors: [MINT, VANILLA] },
      { name: "Strawberry + Vanilla", colors: [PINK, VANILLA] },
    ] },
  { id: 'THREES_COMPANY', name: "Three's Company", size: 3, value: 280, weight: 2,
    recipes: [
      { name: "Triple Strawberry", colors: [PINK, PINK, PINK] },
      { name: "Triple Mint", colors: [MINT, MINT, MINT] },
      { name: "Triple Chocolate", colors: [CHOCO, CHOCO, CHOCO] },
      { name: "Triple Vanilla", colors: [VANILLA, VANILLA, VANILLA] },
      { name: "Triple Blueberry", colors: [BLUEBERRY, BLUEBERRY, BLUEBERRY] },
    ] },
  { id: 'BEST_TWO_OF_THREE', name: "Best Two of Three", size: 3, value: 300, weight: 2,
    recipes: [
      { name: "Double Blueberry + Chocolate", colors: [BLUEBERRY, BLUEBERRY, CHOCO] },
      { name: "Double Blueberry + Mint", colors: [BLUEBERRY, BLUEBERRY, MINT] },
      { name: "Double Blueberry + Strawberry", colors: [BLUEBERRY, BLUEBERRY, PINK] },
      { name: "Double Blueberry + Vanilla", colors: [BLUEBERRY, BLUEBERRY, VANILLA] },
      { name: "Double Chocolate + Blueberry", colors: [CHOCO, CHOCO, BLUEBERRY] },
    ] },
  { id: 'DOUBLE_DATE', name: "Double Date", size: 3, value: 320, weight: 2,
    recipes: [
      { name: "Double Mint + Blueberry", colors: [MINT, MINT, BLUEBERRY] },
      { name: "Double Strawberry + Blueberry", colors: [PINK, PINK, BLUEBERRY] },
      { name: "Double Vanilla + Blueberry", colors: [VANILLA, VANILLA, BLUEBERRY] },
      { name: "Double Chocolate + Mint", colors: [CHOCO, CHOCO, MINT] },
      { name: "Double Chocolate + Strawberry", colors: [CHOCO, CHOCO, PINK] },
    ] },
  { id: 'PAIR_UP', name: "Pair Up", size: 3, value: 340, weight: 2,
    recipes: [
      { name: "Double Chocolate + Vanilla", colors: [CHOCO, CHOCO, VANILLA] },
      { name: "Double Mint + Chocolate", colors: [MINT, MINT, CHOCO] },
      { name: "Double Strawberry + Chocolate", colors: [PINK, PINK, CHOCO] },
      { name: "Double Vanilla + Chocolate", colors: [VANILLA, VANILLA, CHOCO] },
      { name: "Double Mint + Strawberry", colors: [MINT, MINT, PINK] },
    ] },
  { id: 'ODD_TRIO', name: "Odd Trio", size: 3, value: 360, weight: 2,
    recipes: [
      { name: "Double Mint + Vanilla", colors: [MINT, MINT, VANILLA] },
      { name: "Double Strawberry + Mint", colors: [PINK, PINK, MINT] },
      { name: "Double Vanilla + Mint", colors: [VANILLA, VANILLA, MINT] },
      { name: "Double Strawberry + Vanilla", colors: [PINK, PINK, VANILLA] },
      { name: "Double Vanilla + Strawberry", colors: [VANILLA, VANILLA, PINK] },
    ] },
  { id: 'HOLY_TRINITY', name: "Holy Trinity", size: 3, value: 400, weight: 2,
    recipes: [
      { name: "Blueberry + Chocolate + Mint", colors: [MINT, CHOCO, BLUEBERRY] },
      { name: "Blueberry + Chocolate + Strawberry", colors: [PINK, CHOCO, BLUEBERRY] },
      { name: "Blueberry + Chocolate + Vanilla", colors: [CHOCO, VANILLA, BLUEBERRY] },
      { name: "Blueberry + Mint + Strawberry", colors: [PINK, MINT, BLUEBERRY] },
      { name: "Blueberry + Mint + Vanilla", colors: [MINT, VANILLA, BLUEBERRY] },
    ] },
  { id: 'TRIPLE_THREAT', name: "Triple Threat", size: 3, value: 440, weight: 2,
    recipes: [
      { name: "Blueberry + Strawberry + Vanilla", colors: [PINK, VANILLA, BLUEBERRY] },
      { name: "Chocolate + Mint + Strawberry", colors: [PINK, MINT, CHOCO] },
      { name: "Chocolate + Mint + Vanilla", colors: [MINT, CHOCO, VANILLA] },
      { name: "Chocolate + Strawberry + Vanilla", colors: [PINK, CHOCO, VANILLA] },
      { name: "Mint + Strawberry + Vanilla", colors: [PINK, MINT, VANILLA] },
    ] }
];

/**
 * Canonical key for a color multiset. Order-independent.
 * @param {ScoopColor[]} colors
 */
export function recipeIdFor(colors) {
  return [...colors].sort().join('+');
}

/**
 * Flatten GROUPS into the master recipe list. Each recipe carries its baked
 * display name and inherits its group's size / value / weight, plus a canonical
 * multiset id. The catalog is the explicit GROUPS data above — no generation,
 * no runtime name building.
 * @returns {Array<{ id: string, colors: ScoopColor[], name: string, group: string, size: number, value: number, weight: number }>}
 */
function generateActiveRecipes() {
  return GROUPS.flatMap(g => g.recipes.map(rec => ({
    id: recipeIdFor(rec.colors),
    colors: rec.colors.slice(),
    name: rec.name,
    group: g.id,
    size: g.size,
    value: g.value,
    weight: g.weight
  })));
}

export const ALL_RECIPES = generateActiveRecipes();

// Wave -> accessible group ids. The pool grows by one group per wave (in GROUPS
// order — singles → 2-scoop → the 3-scoop families), clamping at the full set.
// recipesForWave further intersects this with the player's challenge-unlocked
// sections, so a group appears only once it is BOTH wave-reached AND unlocked.
const _GROUP_IDS = GROUPS.map(g => g.id);
// Cumulative group count by wave index (wave 0 = tutorial singles only).
const _WAVE_COUNTS = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** @type {(string[] | null)[]} */
const WAVE_GROUPS = _WAVE_COUNTS.map(k => _GROUP_IDS.slice(0, k));

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
   * Has this recipe been completed at least once? Drives the spawn discovery
   * bias (Waves.pickOrder favors undiscovered recipes on bigger waves).
   * @param {string} id canonical recipe id (recipeIdFor)
   */
  isDiscovered(id) {
    return (this.counts[id] || 0) > 0;
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
