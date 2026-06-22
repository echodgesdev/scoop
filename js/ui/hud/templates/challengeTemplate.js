// @ts-check
// Challenge presentation: a single challenge row (icon + title + percentage/check
// count) and the per-challenge-type icon, plus the current-set list builder. Pure
// string builders — used by the night sky, the pause menu, the game-over recap, and
// the Journal's challenge-coin detail popup.

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
 * @param {string} [extra] extra row classes (e.g. 'earned-pending' for the cross-off)
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
 * The current set's challenge rows. Once the set is complete a "finish your run"
 * note follows — the next set unlocks on death, not mid-run. The single renderer
 * shared by the night sky, the pause menu, and the game-over recap.
 * @param {{ challenges: any[], complete: boolean } | null} set
 * @param {{ earnedIds?: Set<string>|null, doneNote?: boolean }} [opts]
 *   earnedIds → mark those rows for the cross-off; doneNote → append the completion note
 * @returns {string}
 */
export function challengeListHtml(set, { earnedIds = null, doneNote = true } = {}) {
  if (!set) return '';
  const rows = set.challenges.map(ch => {
    const extra = (earnedIds && earnedIds.has(ch.id) && !ch.completed) ? 'earned-pending' : '';
    return challengeRow(ch, extra);
  });
  let html = rows.join('');
  if (doneNote && set.complete) {
    html += `<div class="challenge-done-note">🌙 Finish your run to unlock new challenges</div>`;
  }
  return html;
}
