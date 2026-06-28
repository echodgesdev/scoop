// @ts-check
// The journal's per-collection coins + detail popups. coinGrid renders a grid of
// one collection's coins (each item mapped to a coinHtml descriptor by a private
// per-kind mapper); the detail builders produce the fuller tap-a-coin markup.
// Pure string builders over the shared coin component in coinTemplate.js.
//
// `regularFacePos` + `RECIPE_RING` are exported because the wave-transition unlock
// reveals render the same collection items — they reuse the regular-face sheet
// crop and the recipe ring rather than redefining them.

import { COLORS } from '../../../game/config.js';
import { RECIPE_TARGET, RECIPE_BY_ID, GROUP_BY_ID } from '../../../game/recipes.js';
import CUSTOMER_SPRITE from '../../sprites/customerSprite.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR, PICKUP_NAME, PICKUP_DESC } from '../../powerupVisuals.js';
import { coinVisual, coinHtml, coinScoops } from './coinTemplate.js';
import { challengeRow } from './challengeTemplate.js';
import { SEMANTIC } from '../../palette.js';

/**
 * The journal's coin kinds. Doubles as the `data-kind` on each coin button (which
 * drives the tap-a-coin detail popup) and the key selecting the per-kind mapper in
 * coinGrid below.
 * @type {Readonly<{ REGULAR: 'regular', POWERUP: 'powerup', RECIPE: 'recipe', CHALLENGE: 'challenge' }>}
 */
export const COIN_KIND = Object.freeze({ REGULAR: 'regular', POWERUP: 'powerup', RECIPE: 'recipe', CHALLENGE: 'challenge' });

// Regulars: faces are cropped from the shared sprite sheet via CSS background-
// position — the row is the regular's sheet row (animation index), the column the
// expression. Tile sizes mirror styles.css; keep them in step.
const REGULAR_FACE_COL = 1;          // column 1 = Default face — shown unlocked
const REGULAR_EMPTY_COL = 0;         // column 0 = Empty white "shadow" — shown locked (CSS greys it)
/** @type {Map<string, number>} regular name → sprite-sheet row (animation index) */
const REGULAR_ROW_BY_NAME = new Map(CUSTOMER_SPRITE.animations.map((a, i) => [a.name, i]));

// Gauge denominators per collection. (The journal coin's face/scoop crops are now
// resolution-independent in CSS — see the --col/--row vars below — so there's no
// pixel tile size to keep in step here.)
const REGULAR_GAUGE_MAX = 50;
const POWERUP_GAUGE_MAX = 100;
// Ring-gauge fill colors per collection (power-ups use their own token color).
const REGULAR_RING = SEMANTIC.go;
export const RECIPE_RING = SEMANTIC.goldDeep;
const CHALLENGE_RING = SEMANTIC.pink;

/**
 * CSS background-position locating a regular's face on the customer sheet: the
 * unlocked Default face, or (unlocked=false) the Empty silhouette column. The
 * single source of truth for the crop math — the coin face and the unlock reveal
 * both call this (at their own tile sizes).
 * @param {string} name @param {boolean} unlocked @param {number} tile px tile size
 */
export function regularFacePos(name, unlocked, tile) {
  const row = REGULAR_ROW_BY_NAME.get(name) || 0;
  const col = unlocked ? REGULAR_FACE_COL : REGULAR_EMPTY_COL;
  return `-${col * tile}px -${row * tile}px`;
}

// === Collection coins (compose the shared coin component in coinTemplate.js) ==

// Per-character face fit. FACE_FILL is the fraction of its sheet cell each head's art
// occupies VERTICALLY (measured from customer_sheet.png). Heads vary wildly here — a
// bald head fills ~0.55, Chris (bald crown + full beard) fills 0.86 — so a single
// element size makes some heads huge and others tiny. We divide TARGET_HEAD_PX by the
// fill so EVERY head lands the same size on the coin. FACE_DY is an optional per-
// character nudge (px). These are the art-direction knobs: LOWER a FACE_FILL to make
// that head render bigger; set a FACE_DY to slide one up (−) or down (+).
const TARGET_HEAD_PX = 70;
const FACE_FILL = {
  Annie: 0.58, Amara: 0.63, Sanjay: 0.65, Gerald: 0.55, Chad: 0.69, Missy: 0.66,
  Karen: 0.78, Axel: 0.67, Reginald: 0.64, Chris: 0.86, Freddie: 0.75,
  'Harvey Green': 0.65, Poop: 0.66
};
/** @type {Record<string, number>} per-character vertical nudge in px (default 0) */
const FACE_DY = {};

/**
 * Regular face cropped from the customer sheet. Emits the sheet cell as --col/--row,
 * a per-character --face-size (normalising every head to TARGET_HEAD_PX tall) and an
 * optional --face-dy nudge; the CSS does the percentage crop + placement.
 */
function regularFaceInner(name, unlocked) {
  const row = REGULAR_ROW_BY_NAME.get(name) || 0;
  const col = unlocked ? REGULAR_FACE_COL : REGULAR_EMPTY_COL;
  const size = Math.round(TARGET_HEAD_PX / (FACE_FILL[name] || 0.64));
  const dy = FACE_DY[name] || 0;
  return `<span class="jcoin-face-img${unlocked ? '' : ' locked'}" style="--col:${col};--row:${row};--face-size:${size}px;--face-dy:${dy}px"></span>`;
}

/** One regular coin's props: face crop, ring = served / REGULAR_GAUGE_MAX. */
function regularCoinProps(r) {
  const pct = r.unlocked ? Math.min(100, (r.served / REGULAR_GAUGE_MAX) * 100) : 0;
  return {
    kind: COIN_KIND.REGULAR, id: r.name,
    inner: regularFaceInner(r.name, r.unlocked),
    ring: REGULAR_RING, pct,
    name: r.unlocked ? r.name : '???',
    locked: !r.unlocked
  };
}

/**
 * One power-up coin's props: token emoji, ring = used / POWERUP_GAUGE_MAX. The
 * caller resolves unlocked/used from challenges (journal.js owns that read) and
 * passes them in, so this stays pure like its sibling mappers.
 * @param {{ type: string, unlocked: boolean, used: number }} item
 */
function powerupCoinProps({ type, unlocked, used }) {
  const pct = unlocked ? Math.min(100, (used / POWERUP_GAUGE_MAX) * 100) : 0;
  return {
    kind: COIN_KIND.POWERUP, id: type,
    inner: `<span class="jcoin-emoji">${PICKUP_ICONS[type]}</span>`,
    ring: PICKUP_RING_COLOR[type], pct,
    name: unlocked ? (PICKUP_NAME[type] || type) : '???',
    locked: !unlocked
  };
}

/** One recipe coin's props: scoops stacked vertically, ring = completions / RECIPE_TARGET. */
function recipeCoinProps(r) {
  const pct = r.locked ? 0 : Math.min(100, (r.count / RECIPE_TARGET) * 100);
  return {
    kind: COIN_KIND.RECIPE, id: r.id,
    inner: coinScoops(r.colors, r.locked, r.size),
    ring: RECIPE_RING, pct,
    name: r.locked ? '???' : r.name,
    locked: r.locked,
    badge: (!r.locked && r.mastered) ? '<span class="jcoin-star">⭐</span>' : ''
  };
}

/**
 * One challenge-set coin's props: a medal that lights up once the whole set is
 * cleared, ring = goals done / total. Locked (no name) until the set completes —
 * tapping it shows the set's challenges (checked off), never crossed out.
 * @param {{ name: string, index: number, status: string, complete: boolean, challenges: Array<{ completed: boolean }> }} set
 */
function challengeCoinProps(set) {
  const total = set.challenges.length;
  const done = set.challenges.filter(c => c.completed).length;
  return {
    kind: COIN_KIND.CHALLENGE, id: String(set.index),
    inner: `<span class="jcoin-emoji">${set.complete ? '🏅' : '🎯'}</span>`,
    ring: CHALLENGE_RING, pct: total ? Math.min(100, (done / total) * 100) : 0,
    name: set.complete ? set.name : '???',
    locked: !set.complete
  };
}

/** kind → the mapper turning one of that collection's items into a coin descriptor. */
const COIN_PROPS = {
  [COIN_KIND.REGULAR]: regularCoinProps,
  [COIN_KIND.POWERUP]: powerupCoinProps,
  [COIN_KIND.RECIPE]: recipeCoinProps,
  [COIN_KIND.CHALLENGE]: challengeCoinProps
};

/**
 * A `jcoin-grid` of one collection's coins. `kind` selects the per-item mapper, so
 * callers pass data + a COIN_KIND — no rendering functions cross the boundary.
 * Each item becomes a tappable coin via coinHtml.
 * @param {'regular'|'powerup'|'recipe'|'challenge'} kind @param {any[]} items @returns {string}
 */
export function coinGrid(kind, items) {
  const props = COIN_PROPS[kind];
  return `<div class="jcoin-grid">${items.map((it, i) => coinHtml({ ...props(it), index: i })).join('')}</div>`;
}

// === Detail popups (tap a coin → the fuller info) =============================

/** @param {{ name: string, unlocked: boolean, served: number, favoriteRecipe: string, blurb: string }} r */
export function regularDetailHtml(r) {
  const visual = coinVisual({
    inner: regularFaceInner(r.name, r.unlocked), ring: REGULAR_RING,
    pct: r.unlocked ? Math.min(100, (r.served / REGULAR_GAUGE_MAX) * 100) : 0
  });
  if (!r.unlocked) {
    return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">Serve them to unlock</div>`;
  }
  let fav = '';
  const recipe = RECIPE_BY_ID.get(r.favoriteRecipe);
  if (recipe) {
    const dots = recipe.colors.map(c => `<span class="recipe-swatch" style="background:${COLORS[c]}"></span>`).join('');
    fav = `<div class="regular-fav"><span class="regular-fav-pre">♥</span>${dots}<span class="regular-fav-name">${recipe.name}</span></div>`;
  }
  return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${r.name}</div>
      ${fav}<div class="jdetail-blurb">${r.blurb}</div>
      <div class="jdetail-line">Served ${r.served} / ${REGULAR_GAUGE_MAX}</div>`;
}

/**
 * @param {string} t power-up type or PICKUP_TYPE.COIN
 * @param {boolean} unlocked @param {number} used  (the caller resolves these from challenges)
 */
export function powerupDetailHtml(t, unlocked, used) {
  const visual = coinVisual({
    inner: `<span class="jcoin-emoji">${PICKUP_ICONS[t]}</span>`, ring: PICKUP_RING_COLOR[t],
    pct: unlocked ? Math.min(100, (used / POWERUP_GAUGE_MAX) * 100) : 0
  });
  if (!unlocked) {
    return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">🔒 Unlock by clearing challenges</div>`;
  }
  return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${PICKUP_NAME[t] || t}</div>
      <div class="jdetail-blurb">${PICKUP_DESC[t] || ''}</div>
      <div class="jdetail-line">Used ${used} / ${POWERUP_GAUGE_MAX}</div>`;
}

/** @param {{ id: string, name: string, colors: string[], size: number, count: number, locked: boolean, mastered: boolean, group: string }} r */
export function recipeDetailHtml(r) {
  const visual = coinVisual({
    inner: coinScoops(r.colors, r.locked, r.size), ring: RECIPE_RING,
    pct: r.locked ? 0 : Math.min(100, (r.count / RECIPE_TARGET) * 100),
    badge: (!r.locked && r.mastered) ? '<span class="jcoin-star">⭐</span>' : ''
  });
  if (r.locked) {
    return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">Serve it once to discover it</div>`;
  }
  const group = GROUP_BY_ID.get(r.group);
  return `<div class="jdetail-coin">${visual}</div><div class="jdetail-name">${r.name}${r.mastered ? ' ⭐' : ''}</div>
      <div class="jdetail-blurb">${group ? group.name : ''}</div>
      <div class="jdetail-line">Completed ${r.count} / ${RECIPE_TARGET}${r.mastered ? ' · Mastered!' : ''}</div>`;
}

/**
 * Challenge-set detail: the set's medal + the goals it needs, completed ones checked
 * (never crossed out). Fully-locked future sets stay hidden behind a teaser so the
 * player isn't spoiled. No "unlocks" line — the reward reveals when the set clears.
 * @param {{ name: string, index: number, status: string, complete: boolean, challenges: any[] }} set
 */
export function challengeSetDetailHtml(set) {
  const total = set.challenges.length;
  const done = set.challenges.filter(c => c.completed).length;
  const visual = coinVisual({
    inner: `<span class="jcoin-emoji">${set.complete ? '🏅' : '🎯'}</span>`,
    ring: CHALLENGE_RING, pct: total ? Math.min(100, (done / total) * 100) : 0
  });
  if (set.status === 'locked') {
    return `<div class="jdetail-coin locked">${visual}</div><div class="jdetail-name">???</div>
        <div class="jdetail-line locked-hint">🔒 Clear Week ${set.index} to reveal these challenges</div>`;
  }
  const rows = set.challenges.map(ch => challengeRow(ch)).join('');
  const title = set.complete ? set.name : `Week ${set.index + 1}: ${set.name}`;
  return `<div class="jdetail-coin${set.complete ? '' : ' locked'}">${visual}</div>
      <div class="jdetail-name">${title}</div>
      <div class="jdetail-challenges">${rows}</div>`;
}
