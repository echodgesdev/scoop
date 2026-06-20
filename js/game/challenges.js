// @ts-check
/** @typedef {import('../types.js').PickupTypeName} PickupTypeName */
/** @typedef {import('./recipes.js').Recipes} Recipes */

import { PICKUP_TYPE, PICKUP_TYPES } from './config.js';
import { GROUP } from './recipes.js';
import { CHARACTER_BY_NAME } from './customers.js';

const STORAGE_KEY = 'scoop.challenges';
// Days in a week — the "Complete the Week" secondary challenge's target. Mirrors
// Waves.weekDays; kept here as the challenge target (stable at 7).
const WEEK_DAYS = 7;

// === Master challenge sets ===================================================
// Each set is a "week" split into two TIERS:
//   • primaryChallenges (3) — the week's goals. Completing them grants the
//     primaryChallengeRewards (a tip token / power-up / regular) and REVEALS the
//     secondary tier.
//   • secondaryChallenges — always "Complete the Week" (play through the 7th day).
//     Completing it grants the secondaryChallengeRewards (the recipe SECTION
//     unlocks) and is what gates advancing to the next week's set.
// So a set is fully complete (→ advance) only once primary AND "Complete the Week"
// are both done. A set's goals only ever require features unlocked by EARLIER sets.
// Unlock ladder:
//   1 Coin + Daily Double + Yin&Yang · 2 Rainbow + Odd Couple ·
//   3 Freddie + Three's Company · 4 Heart + Best Two of Three ·
//   5 Harvey Green + Triple Threat · 6 Freeze · 7 Karen · 8 Speed · 9 Poop ·
//   10 — (bragging rights; final cutscene TBD).
// Recipe SECTIONS are secondary rewards (Sets 1–5 dole out the six non-tutorial
// sections; Junior Scoop is always unlocked). recipesForWave still intersects with
// the day-pool, so a section appears once it's BOTH unlocked AND wave-reached.

/**
 * @typedef {object} Challenge
 * @property {string} id            stable id for persistence
 * @property {string} title         displayed text
 * @property {'discover_recipes'|'master_recipes'|'complete_section'|'serve_customers'|'serve_regular'|'use_powerup_wave'|'use_powerup_type'|'use_powerup_total'|'combo_reach'|'wave_reach'|'complete_week'} type
 * @property {number} target        number to reach (where applicable)
 * @property {string} [param]       e.g. pickup type, regular name, or section id
 */

/**
 * @typedef {object} Reward
 * @property {'unlock_powerup'|'unlock_coin'|'unlock_regular'|'unlock_section'} type
 * @property {string} value  powerup type name, 'coin', a regular's name, or a recipe-section (group) id
 */

/**
 * @typedef {object} ChallengeSet
 * @property {string} name
 * @property {Challenge[]} primaryChallenges
 * @property {Challenge[]} secondaryChallenges
 * @property {Reward[]} primaryChallengeRewards
 * @property {Reward[]} secondaryChallengeRewards
 */

/**
 * The "Complete the Week" secondary, shared shape across every set.
 * @param {number} n set number (1-based) @returns {Challenge}
 */
const weekGoal = (n) => ({ id: `s${n}-week`, type: 'complete_week', target: WEEK_DAYS, title: 'Complete the Week' });

/** @type {ChallengeSet[]} */
const SETS = [
  // Set 1 — the tutorial set: its three goals are guaranteed by finishing the
  // 3-customer Day-0 tutorial. Primary clears Coin tips; finishing the week unlocks
  // the first two recipe sections (Daily Double + Yin & Yang).
  {
    name: 'Getting Started',
    primaryChallenges: [
      { id: 's1-1', type: 'discover_recipes', target: 3, title: 'Discover 3 flavors' },
      { id: 's1-2', type: 'serve_customers',  target: 3, title: 'Serve 3 customers' },
      { id: 's1-3', type: 'wave_reach',       target: 1, title: 'Reach Day 1' }
    ],
    secondaryChallenges: [weekGoal(1)],
    primaryChallengeRewards: [
      { type: 'unlock_coin', value: PICKUP_TYPE.COIN }
    ],
    secondaryChallengeRewards: [
      { type: 'unlock_section', value: GROUP.DAILY_DOUBLE },
      { type: 'unlock_section', value: GROUP.YIN_YANG }
    ]
  },
  // Set 2 → Rainbow + Odd Couple.
  {
    name: 'Taste the Rainbow',
    primaryChallenges: [
      { id: 's2-1', type: 'serve_customers',  target: 15, title: 'Serve 15 customers total' },
      { id: 's2-2', type: 'combo_reach',      target: 4,  title: 'Reach a 4× combo' },
      { id: 's2-3', type: 'discover_recipes', target: 8,  title: 'Discover 8 recipes total' }
    ],
    secondaryChallenges: [weekGoal(2)],
    primaryChallengeRewards: [{ type: 'unlock_powerup', value: PICKUP_TYPE.RAINBOW }],
    secondaryChallengeRewards: [{ type: 'unlock_section', value: GROUP.ODD_COUPLE }]
  },
  // Set 3 → Freddie (character) + Three's Company. Rainbow is now available.
  {
    name: 'Making Regulars',
    primaryChallenges: [
      { id: 's3-1', type: 'use_powerup_type', target: 2,  title: 'Use 2 🌈 Rainbow power-ups', param: PICKUP_TYPE.RAINBOW },
      { id: 's3-2', type: 'discover_recipes', target: 12, title: 'Discover 12 recipes total' },
      { id: 's3-3', type: 'wave_reach',       target: 3,  title: 'Reach Day 3' }
    ],
    secondaryChallenges: [weekGoal(3)],
    primaryChallengeRewards: [{ type: 'unlock_regular', value: 'Freddie' }],
    secondaryChallengeRewards: [{ type: 'unlock_section', value: GROUP.THREES_COMPANY }]
  },
  // Set 4 → Heart + Best Two of Three.
  {
    name: 'Heart on the Line',
    primaryChallenges: [
      { id: 's4-1', type: 'combo_reach',      target: 5,  title: 'Reach a 5× combo' },
      { id: 's4-2', type: 'serve_customers',  target: 30, title: 'Serve 30 customers total' },
      { id: 's4-3', type: 'master_recipes',   target: 2,  title: 'Master 2 recipes (10/10)' }
    ],
    secondaryChallenges: [weekGoal(4)],
    primaryChallengeRewards: [{ type: 'unlock_powerup', value: PICKUP_TYPE.HEART }],
    secondaryChallengeRewards: [{ type: 'unlock_section', value: GROUP.BEST_TWO_OF_THREE }]
  },
  // Set 5 → Harvey Green (character) + Triple Threat (the last section).
  {
    name: 'Local Legend',
    primaryChallenges: [
      { id: 's5-1', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❤️ Heart power-ups', param: PICKUP_TYPE.HEART },
      { id: 's5-2', type: 'discover_recipes', target: 18, title: 'Discover 18 recipes total' },
      { id: 's5-3', type: 'wave_reach',       target: 4,  title: 'Reach Day 4' }
    ],
    secondaryChallenges: [weekGoal(5)],
    primaryChallengeRewards: [{ type: 'unlock_regular', value: 'Harvey Green' }],
    secondaryChallengeRewards: [{ type: 'unlock_section', value: GROUP.TRIPLE_THREAT }]
  },
  // Set 6 → Freeze (Ice). No section left to unlock — secondary is week-completion only.
  {
    name: 'Brain Freeze',
    primaryChallenges: [
      { id: 's6-1', type: 'combo_reach',      target: 6,  title: 'Reach a 6× combo' },
      { id: 's6-2', type: 'master_recipes',   target: 4,  title: 'Master 4 recipes total' },
      { id: 's6-3', type: 'serve_customers',  target: 50, title: 'Serve 50 customers total' }
    ],
    secondaryChallenges: [weekGoal(6)],
    primaryChallengeRewards: [{ type: 'unlock_powerup', value: PICKUP_TYPE.PAUSE }],
    secondaryChallengeRewards: []
  },
  // Set 7 → Karen (character). Freeze now available to use.
  {
    name: 'Speak to the Manager',
    primaryChallenges: [
      { id: 's7-1', type: 'use_powerup_type', target: 3,  title: 'Use 3 ❄️ Freeze power-ups', param: PICKUP_TYPE.PAUSE },
      { id: 's7-2', type: 'discover_recipes', target: 25, title: 'Discover 25 recipes total' },
      { id: 's7-3', type: 'wave_reach',       target: 5,  title: 'Reach Day 5' }
    ],
    secondaryChallenges: [weekGoal(7)],
    primaryChallengeRewards: [{ type: 'unlock_regular', value: 'Karen' }],
    secondaryChallengeRewards: []
  },
  // Set 8 → Speed (Feather).
  {
    name: 'Quickstep',
    primaryChallenges: [
      { id: 's8-1', type: 'combo_reach',      target: 7,  title: 'Reach a 7× combo (max!)' },
      { id: 's8-2', type: 'serve_regular',    target: 15, title: 'Serve Gerald 15 times', param: 'Gerald' },
      { id: 's8-3', type: 'master_recipes',   target: 6,  title: 'Master 6 recipes total' }
    ],
    secondaryChallenges: [weekGoal(8)],
    primaryChallengeRewards: [{ type: 'unlock_powerup', value: PICKUP_TYPE.FEATHER }],
    secondaryChallengeRewards: []
  },
  // Set 9 → Poop (character). Speed now available to use.
  {
    name: 'The Whole Crew',
    primaryChallenges: [
      { id: 's9-1', type: 'use_powerup_type', target: 5,  title: 'Use 5 ⚡ Speed power-ups', param: PICKUP_TYPE.FEATHER },
      { id: 's9-2', type: 'wave_reach',       target: 7,  title: 'Reach Day 7' },
      { id: 's9-3', type: 'discover_recipes', target: 35, title: 'Discover every recipe (35)' }
    ],
    secondaryChallenges: [weekGoal(9)],
    primaryChallengeRewards: [{ type: 'unlock_regular', value: 'Poop' }],
    secondaryChallengeRewards: []
  },
  // Set 10 — bragging rights. No feature reward yet (a final cutscene is TBD).
  {
    name: 'Top Scooper',
    primaryChallenges: [
      { id: 's10-1', type: 'master_recipes',   target: 12, title: 'Master 12 recipes total' },
      { id: 's10-2', type: 'use_powerup_wave', target: 5, title: 'Use 5 power-ups in one day' },
      { id: 's10-3', type: 'serve_regular',    target: 25, title: 'Serve Annie 25 times', param: 'Annie' }
    ],
    secondaryChallenges: [weekGoal(10)],
    primaryChallengeRewards: [],
    secondaryChallengeRewards: []
  }
];

// Dev safety net for the one cross-reference with no compile-time link: regular
// NAMES. Power-up values (PICKUP_TYPE) and section ids (GROUP) are constants — a
// typo there is a reference error. Regular names are hand-authored strings that
// must match the customer roster (customers.js); a typo would silently leave a
// reward ungrantable or a goal unreachable. Resolve every referenced name once at
// module load and warn loudly (rather than throw, so a typo can't white-screen).
for (const set of SETS) {
  for (const r of [...set.primaryChallengeRewards, ...set.secondaryChallengeRewards]) {
    if (r.type === 'unlock_regular' && !CHARACTER_BY_NAME.has(r.value)) {
      console.warn(`[challenges] unlock_regular reward references unknown regular "${r.value}"`);
    }
  }
  for (const ch of [...set.primaryChallenges, ...set.secondaryChallenges]) {
    if (ch.type === 'serve_regular' && (!ch.param || !CHARACTER_BY_NAME.has(ch.param))) {
      console.warn(`[challenges] serve_regular goal "${ch.id}" references unknown regular "${ch.param}"`);
    }
  }
}

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
    // When true (a tutorial REPLAY from Settings), every progress recorder,
    // commitEarned, and advanceSet is a no-op — so re-watching the tutorial can't
    // touch saved progress, grant rewards, or advance sets. Set by game.start().
    this.frozen = false;
    // Per-wave runtime counter for "use X power-ups in one wave" — not persisted.
    this.powerupsUsedThisWave = 0;
    // Current day within the week (1..WEEK_DAYS), pushed by Game each frame from
    // Waves — the progress source for the "Complete the Week" secondary challenge.
    this._dayInWeek = 1;
    // Transient: challenges that already fired their "earned" toast this session.
    /** @type {Record<string, boolean>} */
    this._notifiedEarned = {};
    /**
     * Fired when a challenge's requirement is newly met but not yet committed (so
     * the HUD can show a "✓ <title>" toast). The challenge stays "earned" until
     * commitEarned() runs at wave-end or game-over.
     * @type {(challenge: Challenge) => void}
     */
    this.onEarned = () => {};
  }

  _load() {
    const defaults = {
      currentSet: 0,
      /** @type {Record<string, boolean>} */
      completed: {},
      /** @type {Record<number, boolean>} sets whose PRIMARY rewards have been granted */
      primaryClaimed: {},
      /** @type {Record<number, boolean>} sets whose SECONDARY rewards have been granted */
      secondaryClaimed: {},
      stats: {
        discoveredCount: 0,
        masteredCount: 0,
        customersServed: 0,
        powerupsUsedByType: /** @type {Record<PickupTypeName, number>} */ (
          Object.fromEntries(PICKUP_TYPES.map(t => [t, 0]))
        ),
        powerupsUsedTotal: 0,
        coinTipsCollected: 0,   // lifetime coin tips cashed (Journal coin gauge)
        maxCombo: 0,
        // The campaign opens on Wave 0 (tutorial), so a fresh save starts below
        // Wave 1 — reaching Wave 1 is a real first milestone.
        maxWave: 0
      },
      unlocks: {
        /** @type {Record<string, boolean>} */
        powerups: {},
        /** @type {boolean} coin tips (Set 1 primary reward) */
        coin: false
      }
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Migration: the old single `rewardsClaimed[i]` granted a set's whole
          // reward bundle at once. Map it to BOTH tiers claimed so nobody loses
          // unlocks when the two-tier model lands.
          const legacy = parsed.rewardsClaimed || {};
          const primaryClaimed = { ...legacy, ...(parsed.primaryClaimed || {}) };
          const secondaryClaimed = { ...legacy, ...(parsed.secondaryClaimed || {}) };
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
            primaryClaimed,
            secondaryClaimed
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

  /** Tutorial-replay sandbox toggle: freeze ALL progress mutation. @param {boolean} b */
  setFrozen(b) { this.frozen = b; }

  /** Wipe all challenge progress, unlocks, and counters back to a fresh save. */
  reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.state = this._load();
    this.powerupsUsedThisWave = 0;
    this._dayInWeek = 1;
    this._notifiedEarned = {};
  }

  // === Unlocks (queried by waves/pickups) ====================================

  /** @param {string} powerupType */
  isPowerupUnlocked(powerupType) {
    return this.state.unlocks.powerups[powerupType] === true;
  }

  /** @returns {PickupTypeName[]} */
  unlockedPowerupTypes() {
    return PICKUP_TYPES.filter(t => this.isPowerupUnlocked(t));
  }

  /** Coin tips unlock from Set 1 primary; gated like the power-ups. */
  isCoinUnlocked() { return this.state.unlocks.coin === true; }

  /**
   * Recipe sections (group ids) the player has unlocked. Junior Scoop is always
   * available; the other six are SECONDARY rewards. Derived from which sets'
   * secondary rewards have been claimed, so it stays correct for old saves without
   * a migration step. Fed to Waves so a section spawns once it's BOTH unlocked AND
   * wave-reached.
   * @returns {Set<string>}
   */
  unlockedSections() {
    const out = new Set([GROUP.JUNIOR_SCOOP]);
    for (let i = 0; i < SETS.length; i++) {
      if (!this.state.secondaryClaimed[i]) continue;
      for (const r of SETS[i].secondaryChallengeRewards) {
        if (r.type === 'unlock_section') out.add(r.value);
      }
    }
    return out;
  }

  /**
   * True once the first challenge set (the Wave 0 tutorial goals) has been
   * cleared — used to skip the Wave 0 tutorial on subsequent runs.
   */
  firstSetCleared() {
    return this.state.currentSet >= 1;
  }

  // === Event recording =======================================================

  /** @param {string} _id */
  recordDiscover(_id) {
    if (this.frozen) return;
    this.state.stats.discoveredCount = this._countDiscovered();
    this._checkCompletions();
    this._save();
  }

  /** @param {string} _id */
  recordMaster(_id) {
    if (this.frozen) return;
    this.state.stats.masteredCount = this._countMastered();
    this._checkCompletions();
    this._save();
  }

  recordCustomerServed() {
    if (this.frozen) return;
    this.state.stats.customersServed += 1;
    this._checkCompletions();
    this._save();
  }

  /**
   * A power-up was used (fired) — from a tip or the combo breaker, both routed
   * through Game._firePower. Feeds the use_powerup_type / _total / _wave goals.
   * @param {PickupTypeName} type
   */
  recordPowerupUsed(type) {
    if (this.frozen) return;
    this.state.stats.powerupsUsedByType[type] = (this.state.stats.powerupsUsedByType[type] || 0) + 1;
    this.state.stats.powerupsUsedTotal += 1;
    this.powerupsUsedThisWave += 1;
    this._checkCompletions();
    this._save();
  }

  /** A coin tip was cashed — lifetime count for the Journal coin gauge. */
  recordCoinCollected() {
    if (this.frozen) return;
    this.state.stats.coinTipsCollected = (this.state.stats.coinTipsCollected || 0) + 1;
    this._save();
  }

  /** Lifetime times a power-up type was used (Journal gauge, /100). @param {PickupTypeName} type */
  powerupUsedCount(type) { return this.state.stats.powerupsUsedByType[type] || 0; }
  /** Lifetime coin tips cashed (Journal gauge, /100). */
  coinCollectedCount() { return this.state.stats.coinTipsCollected || 0; }

  /** @param {number} combo */
  recordCombo(combo) {
    if (this.frozen) return;
    if (combo > this.state.stats.maxCombo) this.state.stats.maxCombo = combo;
    this._checkCompletions();
    this._save();
  }

  /** @param {number} wave */
  recordWaveReached(wave) {
    if (this.frozen) return;
    if (wave > this.state.stats.maxWave) this.state.stats.maxWave = wave;
    this._checkCompletions();
    this._save();
  }

  /**
   * Push the current day-in-week (1..WEEK_DAYS) — the progress source for the
   * "Complete the Week" secondary. Game calls this from Waves each frame; cheap +
   * guarded so it only re-checks on an actual day change.
   * @param {number} day
   */
  setDayInWeek(day) {
    if (this.frozen || day === this._dayInWeek) return;
    this._dayInWeek = day;
    this._checkCompletions();
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
      case 'complete_week':    return this._dayInWeek;
      case 'complete_section': {
        if (!ch.param) return 0;
        return this.recipes.getAll().filter(r => r.group === ch.param && r.mastered).length;
      }
      default: return 0;
    }
  }

  /** @param {Challenge} ch */
  _isMet(ch) { return this._getProgress(ch) >= ch.target; }
  /** @param {Challenge} ch */
  _isDone(ch) { return this.state.completed[ch.id] === true; }

  /** Every primary goal committed? (the reveal/advance gate). @param {ChallengeSet} set */
  _primaryComplete(set) {
    return set.primaryChallenges.every(ch => this._isDone(ch));
  }

  /**
   * Notify the HUD whenever a challenge's requirement is *newly* met. Does NOT
   * commit or advance — that waits for commitEarned() at wave-end / game-over. The
   * secondary tier only fires once the primary is complete (it stays gated).
   */
  _checkCompletions() {
    const set = SETS[this.state.currentSet];
    if (!set) return;
    const list = this._primaryComplete(set)
      ? [...set.primaryChallenges, ...set.secondaryChallenges]
      : set.primaryChallenges;
    for (const ch of list) {
      if (this._isDone(ch) || this._notifiedEarned[ch.id]) continue;
      if (this._isMet(ch)) {
        this._notifiedEarned[ch.id] = true;
        this.onEarned(ch);
      }
    }
  }

  /**
   * Earned-but-not-yet-committed challenges in the current set — the rows the
   * round-over overlay physically crosses off. Secondary goals only count once the
   * primary tier is complete (so "Complete the Week" can't cross off early).
   */
  getEarnedNotCommitted() {
    if (this.frozen) return [];
    const set = SETS[this.state.currentSet];
    if (!set) return [];
    const list = this._primaryComplete(set)
      ? [...set.primaryChallenges, ...set.secondaryChallenges]
      : set.primaryChallenges;
    return list.filter(ch => !this._isDone(ch) && this._isMet(ch));
  }

  /** Is the whole current set complete (primary AND secondary)? Gates advancing. */
  isCurrentSetComplete() {
    const set = SETS[this.state.currentSet];
    if (!set) return false;
    return [...set.primaryChallenges, ...set.secondaryChallenges].every(c => this._isDone(c));
  }

  /**
   * Commit earned challenges in the current set and grant the matching tier's
   * rewards once. Primary first; the secondary tier only commits once the primary
   * is complete. Does NOT advance the set (that waits for game-over / the
   * coordinator). Called at day-end and game-over.
   * @returns {{ committed: string[], rewards: Reward[], primaryComplete: boolean, setComplete: boolean }}
   */
  commitEarned() {
    if (this.frozen) return { committed: [], rewards: [], primaryComplete: false, setComplete: false };
    const idx = this.state.currentSet;
    const set = SETS[idx];
    /** @type {string[]} */ const committed = [];
    /** @type {Reward[]} */ const rewards = [];
    if (!set) {
      this._notifiedEarned = {};
      this._save();
      return { committed, rewards, primaryComplete: false, setComplete: false };
    }

    // Tier 1 — primary. Commit met goals, then grant the primary rewards once.
    for (const ch of set.primaryChallenges) {
      if (!this._isDone(ch) && this._isMet(ch)) { this.state.completed[ch.id] = true; committed.push(ch.id); }
    }
    if (this._primaryComplete(set) && !this.state.primaryClaimed[idx]) {
      this.state.primaryClaimed[idx] = true;
      for (const r of set.primaryChallengeRewards) { this._applyReward(r); rewards.push(r); }
    }

    // Tier 2 — secondary ("Complete the Week"). Only once the primary is complete.
    if (this._primaryComplete(set)) {
      for (const ch of set.secondaryChallenges) {
        if (!this._isDone(ch) && this._isMet(ch)) { this.state.completed[ch.id] = true; committed.push(ch.id); }
      }
      if (set.secondaryChallenges.every(c => this._isDone(c)) && !this.state.secondaryClaimed[idx]) {
        this.state.secondaryClaimed[idx] = true;
        for (const r of set.secondaryChallengeRewards) { this._applyReward(r); rewards.push(r); }
      }
    }

    this._notifiedEarned = {};
    this._save();
    return { committed, rewards, primaryComplete: this._primaryComplete(set), setComplete: this.isCurrentSetComplete() };
  }

  /**
   * Reveal the next set — called only at game-over (and mid-run by the coordinator
   * when a week fully completes), so finishing a set mid-run doesn't surface the
   * next set until appropriate. @returns {boolean} advanced
   */
  advanceSet() {
    if (this.frozen) return false;
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

  /** @param {Challenge} ch decorate with live progress + completion */
  _decorate(ch) {
    return { ...ch, progress: Math.min(ch.target, this._getProgress(ch)), completed: this._isDone(ch) };
  }

  /**
   * The current set for the live displays (round-over modal, night sky, pause),
   * split into primary + secondary tiers. `primaryComplete` tells the renderer
   * whether to reveal the secondary ("Complete the Week"). Null once every set is
   * cleared.
   * @returns {{ name: string, index: number, primaryComplete: boolean, primary: Array<Challenge & { progress: number, completed: boolean }>, secondary: Array<Challenge & { progress: number, completed: boolean }> } | null}
   */
  getCurrentSet() {
    const set = SETS[this.state.currentSet];
    if (!set) return null;
    return {
      name: set.name,
      index: this.state.currentSet,
      primaryComplete: this._primaryComplete(set),
      primary: set.primaryChallenges.map(ch => this._decorate(ch)),
      secondary: set.secondaryChallenges.map(ch => this._decorate(ch))
    };
  }

  /** Master list for the challenges journal modal (all tiers flattened per set). */
  getAllSets() {
    return SETS.map((set, i) => {
      const status = i < this.state.currentSet
        ? 'completed'
        : (i === this.state.currentSet ? 'current' : 'locked');
      return {
        name: set.name,
        index: i,
        status,
        rewards: [...set.primaryChallengeRewards, ...set.secondaryChallengeRewards],
        challenges: [...set.primaryChallenges, ...set.secondaryChallenges].map(ch => this._decorate(ch))
      };
    });
  }
}
