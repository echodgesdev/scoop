// @ts-check
// Challenge presentation: a single challenge row (icon + title + progress bar +
// count), the per-challenge-type icon, and the short reward label shown in a
// set's "Unlocks: …" summary. Pure string builders — used by the Journal's
// Challenges tab, the wave-transition recap, and the game-over card.

import { GROUP_BY_ID } from '../../../game/recipes.js';

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
