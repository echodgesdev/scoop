// @ts-check
// Central JSDoc typedefs. Import this file purely for its type side effects
// (e.g. `/** @typedef {import('./types.js').Scoop} Scoop */`) — it has no
// runtime exports.

/**
 * @typedef {'pink'|'mint'|'choco'|'vanilla'|'blueberry'} ScoopColor
 *   The five tray-scoop colors. 'rainbow' is a render hint, not a real color.
 *
 * @typedef {'heart'|'feather'|'pause'|'rainbow'} PickupTypeName
 *   String tag for a power-up type (granted via customer tips / the combo breaker).
 *
 * @typedef {'speed'|'pause'|'rainbow'} PowerUpTypeName
 *   String tag for a timed power-up (note: 'heart' is instant, not a power-up).
 *
 * @typedef {string} RecipeId
 *   Canonical color-multiset id (e.g. 'pink+pink', 'choco+mint+pink'). A
 *   documentation alias; each recipe is defined by its color combo + group.
 *
 * @typedef {'arriving'|'delay'|'waiting'|'leaving'} CustomerState
 *
 * @typedef {'phaseUp'|'waveUp'} WaveEventName
 *
 * @typedef {{ width: number, height: number }} Bounds
 *
 * @typedef {{ x: number, y: number, r: number, halfW: number }} Hitbox
 *
 * @typedef {{ x: number, y: number, vy: number, color: ScoopColor, dissolve?: number }} Scoop
 *   `dissolve` (seconds, 0..SCOOP_DISSOLVE_S) is present only while a missed
 *   scoop is fading out in the ground; absent means live/catchable.
 *
 * @typedef {object} ServedScoop
 * @property {ScoopColor} color   what the player actually handed over (may differ from a "wanted" slot under rainbow)
 * @property {number} t           flight progress 0..1
 * @property {number} srcX        x-position the scoop was launched from (cone top at time of serve)
 * @property {number} srcY        y-position it was launched from
 *
 * @typedef {object} Order
 * @property {RecipeId} recipe              canonical multiset id
 * @property {ScoopColor[]} colors          colors still needed; shrinks as the player serves
 * @property {ScoopColor[]} originalColors  what was originally requested; used for serve-completion FX
 * @property {ServedScoop[]} served         scoops the customer has already received (in serve order)
 * @property {number} value                 points awarded on full completion (from the recipe's group)
 * @property {number} weight                combo-bump on completion (from the recipe's group)
 * @property {number} timeLeft
 * @property {number} duration
 *
 * @typedef {object} Customer
 * @property {number} id
 * @property {number} slot         0..SLOT_COUNT-1
 * @property {number} x            current x
 * @property {number} targetX      lane-shift target
 * @property {number} yOff         slide-in offset (0 = settled)
 * @property {CustomerState} state
 * @property {number} timer
 * @property {number} waitT
 * @property {'happy'|'angry'|null} mood
 * @property {Order} order
 * @property {(PickupTypeName|'coin'|null)} [tip]  tipping mode: reward granted on order completion
 *
 * @typedef {object} Tuning
 * @property {number} spawnInterval
 * @property {number} fallMult
 * @property {number} patience
 *
 * @typedef {object} GameEventMap
 * @property {{ scoop: Scoop, perfect: boolean }} catch
 * @property {{}} trayFull
 * @property {{ count: number }} expire
 * @property {{ gained: number, colors: ScoopColor[], combo: number, x: number, y: number }} serve
 * @property {{ x: number, y: number, color: ScoopColor }} handoff   a scoop physically left the tray toward a customer (source burst at the cone)
 * @property {{ x: number, y: number }} partialServe                an accepted-but-incomplete serve (the "✓" tick)
 * @property {{}} serveFail
 * @property {{}} comboLost      the combo chain decayed / broke (patience timeout)
 * @property {{ type: PickupTypeName, x: number, y: number }} powerup   a power-up fired (heart heal or timed)
 * @property {{ x: number, y: number }} comboBreak                       the combo-breaker crescendo (supercharged power-up)
 * @property {{ x: number, y: number, color: ScoopColor }} discard       toss-top (the upward gesture)
 * @property {{ x: number, y: number, points: number }} coin            a coin tip granted
 * @property {{ title: string }} challengeEarned                        a challenge requirement was newly met (HUD toast)
 * @property {{}} phaseUp
 * @property {{ wave: number }} waveUp
 * @property {{}} gameOver
 */

export {};
