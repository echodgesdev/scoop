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
    case 'complete_week':     return '📅';
    default:                  return '•';
  }
}

/**
 * @param {{ id: string, type: string, param?: string, title: string, progress: number, target: number, completed: boolean }} ch
 * @param {string} [extra] extra row classes (e.g. 'earned-pending', 'challenge-secondary', 'revealing')
 */
export function challengeRow(ch, extra = '') {
  const pct = Math.round(Math.min(100, (ch.progress / ch.target) * 100));
  const cls = ['challenge-row'];
  if (ch.completed) cls.push('completed');
  if (extra) cls.push(extra);
  const icon = challengeIcon(ch);
  // Progress reads as a percentage (no bar) — completed rows show a check instead.
  return `<div class="${cls.join(' ')}">
      <span class="challenge-icon">${icon}</span>
      <div class="challenge-body">
        <div class="challenge-title">${ch.title}</div>
      </div>
      <div class="challenge-count">${ch.completed ? '✓' : `${pct}%`}</div>
    </div>`;
}

/**
 * The current set's challenge rows: the primary tier always, plus the secondary
 * tier ("Complete the Week") once primary is complete. The single renderer shared
 * by the round-over modal, the night sky, and the pause menu.
 * @param {{ primary: any[], secondary: any[], primaryComplete: boolean } | null} set
 * @param {{ earnedIds?: Set<string>|null }} [opts] earnedIds → mark those rows for the cross-off
 * @returns {string}
 */
export function challengeListHtml(set, { earnedIds = null } = {}) {
  if (!set) return '';
  const rowExtra = (ch, base) => {
    const cls = base ? [base] : [];
    if (earnedIds && earnedIds.has(ch.id) && !ch.completed) cls.push('earned-pending');
    return cls.join(' ');
  };
  const rows = set.primary.map(ch => challengeRow(ch, rowExtra(ch, '')));
  if (set.primaryComplete) {
    for (const ch of set.secondary) rows.push(challengeRow(ch, rowExtra(ch, 'challenge-secondary')));
  }
  return rows.join('');
}
