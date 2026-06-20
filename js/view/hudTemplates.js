// @ts-check
// Pure presentational builders for the HUD's DOM — every function here takes data
// and returns an HTML string (no `this`, no element access, no game state). The
// Hud class owns the stateful coordination (which element, when) and calls these
// to render. Keeping the string-building here is what lets hud.js read as a
// coordinator instead of a 1300-line god-file.

import { COLORS, PICKUP_TYPE } from '../game/config.js';
import { RECIPE_TARGET, RECIPE_BY_ID, GROUP_BY_ID } from '../game/recipes.js';
import CUSTOMER_SPRITE from './sprites/customerSprite.js';
import { HUD_SCOOP_COL } from './sprites/hudScoopSprite.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR, PICKUP_NAME, PICKUP_DESC } from './powerupVisuals.js';

// Regulars: faces are cropped from the shared sprite sheet via CSS background-
// position — the row is the regular's sheet row (animation index), the column the
// expression. Tile sizes mirror styles.css; keep them in step.
const REGULAR_FACE_TILE = 120;       // collection-grid face tile (px); matches styles.css
const REGULAR_FACE_COL = 1;          // column 1 = Default face — shown unlocked
const REGULAR_EMPTY_COL = 0;         // column 0 = Empty white "shadow" — shown locked (CSS greys it)
/** @type {Map<string, number>} regular name → sprite-sheet row (animation index) */
const REGULAR_ROW_BY_NAME = new Map(CUSTOMER_SPRITE.animations.map((a, i) => [a.name, i]));

// Journal-coin tile sizes (a scoop tile stacked inside the recipe coin; a regular
// face crop sized to the coin) and the gauge denominators per collection.
const JCOIN_SCOOP_TILE = 20;
const JCOIN_FACE_TILE = 70;
export const REGULAR_GAUGE_MAX = 50;
export const POWERUP_GAUGE_MAX = 100;
// Ring-gauge fill colors per collection (power-ups use their own token color).
export const REGULAR_RING = '#06d6a0';
const RECIPE_RING = '#ffb703';

// === Journal coin component (shared by recipes / regulars / power-ups) ========

/** Just the gauge ring + face (no button/name) — reused by the grid + detail popup. */
function coinVisual({ inner, ring, pct, badge = '' }) {
  return `<span class="jcoin-gauge" style="--pct:${pct};--ring:${ring}"><span class="jcoin-face">${inner}</span>${badge}</span>`;
}

/** A tappable coin: gauge ring + face + name. data-kind/id drive the detail popup. */
export function coinHtml({ kind, id, inner, ring, pct, name, locked, badge = '' }) {
  return `<button class="jcoin${locked ? ' locked' : ''}" data-kind="${kind}" data-id="${id}">${coinVisual({ inner, ring, pct, badge })}<span class="jcoin-name">${name}</span></button>`;
}

/** Regular face cropped from the customer sheet, sized to the coin. */
export function regularFaceInner(name, unlocked) {
  const T = JCOIN_FACE_TILE;
  const row = REGULAR_ROW_BY_NAME.get(name) || 0;
  const col = unlocked ? REGULAR_FACE_COL : REGULAR_EMPTY_COL;
  return `<span class="jcoin-face-img${unlocked ? '' : ' locked'}" style="background-position:-${col * T}px -${row * T}px"></span>`;
}

/**
 * Recipe scoops stacked vertically inside a coin (grey blanks when locked).
 * @param {string[]} colors @param {boolean} locked @param {number} size
 */
function coinScoops(colors, locked, size) {
  const T = JCOIN_SCOOP_TILE;
  const cols = locked ? Array.from({ length: size }, () => HUD_SCOOP_COL.empty) : colors.map(c => HUD_SCOOP_COL[c]);
  const scoops = cols.map(col => `<span class="jcoin-scoop${locked ? ' empty' : ''}" style="background-position:-${col * T}px 0"></span>`).join('');
  return `<span class="jcoin-scoops">${scoops}</span>`;
}

/** One recipe coin: scoops stacked vertically, ring = completions / RECIPE_TARGET. */
export function recipeCoin(r) {
  const pct = r.locked ? 0 : Math.min(100, (r.count / RECIPE_TARGET) * 100);
  return coinHtml({
    kind: 'recipe', id: r.id,
    inner: coinScoops(r.colors, r.locked, r.size),
    ring: RECIPE_RING, pct,
    name: r.locked ? '???' : r.name,
    locked: r.locked,
    badge: (!r.locked && r.mastered) ? '<span class="jcoin-star">⭐</span>' : ''
  });
}

// === Challenge rows ===========================================================

/** @param {{ type: string, value: string }} r */
export function rewardLabel(r) {
  if (r.type === 'unlock_powerup') {
    const names = { heart: '❤️ Heart', feather: '⚡ Speed', pause: '❄️ Freeze', rainbow: '🌈 Rainbow' };
    return names[r.value] || r.value;
  }
  if (r.type === 'unlock_coin') return '🪙 Coin tips';
  if (r.type === 'unlock_regular') return `😀 ${r.value}`;
  if (r.type === 'unlock_section') {
    const g = GROUP_BY_ID.get(r.value);
    return g ? `${g.emoji} ${g.name}` : r.value;
  }
  return r.value;
}

/** @param {{ type: string, param?: string }} ch */
function challengeIcon(ch) {
  if (ch.type === 'use_powerup_type') {
    switch (ch.param) {
      case 'heart':   return '❤️';
      case 'feather': return '⚡';
      case 'pause':   return '❄️';
      case 'rainbow': return '🌈';
    }
  }
  switch (ch.type) {
    case 'discover_recipes':  return '📖';
    case 'master_recipes':    return '⭐';
    case 'complete_section':  return '📚';
    case 'serve_customers':   return '🍦';
    case 'serve_regular':     return '😀';
    case 'use_powerup_wave':
    case 'use_powerup_total': return '⚡';
    case 'combo_reach':       return '🔥';
    case 'wave_reach':        return '🌊';
    default:                  return '•';
  }
}

/** @param {{ id: string, type: string, param?: string, title: string, progress: number, target: number, completed: boolean }} ch */
export function challengeRow(ch) {
  const pct = Math.min(100, (ch.progress / ch.target) * 100);
  const cls = ch.completed ? 'challenge-row completed' : 'challenge-row';
  const icon = challengeIcon(ch);
  return `<div class="${cls}">
      <span class="challenge-icon">${icon}</span>
      <div class="challenge-body">
        <div class="challenge-title">${ch.title}</div>
        <div class="challenge-progress">
          <div class="challenge-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="challenge-count">${ch.completed ? '✓' : `${ch.progress}/${ch.target}`}</div>
    </div>`;
}

// === Journal detail popup (tap a coin → the fuller info) ======================

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

// === Wave-transition cards ====================================================

/** End-of-day stat card: score, the day's best combo, the run's longest combo, favorite flavor. */
export function wtStatsHtml(s) {
  const cell = (label, value) =>
    `<div class="wt-stat"><div class="wt-stat-value">${value}</div><div class="wt-stat-label">${label}</div></div>`;
  return cell('Score', s.score)
    + cell('Combo Today', `${s.dayCombo}×`)
    + cell('Longest Combo', `${s.bestCombo}×`)
    + cell('Favorite', s.favFlavor);
}

/**
 * The "Complete the Week" meter, styled as a challenge row (icon + title +
 * progress bar + count) so it reads consistently with the challenges above it.
 */
export function weekMeterHtml(wp) {
  const pct = Math.min(100, (wp.days / wp.target) * 100);
  return `<div class="challenge-row">
      <span class="challenge-icon">📅</span>
      <div class="challenge-body">
        <div class="challenge-title">Complete the Week</div>
        <div class="challenge-progress">
          <div class="challenge-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="challenge-count">${wp.days}/${wp.target}</div>
    </div>`;
}

/**
 * Map a committed challenge Reward to an unlock-reveal card descriptor, or null
 * for reward types that don't get a coin (none today). Power-ups / coin / sections
 * flip an emoji coin; a regular flips their silhouette → face.
 * @param {{ type: string, value: string }} r
 * @returns {{ kind: string, name?: string, emoji?: string, ring?: string, label?: string } | null}
 */
export function rewardToCard(r) {
  if (r.type === 'unlock_regular') return { kind: 'regular', name: r.value };
  if (r.type === 'unlock_coin') {
    return { kind: 'coin', emoji: PICKUP_ICONS[PICKUP_TYPE.COIN], ring: PICKUP_RING_COLOR[PICKUP_TYPE.COIN], label: 'Coin Tips Unlocked!' };
  }
  if (r.type === 'unlock_powerup') {
    return {
      kind: 'powerup',
      emoji: PICKUP_ICONS[r.value] || '⚡',
      ring: PICKUP_RING_COLOR[r.value] || '#ffd166',
      label: `New Power-up — ${PICKUP_NAME[r.value] || r.value}!`
    };
  }
  if (r.type === 'unlock_section') {
    const g = GROUP_BY_ID.get(r.value);
    return { kind: 'section', emoji: g ? g.emoji : '🍨', ring: '#ffd166', label: `New Recipes — ${g ? g.name : r.value}!` };
  }
  return null;
}

/**
 * Markup for one unlock coin. A 'regular' card crops silhouette/face from the
 * customer sheet (back → front); the emoji kinds (coin/power-up/section) show a
 * "?" coin that flips to the unlocked thing's emoji; a 'recipe' card flips to its
 * scoops. Fresh markup each call so the CSS flip replays.
 * @param {{ kind: string, name?: string, emoji?: string, ring?: string, label?: string, colors?: string[] }} item
 */
export function unlockCardHtml(item) {
  if (item.kind === 'regular') {
    const T = REGULAR_FACE_TILE;
    const row = REGULAR_ROW_BY_NAME.get(item.name || '') || 0;
    const back  = `background-position:-${REGULAR_EMPTY_COL * T}px -${row * T}px`;  // silhouette
    const front = `background-position:-${REGULAR_FACE_COL * T}px -${row * T}px`;   // full face
    return `<div class="wt-reveal-item">
        <div class="wt-reveal-coin"><div class="wt-reveal-inner">
          <div class="wt-reveal-face wt-reveal-back" style="${back}"></div>
          <div class="wt-reveal-face wt-reveal-front" style="${front}"></div>
        </div></div>
        <div class="wt-reveal-label">New Regular — <b>${item.name}</b>!</div>
      </div>`;
  }
  if (item.kind === 'recipe') {
    // A "?" coin that flips to the recipe's scoops stacked vertically.
    const scoops = coinScoops(item.colors || [], false, (item.colors || []).length);
    return `<div class="wt-reveal-item">
        <div class="wt-reveal-coin"><div class="wt-reveal-inner">
          <div class="wt-reveal-face wt-reveal-back wt-reveal-emoji" style="--ring:${RECIPE_RING}">?</div>
          <div class="wt-reveal-face wt-reveal-front wt-reveal-scoops" style="--ring:${RECIPE_RING}">${scoops}</div>
        </div></div>
        <div class="wt-reveal-label">New Flavor — <b>${item.name}</b>!</div>
      </div>`;
  }
  const ring = item.ring || '#ffd166';
  return `<div class="wt-reveal-item">
      <div class="wt-reveal-coin"><div class="wt-reveal-inner">
        <div class="wt-reveal-face wt-reveal-back wt-reveal-emoji" style="--ring:${ring}">?</div>
        <div class="wt-reveal-face wt-reveal-front wt-reveal-emoji" style="--ring:${ring}">${item.emoji || ''}</div>
      </div></div>
      <div class="wt-reveal-label">${item.label || ''}</div>
    </div>`;
}
