// seed/gen-recipes.mjs
// Regenerates the explicit recipe catalog pasted into js/recipes.js (GROUPS).
//
// Catalog = EVERY 1-, 2-, and 3-scoop multiset of the 5 flavors (no 4-scoop,
// so no four-of-a-kind), partitioned into uniform groups of EXACTLY 5:
//   size 1: singles (5)                          -> 1 group
//   size 2: 2-same (5) + 2-different (10)        -> 3 groups
//   size 3: 3-same (5) + pair+1 (20) + 3-diff(10)-> 7 groups
//   = 55 recipes, 11 groups of 5.
//
// Recipes are unordered multisets (color counts only), so the canonical id is
// the sorted color join — matching js/recipes.js recipeIdFor(). The split
// families (2-diff, pair+1, 3-diff) are chunked deterministically by that id so
// regeneration is stable.
//
// Run:  node seed/gen-recipes.mjs
// Then paste the printed `export const GROUPS = [...]` block into js/recipes.js.

const COLORS = ['pink', 'mint', 'choco', 'vanilla', 'blueberry'];
const id = a => [...a].sort().join('+');
const bySortedId = (x, y) => id(x).localeCompare(id(y));

// Display names + the recipe-NAME builder. Moved out of js/recipes.js so names
// are baked into the catalog at seed time instead of computed every load.
//
// Count-aware so every multiset gets a UNIQUE, descriptive name: each distinct
// flavor becomes a "Double/Triple …" token (bare for a single scoop), most-of
// first, then alphabetical. So "Double Strawberry + Chocolate" (🍓🍓🍫) is
// distinct from "Double Chocolate + Strawberry" (🍫🍫🍓) — the old builder
// collapsed both to "Chocolate + Strawberry".
const FLAVOR_NAMES = { pink: 'Strawberry', mint: 'Mint', choco: 'Chocolate', vanilla: 'Vanilla', blueberry: 'Blueberry' };
const COUNT_WORD = { 2: 'Double', 3: 'Triple', 4: 'Quad', 5: 'Mega' };
function recipeName(colors) {
  const counts = {};
  for (const c of colors) counts[c] = (counts[c] || 0) + 1;
  return Object.keys(counts)
    .sort((a, b) => (counts[b] - counts[a]) || FLAVOR_NAMES[a].localeCompare(FLAVOR_NAMES[b]))
    .map(c => (counts[c] > 1 ? COUNT_WORD[counts[c]] + ' ' : '') + FLAVOR_NAMES[c])
    .join(' + ');
}

// --- families (multisets) ---------------------------------------------------
const singles   = COLORS.map(c => [c]);
const twoSame   = COLORS.map(c => [c, c]);
const threeSame = COLORS.map(c => [c, c, c]);
/** @type {string[][]} */ const twoDiff = []; // AB
/** @type {string[][]} */ const abc = [];     // ABC (3 different)
for (let i = 0; i < COLORS.length; i++) {
  for (let j = i + 1; j < COLORS.length; j++) {
    twoDiff.push([COLORS[i], COLORS[j]]);
    for (let k = j + 1; k < COLORS.length; k++) abc.push([COLORS[i], COLORS[j], COLORS[k]]);
  }
}
/** @type {string[][]} */ const aab = []; // AAB (pair + single)
for (const a of COLORS) for (const b of COLORS) if (a !== b) aab.push([a, a, b]);

/** Deterministic split of a family into groups of 5 (sorted by canonical id). */
const chunk5 = arr => {
  const s = arr.slice().sort(bySortedId);
  const out = [];
  for (let i = 0; i < s.length; i += 5) out.push(s.slice(i, i + 5));
  return out;
};

const ab2  = chunk5(twoDiff); // 2 groups
const aab4 = chunk5(aab);     // 4 groups
const abc2 = chunk5(abc);     // 2 groups

// --- group plan -------------------------------------------------------------
// value rises with size and gently within a family (later-unlocked = pays more);
// weight is the combo bump (1 for 1-2 scoop, 2 for 3-scoop).
const GROUPS = [
  { id: 'JUNIOR_SCOOP',      name: 'Junior Scoop',      size: 1, value: 60,  weight: 1, recipes: singles },
  { id: 'DAILY_DOUBLE',      name: 'Daily Double',      size: 2, value: 140, weight: 1, recipes: twoSame },
  { id: 'YIN_YANG',          name: 'Yin & Yang',        size: 2, value: 170, weight: 1, recipes: ab2[0] },
  { id: 'ODD_COUPLE',        name: 'Odd Couple',        size: 2, value: 190, weight: 1, recipes: ab2[1] },
  { id: 'THREES_COMPANY',    name: "Three's Company",   size: 3, value: 280, weight: 2, recipes: threeSame },
  { id: 'BEST_TWO_OF_THREE', name: 'Best Two of Three', size: 3, value: 300, weight: 2, recipes: aab4[0] },
  { id: 'DOUBLE_DATE',       name: 'Double Date',       size: 3, value: 320, weight: 2, recipes: aab4[1] },
  { id: 'PAIR_UP',           name: 'Pair Up',           size: 3, value: 340, weight: 2, recipes: aab4[2] },
  { id: 'ODD_TRIO',          name: 'Odd Trio',          size: 3, value: 360, weight: 2, recipes: aab4[3] },
  { id: 'HOLY_TRINITY',      name: 'Holy Trinity',      size: 3, value: 400, weight: 2, recipes: abc2[0] },
  { id: 'TRIPLE_THREAT',     name: 'Triple Threat',     size: 3, value: 440, weight: 2, recipes: abc2[1] }
];

// --- emit a paste-ready JS literal -----------------------------------------
// Each recipe is baked as { name, colors }: the NAME is built here (no runtime
// name builder), and colors reference the flavor-key CONSTANTS in js/recipes.js
// (PINK, MINT, …) rather than raw strings, so a typo is a reference error.
const KEY_CONST = { pink: 'PINK', mint: 'MINT', choco: 'CHOCO', vanilla: 'VANILLA', blueberry: 'BLUEBERRY' };
const fmtRecipe = c => `{ name: ${JSON.stringify(recipeName(c))}, colors: [${c.map(x => KEY_CONST[x]).join(', ')}] }`;
const out = ['export const GROUPS = ['];
for (const g of GROUPS) {
  out.push(`  { id: '${g.id}', name: ${JSON.stringify(g.name)}, size: ${g.size}, value: ${g.value}, weight: ${g.weight},`);
  out.push('    recipes: [');
  for (const rec of g.recipes) out.push(`      ${fmtRecipe(rec)},`);
  out.push('    ] },');
}
out.push('];');
console.log(out.join('\n'));

// --- sanity (stderr) --------------------------------------------------------
const total = GROUPS.reduce((n, g) => n + g.recipes.length, 0);
const ids = GROUPS.flatMap(g => g.recipes.map(id));
console.error(`\n# groups=${GROUPS.length} total=${total} uniqueIds=${new Set(ids).size} sizes=${[...new Set(GROUPS.map(g => g.size))].join(',')}`);
const nonFive = GROUPS.filter(g => g.recipes.length !== 5).map(g => `${g.id}:${g.recipes.length}`);
console.error(nonFive.length ? `# NON-5 GROUPS: ${nonFive.join(' ')}` : '# all groups have exactly 5');
const oversize = ids.filter((_, i) => GROUPS.flatMap(g => g.recipes)[i].length > 3).length;
console.error(`# recipes with >3 scoops: ${oversize}`);
