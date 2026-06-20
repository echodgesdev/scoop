// @ts-check
// The journal "coin" component — the shared low-level building block every
// collection (recipes / regulars / power-ups) renders itself as: a gauge ring
// wrapping a face, optionally wrapped in a tappable button, optionally filled
// with a stack of recipe scoops. Pure presentational string builders (no `this`,
// no element access, no game state); collectionTemplate.js / waveTransitionTemplate.js
// compose these into the higher-level grid coins, detail popups, and unlock reveals.

import { HUD_SCOOP_COL } from '../../sprites/hudScoopRenderer.js';

// A recipe-scoop tile stacked inside a coin (px); mirrors styles.css — keep in step.
const JCOIN_SCOOP_TILE = 20;

/** Just the gauge ring + face (no button/name) — reused by the grid + detail popup. */
export function coinVisual({ inner, ring, pct, badge = '' }) {
  return `<span class="jcoin-gauge" style="--pct:${pct};--ring:${ring}"><span class="jcoin-face">${inner}</span>${badge}</span>`;
}

/** A tappable coin: gauge ring + face + name. data-kind/id drive the detail popup. */
export function coinHtml({ kind, id, inner, ring, pct, name, locked, badge = '' }) {
  return `<button class="jcoin${locked ? ' locked' : ''}" data-kind="${kind}" data-id="${id}">${coinVisual({ inner, ring, pct, badge })}<span class="jcoin-name">${name}</span></button>`;
}

/**
 * Recipe scoops stacked vertically inside a coin (grey blanks when locked).
 * @param {string[]} colors @param {boolean} locked @param {number} size
 */
export function coinScoops(colors, locked, size) {
  const T = JCOIN_SCOOP_TILE;
  const cols = locked ? Array.from({ length: size }, () => HUD_SCOOP_COL.empty) : colors.map(c => HUD_SCOOP_COL[c]);
  const scoops = cols.map(col => `<span class="jcoin-scoop${locked ? ' empty' : ''}" style="background-position:-${col * T}px 0"></span>`).join('');
  return `<span class="jcoin-scoops">${scoops}</span>`;
}
