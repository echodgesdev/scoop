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

/**
 * The journal's coin kinds. Doubles as the `data-kind` on each coin button (which
 * drives the tap-a-coin detail popup) and the key selecting the per-kind mapper in
 * coinGrid below.
 * @type {Readonly<{ REGULAR: 'regular', POWERUP: 'powerup', RECIPE: 'recipe' }>}
 */
export const COIN_KIND = Object.freeze({ REGULAR: 'regular', POWERUP: 'powerup', RECIPE: 'recipe' });

// Regulars: faces are cropped from the shared sprite sheet via CSS background-
// position — the row is the regular's sheet row (animation index), the column the
// expression. Tile sizes mirror styles.css; keep them in step.
const REGULAR_FACE_COL = 1;          // column 1 = Default face — shown unlocked
const REGULAR_EMPTY_COL = 0;         // column 0 = Empty white "shadow" — shown locked (CSS greys it)
/** @type {Map<string, number>} regular name → sprite-sheet row (animation index) */
const REGULAR_ROW_BY_NAME = new Map(CUSTOMER_SPRITE.animations.map((a, i) => [a.name, i]));

// Journal-coin tile size (a regular face crop sized to the coin) and the gauge
// denominators per collection. (The recipe-scoop tile lives in coinTemplate.js.)
const JCOIN_FACE_TILE = 70;
const REGULAR_GAUGE_MAX = 50;
const POWERUP_GAUGE_MAX = 100;
// Ring-gauge fill colors per collection (power-ups use their own token color).
const REGULAR_RING = '#06d6a0';
export const RECIPE_RING = '#ffb703';

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

/** Regular face cropped from the customer sheet, sized to the coin. */
function regularFaceInner(name, unlocked) {
  return `<span class="jcoin-face-img${unlocked ? '' : ' locked'}" style="background-position:${regularFacePos(name, unlocked, JCOIN_FACE_TILE)}"></span>`;
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

/** kind → the mapper turning one of that collection's items into a coin descriptor. */
const COIN_PROPS = {
  [COIN_KIND.REGULAR]: regularCoinProps,
  [COIN_KIND.POWERUP]: powerupCoinProps,
  [COIN_KIND.RECIPE]: recipeCoinProps
};

/**
 * A `jcoin-grid` of one collection's coins. `kind` selects the per-item mapper, so
 * callers pass data + a COIN_KIND — no rendering functions cross the boundary.
 * Each item becomes a tappable coin via coinHtml.
 * @param {'regular'|'powerup'|'recipe'} kind @param {any[]} items @returns {string}
 */
export function coinGrid(kind, items) {
  const props = COIN_PROPS[kind];
  return `<div class="jcoin-grid">${items.map(it => coinHtml(props(it))).join('')}</div>`;
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
