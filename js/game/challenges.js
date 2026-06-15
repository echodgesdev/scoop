// @ts-check
import { GROUPS } from './recipes.js';

/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./recipes.js').Recipes} Recipes */

const STORAGE_KEY = 'scoop.challenges';

// === Master challenge sets ===================================================
// Each set is 3 challenges; completing all 3 advances the player to the next
// set and unlocks the set's rewards. Sets are front-loaded: the early sets
// unlock the four power-ups quickly, then later sets gate recipe sections so
// gameplay variety grows alongside player skill.

/**
 * @typedef {object} Challenge
 * @property {string} id            stable id for persistence
 * @property {string} title         displayed text
 * @property {'discover_recipes'|'master_recipes'|'complete_section'|'serve_customers'|'use_powerup_wave'|'use_powerup_type'|'use_powerup_total'|'combo_reach'|'wave_reach'} type
 * @property {number} target        number to reach (where applicable)
 * @property {string} [param]       e.g. section id or pickup type
 */

/**
 * @typedef {object} Reward
 * @property {'unlock_powerup'|'unlock_section'} type
 * @property {string} value         powerup type name OR section id
 */

/**
 * @typedef {object} ChallengeSet
 * @property {string} name
 * @property {Challenge[]} challenges
 * @property {Reward[]} rewards
 */

/** @type {ChallengeSet[]} */
export const SETS = [
  // Set 1 — foundational, sized to exactly match completing Wave 0 (serve one
  // of each of the 5 junior flavors). All three targets are guaranteed by that
  // playthrough — discover 5 + serve 5 land on the 5th serve, and reaching
  // Wave 1 fires on the Wave 0→1 transition — so finishing the tutorial wave
  // always unlocks the Heart (no fragile combo gate).
  {
    name: 'Getting Started',
    challenges: [
      { id: 's1-discover',  type: 'discover_recipes', target: 5, title: 'Discover 5 flavors' },
      { id: 's1-serve',     type: 'serve_customers',  target: 5, title: 'Serve 5 customers' },
      { id: 's1-wave',      type: 'wave_reach',       target: 1, title: 'Reach Wave 1' }
    ],
    rewards: [
      { type: 'unlock_powerup', value: 'heart' },
      { type: 'unlock_section', value: 'DAILY_DOUBLE' }
    ]
  },
  // Set 2 — introduces the "use a power-up" verb (a power-up fires from a tip
  // or the combo breaker).
  {
    name: 'Heart on the Line',
    challenges: [
      { id: 's2-pop-heart', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❤️ power-ups', param: 'heart' },
      { id: 's2-discover',  type: 'discover_recipes', target: 5,  title: 'Discover 5 recipes total' },
      { id: 's2-combo',     type: 'combo_reach',      target: 5,  title: 'Reach a 5× combo' }
    ],
    rewards: [
      { type: 'unlock_powerup', value: 'feather' },
      { type: 'unlock_section', value: 'YIN_YANG' }
    ]
  },
  // Set 3 — speed unlocked.
  {
    name: 'Quickstep',
    challenges: [
      { id: 's3-pop-speed', type: 'use_powerup_type', target: 5,  title: 'Use 5 ⚡ power-ups', param: 'feather' },
      { id: 's3-discover',  type: 'discover_recipes', target: 8,  title: 'Discover 8 recipes total' },
      { id: 's3-serve',     type: 'serve_customers',  target: 25, title: 'Serve 25 customers total' }
    ],
    rewards: [
      { type: 'unlock_powerup', value: 'pause' },
      { type: 'unlock_section', value: 'ODD_COUPLE' }
    ]
  },
  // Set 4 — star struck unlocked.
  {
    name: 'Star Struck',
    challenges: [
      { id: 's4-pop-pause', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❄️ power-ups', param: 'pause' },
      { id: 's4-pop-wave',  type: 'use_powerup_wave', target: 5,  title: 'Use 5 power-ups in one wave' },
      { id: 's4-combo',     type: 'combo_reach',      target: 10, title: 'Reach a 10× combo' }
    ],
    rewards: [
      { type: 'unlock_powerup', value: 'rainbow' },
      { type: 'unlock_section', value: 'THREES_COMPANY' }
    ]
  },
  // Set 5 — rainbow unlocked. All powerups are now available.
  {
    name: 'Full Spectrum',
    challenges: [
      { id: 's5-pop-rb',    type: 'use_powerup_type', target: 3,  title: 'Use 3 🌈 power-ups', param: 'rainbow' },
      { id: 's5-discover',  type: 'discover_recipes', target: 15, title: 'Discover 15 recipes total' },
      { id: 's5-wave',      type: 'wave_reach',       target: 4,  title: 'Reach wave 4' }
    ],
    rewards: [
      { type: 'unlock_section', value: 'BEST_TWO_OF_THREE' }
    ]
  },
  // Set 6 — recipe-focused. Unlocks the last recipe section (Triple Threat, the
  // three-different group); after this every section is available.
  {
    name: 'Connoisseur',
    challenges: [
      { id: 's6-master',    type: 'master_recipes',   target: 3,  title: 'Master 3 recipes (10/10)' },
      { id: 's6-pop-wave',  type: 'use_powerup_wave', target: 8,  title: 'Use 8 power-ups in one wave' },
      { id: 's6-combo',     type: 'combo_reach',      target: 15, title: 'Reach a 15× combo' }
    ],
    rewards: [
      { type: 'unlock_section', value: 'TRIPLE_THREAT' }
    ]
  },
  // Sets 7–10 — endgame mastery goals. With the recipe pool trimmed to 7 groups,
  // all sections are already unlocked by Set 6, so these are bragging-rights sets
  // with no section reward (a future epic — e.g. regular unlocks or cosmetics —
  // could re-attach rewards here).
  {
    name: 'Volume Dealer',
    challenges: [
      { id: 's7-discover',  type: 'discover_recipes', target: 25, title: 'Discover 25 recipes total' },
      { id: 's7-pop-total', type: 'use_powerup_total',target: 30, title: 'Use 30 power-ups total' },
      { id: 's7-wave',      type: 'wave_reach',       target: 6,  title: 'Reach wave 6' }
    ],
    rewards: []
  },
  // Set 8 — toward mastery.
  {
    name: 'Royal Treatment',
    challenges: [
      { id: 's8-section-js',type: 'complete_section', target: 5,  title: 'Master the Junior Scoop section', param: 'JUNIOR_SCOOP' },
      { id: 's8-combo',     type: 'combo_reach',      target: 20, title: 'Reach a 20× combo' },
      { id: 's8-master',    type: 'master_recipes',   target: 5,  title: 'Master 5 recipes total' }
    ],
    rewards: []
  },
  // Set 9 — deep game. (35 recipes total now, so "discover 35" = the full book.)
  {
    name: 'Sugar Overload',
    challenges: [
      { id: 's9-discover',  type: 'discover_recipes', target: 35, title: 'Discover every recipe (35)' },
      { id: 's9-wave',      type: 'wave_reach',       target: 8,  title: 'Reach wave 8' },
      { id: 's9-master',    type: 'master_recipes',   target: 10, title: 'Master 10 recipes total' }
    ],
    rewards: []
  },
  // Set 10 — apex.
  {
    name: 'Apex',
    challenges: [
      { id: 's10-combo',    type: 'combo_reach',      target: 25, title: 'Reach a 25× combo' },
      { id: 's10-pop-wave', type: 'use_powerup_wave', target: 12, title: 'Use 12 power-ups in one wave' },
      { id: 's10-section',  type: 'complete_section', target: 5,  title: 'Master the Three\'s Company section', param: 'THREES_COMPANY' }
    ],
    rewards: []
  }
];

const ALL_SECTION_IDS = GROUPS.map(g => g.id);
const ALL_POWERUP_IDS = ['heart', 'feather', 'pause', 'rainbow'];

/**
 * Tracks challenge progress and unlock state. Persists across sessions.
 * One canonical instance owned by Game.
 */
export class Challenges {
  /** @param {Recipes} recipes */
  constructor(recipes) {
    this.recipes = recipes;
    this.state = this._load();
    // Per-wave runtime counter for "use X power-ups in one wave" — not
    // persisted; resets on each wave-up event.
    this.powerupsUsedThisWave = 0;
    // Transient: which challenges have already fired their "earned" toast
    // this session. Prevents double-firing when the same event re-checks.
    /** @type {Record<string, boolean>} */
    this._notifiedEarned = {};
    /**
     * Fired when a challenge's requirement is met but not yet committed
     * (so the HUD can show a "✓ <title>" toast at the bottom of the screen).
     * The challenge stays in "earned" status until commitEarned() runs at
     * wave-end or game-over.
     * @type {(challenge: Challenge) => void}
     */
    this.onEarned = () => {};
  }

  _load() {
    const defaults = {
      currentSet: 0,
      /** @type {Record<string, boolean>} */
      completed: {},
      stats: {
        discoveredCount: 0,
        masteredCount: 0,
        customersServed: 0,
        /** @type {Record<PickupTypeName, number>} */
        powerupsUsedByType: { heart: 0, feather: 0, pause: 0, rainbow: 0 },
        powerupsUsedTotal: 0,
        maxCombo: 0,
        // The campaign now opens on Wave 0 (the tutorial wave), so a fresh save
        // starts below Wave 1 — reaching Wave 1 is a real first milestone.
        maxWave: 0
      },
      unlocks: {
        /** @type {Record<string, boolean>} */
        powerups: {},
        /** @type {Record<string, boolean>} — JUNIOR_SCOOP is always implicitly unlocked */
        sections: {}
      }
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Shallow merge with defaults so newly-added fields work for old saves.
          return {
            ...defaults,
            ...parsed,
            stats: { ...defaults.stats, ...(parsed.stats || {}),
              powerupsUsedByType: { ...defaults.stats.powerupsUsedByType, ...((parsed.stats || {}).powerupsUsedByType || {}) }
            },
            unlocks: {
              powerups: { ...(parsed.unlocks?.powerups || {}) },
              sections: { ...(parsed.unlocks?.sections || {}) }
            },
            completed: { ...(parsed.completed || {}) }
          };
        }
      }
    } catch {}
    return defaults;
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
  }

  /** Wipe all challenge progress, unlocks, and counters back to a fresh save. */
  reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.state = this._load();
    this.powerupsUsedThisWave = 0;
    this._notifiedEarned = {};
  }

  // === Unlocks (queried by waves/pickups) ====================================

  /** @param {string} powerupType */
  isPowerupUnlocked(powerupType) {
    return this.state.unlocks.powerups[powerupType] === true;
  }

  /** @returns {PickupTypeName[]} */
  unlockedPowerupTypes() {
    return /** @type {PickupTypeName[]} */ (ALL_POWERUP_IDS.filter(t => this.isPowerupUnlocked(t)));
  }

  /** @param {string} sectionId */
  isSectionUnlocked(sectionId) {
    // Junior Scoop is always available so the player has something to play
    // before completing the first set.
    if (sectionId === 'JUNIOR_SCOOP') return true;
    return this.state.unlocks.sections[sectionId] === true;
  }

  /** @returns {Set<string>} */
  unlockedSectionIds() {
    const set = new Set(['JUNIOR_SCOOP']);
    for (const id of ALL_SECTION_IDS) {
      if (this.state.unlocks.sections[id]) set.add(id);
    }
    return set;
  }

  /**
   * True once the first challenge set (the Wave 0 tutorial goals) has been
   * cleared — i.e. the player has advanced past Set 1. Used to skip the Wave 0
   * tutorial on subsequent runs.
   */
  firstSetCleared() {
    return this.state.currentSet >= 1;
  }

  // === Event recording =======================================================

  /** @param {string} _id */
  recordDiscover(_id) {
    this.state.stats.discoveredCount = this._countDiscovered();
    this._checkCompletions();
    this._save();
  }

  /** @param {string} _id */
  recordMaster(_id) {
    this.state.stats.masteredCount = this._countMastered();
    this._checkCompletions();
    this._save();
  }

  recordCustomerServed() {
    this.state.stats.customersServed += 1;
    this._checkCompletions();
    this._save();
  }

  /**
   * A power-up was used (fired) — from a customer tip or the combo breaker, both
   * routed through Game._firePower (the single call site). Feeds the
   * use_powerup_type / _total / _wave challenges.
   * @param {PickupTypeName} type
   */
  recordPowerupUsed(type) {
    this.state.stats.powerupsUsedByType[type] = (this.state.stats.powerupsUsedByType[type] || 0) + 1;
    this.state.stats.powerupsUsedTotal += 1;
    this.powerupsUsedThisWave += 1;
    this._checkCompletions();
    this._save();
  }

  /** @param {number} combo */
  recordCombo(combo) {
    if (combo > this.state.stats.maxCombo) this.state.stats.maxCombo = combo;
    this._checkCompletions();
    this._save();
  }

  /** @param {number} wave */
  recordWaveReached(wave) {
    if (wave > this.state.stats.maxWave) this.state.stats.maxWave = wave;
    this._checkCompletions();
    this._save();
  }

  /** Called when a wave ends so per-wave counters reset. */
  recordWaveEnded() {
    this.powerupsUsedThisWave = 0;
  }

  /** Reset session-only counters (called on game start). */
  resetSession() {
    this.powerupsUsedThisWave = 0;
  }

  // === Recompute from authoritative state ===================================

  _countDiscovered() {
    return this.recipes.getAll().filter(r => !r.locked).length;
  }
  _countMastered() {
    return this.recipes.getAll().filter(r => r.mastered).length;
  }

  /** Get current progress (0..target) for a challenge. */
  _getProgress(ch) {
    const s = this.state.stats;
    switch (ch.type) {
      case 'discover_recipes': return s.discoveredCount;
      case 'master_recipes':   return s.masteredCount;
      case 'serve_customers':  return s.customersServed;
      case 'use_powerup_total':return s.powerupsUsedTotal;
      case 'use_powerup_type': return s.powerupsUsedByType[/** @type {PickupTypeName} */ (ch.param)] || 0;
      case 'use_powerup_wave': return this.powerupsUsedThisWave;
      case 'combo_reach':      return s.maxCombo;
      case 'wave_reach':       return s.maxWave;
      case 'complete_section': {
        if (!ch.param) return 0;
        return this.recipes.getAll().filter(r => r.group === ch.param && r.mastered).length;
      }
      default: return 0;
    }
  }

  /**
   * Notify the HUD whenever a challenge's requirement is *newly* met. This does
   * NOT advance the current set or set `completed` — that only happens at
   * commitEarned() time (wave-end or game-over). The two-phase model means the
   * player sees a toast as soon as a requirement is hit, but the cross-off
   * animation and set-advancement wait for the natural pause between waves.
   */
  _checkCompletions() {
    const set = SETS[this.state.currentSet];
    if (!set) return;
    for (const ch of set.challenges) {
      if (this.state.completed[ch.id]) continue;
      if (this._notifiedEarned[ch.id]) continue;
      if (this._getProgress(ch) >= ch.target) {
        this._notifiedEarned[ch.id] = true;
        this.onEarned(ch);
      }
    }
  }

  /**
   * Earned-but-not-yet-committed challenges in the current set. Used by
   * the wave-transition overlay to know which rows to physically cross
   * off and by the game-over flow to commit just-met requirements.
   */
  getEarnedNotCommitted() {
    const set = SETS[this.state.currentSet];
    if (!set) return [];
    return set.challenges.filter(ch => !this.state.completed[ch.id] && this._getProgress(ch) >= ch.target);
  }

  /**
   * Finalise any earned challenges in the current set. If all 3 are now
   * completed, apply the set's rewards and advance currentSet. Returns
   * the list of just-committed ids and (when set advanced) the new set
   * descriptor so the HUD can fade in fresh challenges.
   *
   * @returns {{ committed: string[], setAdvanced: boolean, rewards: Reward[], nextSetIndex: number, nextSet: ReturnType<Challenges['getCurrentSet']> }}
   */
  commitEarned() {
    const set = SETS[this.state.currentSet];
    /** @type {string[]} */
    const committed = [];
    /** @type {Reward[]} */
    const rewards = [];
    let setAdvanced = false;

    if (set) {
      for (const ch of set.challenges) {
        if (this.state.completed[ch.id]) continue;
        if (this._getProgress(ch) >= ch.target) {
          this.state.completed[ch.id] = true;
          committed.push(ch.id);
        }
      }
      if (set.challenges.every(c => this.state.completed[c.id])) {
        for (const r of set.rewards) {
          this._applyReward(r);
          rewards.push(r);
        }
        this.state.currentSet += 1;
        setAdvanced = true;
      }
    }

    this._notifiedEarned = {};
    this._save();
    return {
      committed,
      setAdvanced,
      rewards,
      nextSetIndex: this.state.currentSet,
      nextSet: this.getCurrentSet()
    };
  }

  /** @param {Reward} r */
  _applyReward(r) {
    if (r.type === 'unlock_powerup') this.state.unlocks.powerups[r.value] = true;
    else if (r.type === 'unlock_section') this.state.unlocks.sections[r.value] = true;
  }

  // === Read API for HUD =====================================================

  /**
   * The 3 challenges to show on the game-over screen, decorated with live
   * progress + completion flags. Returns null when the player has cleared
   * every set.
   * @returns {{ name: string, index: number, challenges: Array<Challenge & { progress: number, completed: boolean }> } | null}
   */
  getCurrentSet() {
    const set = SETS[this.state.currentSet];
    if (!set) return null;
    return {
      name: set.name,
      index: this.state.currentSet,
      challenges: set.challenges.map(ch => ({
        ...ch,
        progress: Math.min(ch.target, this._getProgress(ch)),
        completed: this.state.completed[ch.id] === true
      }))
    };
  }

  /** Master list for the challenges modal. */
  getAllSets() {
    return SETS.map((set, i) => {
      const status = i < this.state.currentSet
        ? 'completed'
        : (i === this.state.currentSet ? 'current' : 'locked');
      return {
        name: set.name,
        index: i,
        status,
        rewards: set.rewards,
        challenges: set.challenges.map(ch => ({
          ...ch,
          progress: Math.min(ch.target, this._getProgress(ch)),
          completed: this.state.completed[ch.id] === true
        }))
      };
    });
  }
}
