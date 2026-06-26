// @ts-check
// The journal "coin" component — the shared low-level building block every
// collection (recipes / regulars / power-ups) renders itself as: a gauge ring
// wrapping a face, optionally wrapped in a tappable button, optionally filled
// with a stack of recipe scoops. Pure presentational string builders (no `this`,
// no element access, no game state); collectionTemplate.js / roundOverTemplate.js
// compose these into the higher-level grid coins, detail popups, and unlock reveals.

import { HUD_SCOOP_COL } from '../../sprites/hudScoopRenderer.js';

/**
 * Just the gauge ring + face (no button/name) — reused by the grid + detail popup.
 * Three depth layers: the gauge ring, the cream `.jcoin-face` disc, and a separate
 * un-clipped `.jcoin-pop` content layer that spills out past the rim (CSS sizes it
 * larger than the coin and drop-shadows it) so the contents read as popping out.
 */
export function coinVisual({ inner, ring, pct, badge = '' }) {
  return `<span class="jcoin-gauge" style="--pct:${pct};--ring:${ring}"><span class="jcoin-face"></span><span class="jcoin-pop">${inner}</span>${badge}</span>`;
}

/** A tappable coin: gauge ring + face + name. data-kind/id drive the detail popup. */
export function coinHtml({ kind, id, inner, ring, pct, name, locked, badge = '', index = 0 }) {
  return `<button class="jcoin${locked ? ' locked' : ''}" data-kind="${kind}" data-id="${id}" style="--i:${index}">${coinVisual({ inner, ring, pct, badge })}<span class="jcoin-name">${name}</span></button>`;
}

/**
 * Recipe scoops laid out horizontally inside a coin, the middle one enlarged as the
 * "hero" (grey blanks when locked). The crop is resolution-independent — a `--col`
 * CSS var feeds percentage background math (see styles.css) — so the hero dollop can
 * be sized up freely without per-size pixel tables.
 * @param {string[]} colors @param {boolean} locked @param {number} size
 */
export function coinScoops(colors, locked, size) {
  const cols = locked ? Array.from({ length: size }, () => HUD_SCOOP_COL.empty) : colors.map(c => HUD_SCOOP_COL[c]);
  const n = cols.length;
  const centre = (n - 1) / 2;
  // A separated, carousel-like row: on odd counts the middle dollop is the enlarged,
  // upright "hero" sitting low and in front; the flanks are smaller, gently fanned, and
  // RAISED on the Y axis (the further from centre, the higher) so the row curves like a
  // carousel. Size / tilt / raise are emitted as CSS vars (applied in styles.css).
  const scoops = cols.map((col, i) => {
    const d = i - centre;                                       // signed distance from centre
    const isHero = n % 2 === 1 && d === 0;
    const sz = isHero ? 48 : n === 1 ? 50 : n === 2 ? 40 : 30;  // flanks recede in a trio
    const tilt = Math.round(d * 6);                             // gentle outward fan
    const raise = Math.round(Math.abs(d) * 11);                 // outer dollops sit higher
    return `<span class="jcoin-scoop${isHero ? ' hero' : ''}${locked ? ' empty' : ''}" style="--col:${col};--sz:${sz};--tilt:${tilt};--raise:${raise}"></span>`;
  }).join('');
  return `<span class="jcoin-scoops">${scoops}</span>`;
}
