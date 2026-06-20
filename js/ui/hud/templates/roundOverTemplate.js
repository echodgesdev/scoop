// @ts-check
// Round-over modal card markup: the end-of-round score table, the "Complete the
// Week" meter, and the unlock-reveal flip coins (a committed challenge reward
// mapped to a card, then rendered as a back→front flip). Pure string builders,
// driven by roundOver.js.
//
// The reveals show collection items, so the regular-face crop + recipe ring come
// from collectionTemplate and the recipe scoops from coinTemplate — no redefining.

import { PICKUP_TYPE } from '../../../game/config.js';
import { GROUP_BY_ID } from '../../../game/recipes.js';
import { PICKUP_ICONS, PICKUP_RING_COLOR, PICKUP_NAME } from '../../powerupVisuals.js';
import { coinScoops } from './coinTemplate.js';
import { regularFacePos, RECIPE_RING } from './collectionTemplate.js';

// The unlock-reveal face tile (px) — larger than the journal coin's; matches styles.css.
const REGULAR_FACE_TILE = 120;

/**
 * End-of-round score card as a table (label · value rows). On game over, a Best
 * row is appended and flagged when it's a new record.
 * @param {{ score: number, dayCombo: number, bestCombo: number, favFlavor: string }} stats
 * @param {{ isRecord?: boolean, best?: number }} [extra]
 */
export function scoreTableHtml(stats, extra = {}) {
  const rows = [
    ['Score', stats.score],
    ['Combo Today', `${stats.dayCombo}×`],
    ['Longest Combo', `${stats.bestCombo}×`],
    ['Favorite', stats.favFlavor]
  ];
  if (extra.best != null) rows.push(['Best', extra.isRecord ? '🏆 NEW BEST!' : extra.best]);
  const body = rows.map(([label, value]) =>
    `<div class="ro-score-row"><span class="ro-score-label">${label}</span><span class="ro-score-value">${value}</span></div>`).join('');
  return `<div class="ro-score-table">${body}</div>`;
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
    const back  = regularFacePos(item.name || '', false, REGULAR_FACE_TILE);  // silhouette
    const front = regularFacePos(item.name || '', true, REGULAR_FACE_TILE);   // full face
    return `<div class="wt-reveal-item">
        <div class="wt-reveal-coin"><div class="wt-reveal-inner">
          <div class="wt-reveal-face wt-reveal-back" style="background-position:${back}"></div>
          <div class="wt-reveal-face wt-reveal-front" style="background-position:${front}"></div>
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
