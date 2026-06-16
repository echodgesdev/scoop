// @ts-check
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./recipes.js').Recipes} Recipes */

const STORAGE_KEY = 'scoop.challenges';

// === Master challenge sets ===================================================
// Each set is 3 challenges. Completing all 3 unlocks the set's reward IMMEDIATELY
// (mid-run) — a tip token or a "regular" customer — but the NEXT set's challenges
// stay hidden until the current run ends (see commitEarned / advanceSet), so the
// player can clear at most one set per life. Crucially, a set's goals only ever
// require features unlocked by EARLIER sets (a set never asks you to use the
// power-up it itself unlocks). Unlock ladder:
//   1 Coin · 2 Rainbow · 3 Freddie · 4 Heart · 5 Harvey Green · 6 Freeze ·
//   7 Karen · 8 Speed · 9 Poop · 10 — (bragging rights; final cutscene TBD).
// Recipe sections are NOT challenge rewards anymore — they unlock by day (see
// recipes.js WAVE_GROUPS); the random regulars unlock via in-game encounters.

/**
 * @typedef {object} Challenge
 * @property {string} id            stable id for persistence
 * @property {string} title         displayed text
 * @property {'discover_recipes'|'master_recipes'|'complete_section'|'serve_customers'|'serve_regular'|'use_powerup_wave'|'use_powerup_type'|'use_powerup_total'|'combo_reach'|'wave_reach'} type
 * @property {number} target        number to reach (where applicable)
 * @property {string} [param]       e.g. pickup type, regular name, or section id
 */

/**
 * @typedef {object} Reward
 * @property {'unlock_powerup'|'unlock_coin'|'unlock_regular'} type
 * @property {string} value         powerup type name, 'coin', or a regular's name
 */

/**
 * @typedef {object} ChallengeSet
 * @property {string} name
 * @property {Challenge[]} challenges
 * @property {Reward[]} rewards
 */

/** @type {ChallengeSet[]} */
export const SETS = [
  // Set 1 — the tutorial set: its three goals are guaranteed by finishing Day 0
  // (serve one of each junior flavor). Clearing it unlocks Coin tips.
  {
    name: 'Getting Started',
    challenges: [
      { id: 's1-1', type: 'discover_recipes', target: 5, title: 'Discover 5 flavors' },
      { id: 's1-2', type: 'serve_customers',  target: 5, title: 'Serve 5 customers' },
      { id: 's1-3', type: 'wave_reach',       target: 1, title: 'Reach Day 1' }
    ],
    rewards: [{ type: 'unlock_coin', value: 'coin' }]
  },
  // Set 2 → Rainbow. (Goals: only Coin available, so no power-up-use goal yet.)
  {
    name: 'Taste the Rainbow',
    challenges: [
      { id: 's2-1', type: 'serve_customers',  target: 15, title: 'Serve 15 customers total' },
      { id: 's2-2', type: 'combo_reach',      target: 4,  title: 'Reach a 4× combo' },
      { id: 's2-3', type: 'discover_recipes', target: 8,  title: 'Discover 8 recipes total' }
    ],
    rewards: [{ type: 'unlock_powerup', value: 'rainbow' }]
  },
  // Set 3 → Freddie (character). Rainbow is now available to use.
  {
    name: 'Making Regulars',
    challenges: [
      { id: 's3-1', type: 'use_powerup_type', target: 2,  title: 'Use 2 🌈 Rainbow power-ups', param: 'rainbow' },
      { id: 's3-2', type: 'discover_recipes', target: 12, title: 'Discover 12 recipes total' },
      { id: 's3-3', type: 'wave_reach',       target: 3,  title: 'Reach Day 3' }
    ],
    rewards: [{ type: 'unlock_regular', value: 'Freddie' }]
  },
  // Set 4 → Heart.
  {
    name: 'Heart on the Line',
    challenges: [
      { id: 's4-1', type: 'combo_reach',      target: 5,  title: 'Reach a 5× combo' },
      { id: 's4-2', type: 'serve_customers',  target: 30, title: 'Serve 30 customers total' },
      { id: 's4-3', type: 'master_recipes',   target: 2,  title: 'Master 2 recipes (10/10)' }
    ],
    rewards: [{ type: 'unlock_powerup', value: 'heart' }]
  },
  // Set 5 → Harvey Green (character). Heart now available to use.
  {
    name: 'Local Legend',
    challenges: [
      { id: 's5-1', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❤️ Heart power-ups', param: 'heart' },
      { id: 's5-2', type: 'discover_recipes', target: 18, title: 'Discover 18 recipes total' },
      { id: 's5-3', type: 'wave_reach',       target: 4,  title: 'Reach Day 4' }
    ],
    rewards: [{ type: 'unlock_regular', value: 'Harvey Green' }]
  },
  // Set 6 → Freeze (Ice).
  {
    name: 'Brain Freeze',
    challenges: [
      { id: 's6-1', type: 'combo_reach',      target: 6,  title: 'Reach a 6× combo' },
      { id: 's6-2', type: 'master_recipes',   target: 4,  title: 'Master 4 recipes total' },
      { id: 's6-3', type: 'serve_customers',  target: 50, title: 'Serve 50 customers total' }
    ],
    rewards: [{ type: 'unlock_powerup', value: 'pause' }]
  },
  // Set 7 → Karen (character). Freeze now available to use.
  {
    name: 'Speak to the Manager',
    challenges: [
      { id: 's7-1', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❄️ Freeze power-ups', param: 'pause' },
      { id: 's7-2', type: 'discover_recipes', target: 25, title: 'Discover 25 recipes total' },
      { id: 's7-3', type: 'wave_reach',       target: 5,  title: 'Reach Day 5' }
    ],
    rewards: [{ type: 'unlock_regular', value: 'Karen' }]
  },
  // Set 8 → Speed (Feather).
  {
    name: 'Quickstep',
    challenges: [
      { id: 's8-1', type: 'combo_reach',      target: 7,  title: 'Reach a 7× combo (max!)' },
      { id: 's8-2', type: 'serve_regular',    target: 15, title: 'Serve Gerald 15 times', param: 'Gerald' },
      { id: 's8-3', type: 'master_recipes',   target: 6,  title: 'Master 6 recipes total' }
    ],
    rewards: [{ type: 'unlock_powerup', value: 'feather' }]
  },
  // Set 9 → Poop (character). Speed now available to use.
  {
    name: 'The Whole Crew',
    challenges: [
      { id: 's9-1', type: 'use_powerup_type', target: 5,  title: 'Use 5 ⚡ Speed power-ups', param: 'feather' },
      { id: 's9-2', type: 'wave_reach',       target: 7,  title: 'Reach Day 7' },
      { id: 's9-3', type: 'discover_recipes', target: 35, title: 'Discover every recipe (35)' }
    ],
    rewards: [{ type: 'unlock_regular', value: 'Poop' }]
  },
  // Set 10 — bragging rights. No feature reward yet (a final cutscene is TBD).
  {
    name: 'Top Scooper',
    challenges: [
      { id: 's10-1', type: 'master_recipes',   target: 12, title: 'Master 12 recipes total' },
      { id: 's10-2', type: 'use_powerup_wave', target: 10, title: 'Use 10 power-ups in one day' },
      { id: 's10-3', type: 'serve_regular',    target: 25, title: 'Serve Annie 25 times', param: 'Annie' }
    ],
    rewards: []
  }
];

const ALL_POWERUP_IDS = ['heart', 'feather', 'pause', 'rainbow'];

/**
 * Tracks challenge progress and unlock state. Persists across sessions.
 * One canonical instance owned by Game.
 */
export class Challenges {
  /** @param {Recipes} recipes @param {import('./regulars.js').Regulars} [regulars] */
  constructor(recipes, regulars) {
    this.recipes = recipes;
    this.regulars = regulars;
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
      /** @type {Record<number, boolean>} sets whose rewards have been granted (so they fire once) */
      rewardsClaimed: {},
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
        /** @type {boolean} coin tips (Set 1 reward) */
        coin: false
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
              coin: parsed.unlocks?.coin === true
            },
            completed: { ...(parsed.completed || {}) },
            rewardsClaimed: { ...(parsed.rewardsClaimed || {}) }
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

  /** Coin tips unlock from Set 1 (the tutorial); gated like the power-ups. */
  isCoinUnlocked() { return this.state.unlocks.coin === true; }

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
      case 'serve_regular':    return this.regulars ? this.regulars.servedCount(/** @type {string} */ (ch.param)) : 0;
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

  /** Is every challenge in the current set complete? */
  isCurrentSetComplete() {
    const set = SETS[this.state.currentSet];
    return !!set && set.challenges.every(c => this.state.completed[c.id]);
  }

  /**
   * Mark any earned challenges in the current set as completed and, the moment
   * the set first becomes fully complete, GRANT its rewards (once). Does NOT
   * advance to the next set — that waits for game-over (advanceSet), so a player
   * clears at most one set per life. Called at day-end and game-over.
   * @returns {{ committed: string[], rewards: Reward[], setComplete: boolean }}
   */
  commitEarned() {
    const idx = this.state.currentSet;
    const set = SETS[idx];
    /** @type {string[]} */
    const committed = [];
    /** @type {Reward[]} */
    const rewards = [];

    if (set) {
      for (const ch of set.challenges) {
        if (this.state.completed[ch.id]) continue;
        if (this._getProgress(ch) >= ch.target) {
          this.state.completed[ch.id] = true;
          committed.push(ch.id);
        }
      }
      // Grant rewards exactly once, the first time the set is fully complete.
      if (this.isCurrentSetComplete() && !this.state.rewardsClaimed[idx]) {
        this.state.rewardsClaimed[idx] = true;
        for (const r of set.rewards) { this._applyReward(r); rewards.push(r); }
      }
    }

    this._notifiedEarned = {};
    this._save();
    return { committed, rewards, setComplete: this.isCurrentSetComplete() };
  }

  /**
   * Reveal the next set — called only at game-over, so finishing a set's goals
   * mid-run doesn't surface the next set until this life ends. @returns {boolean} advanced
   */
  advanceSet() {
    const idx = this.state.currentSet;
    if (this.isCurrentSetComplete() && idx < SETS.length - 1) {
      this.state.currentSet = idx + 1;
      this._save();
      return true;
    }
    return false;
  }

  /** @param {Reward} r */
  _applyReward(r) {
    if (r.type === 'unlock_powerup') this.state.unlocks.powerups[r.value] = true;
    else if (r.type === 'unlock_coin') this.state.unlocks.coin = true;
    else if (r.type === 'unlock_regular' && this.regulars) this.regulars.unlock(r.value);
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
