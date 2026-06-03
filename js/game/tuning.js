// @ts-check
// Balance numbers — what a designer would tweak without touching game logic.
// Re-exported from config.js so existing imports keep working; this file is
// the canonical place to change values.

export const PERFECT_CATCH_BAND = 14;
export const PERFECT_CATCH_BONUS = 40;

// === Wave / phase campaign structure ==========================================
export const PHASES_PER_WAVE = 4;
// Customer parallelism caps at 3. Late-wave difficulty now comes from richer
// recipes (R4*/R5same) rather than more simultaneous orders to track.
export const PHASE_ACTIVE = [1, 2, 3, 3];
export const PHASE_GOAL = [3, 5, 8, 13];
export const WAVE_CELEBRATE_S = 1.4;

// Per-recipe point values are now defined per-group in recipes.js — each
// recipe inherits its value from the group it belongs to.

// === Power-ups ================================================================
// Power-ups arrive as customer tips (and the combo breaker) — there's no bubble
// lane. These defaults seed the Game's tip-economy config (debug-tunable):
// the tip-gap range (seconds between tips; wider = rarer) and the per-type mix
// aligned to heart / ⚡ speed / ❄️ freeze / 🌈 rainbow.
export const PICKUP_SPAWN_MIN_S = 5.5;
export const PICKUP_SPAWN_MAX_S = 10.0;
export const PICKUP_WEIGHTS = [0.35, 0.3, 0.2, 0.15];

export const HEART_HEAL_AMOUNT = 30;
export const SPEED_DURATION_S = 6;
export const SPEED_MULT_BOOST = 1.7;
export const PAUSE_DURATION_S = 5;
export const RAINBOW_DURATION_S = 6;

// === Difficulty ramp ==========================================================
export const WAVE_RAMP = 6;
// Spawn cadence is deliberately slower than the original. A blur of scoops can
// only be REACTED to, never read — so we trade volume for legibility. Paired
// with MAX_LIVE_SCOOPS below, this keeps the fall zone a set of discrete,
// catchable decisions instead of an endless stream that overdraws the floor.
export const SPAWN_INTERVAL_START = 0.85;
export const SPAWN_INTERVAL_END = 0.42;
export const FALL_SPEED_MULT_END = 2.2;
// Time-to-cone, not just speed: scoops fall ~0.65·H (≈990px on a phone) to reach
// the cone, so at the old 130–270 px/s a wave-1 scoop took 4–8s to arrive — dead
// air you feel acutely holding a phone. Raised so a wave-1 scoop lands in ~2–4s
// while still leaving a readable window. Fine-tune live via the debug fall-speed
// multiplier (ScoopField.fallScale).
export const SCOOP_FALL_MIN = 240;
export const SCOOP_FALL_RANGE = 200;
// Hard cap on simultaneously-falling scoops. When at the cap the spawner idles
// (retrying each frame) until a scoop is caught or dissolves. This is the main
// lever against the "endless stream + framerate" problem.
export const MAX_LIVE_SCOOPS = 7;
// Missed scoops dissolve (fade + shrink + poof) once they fall past the catch
// line into the ground, rather than streaming off the bottom of the screen.
// Declutters the floor and culls live objects ~half a screen sooner.
export const SCOOP_DISSOLVE_S = 0.4;

export const PATTERN_TIME_START = 13;
export const PATTERN_TIME_END = 6.5;

export const COMBO_DECAY_S = 5;

// === Combo breaker (Tipping mode) ============================================
// Tipping has no bubble lane, so the score combo doubles as a charge meter:
// chain serves and when the combo hits this threshold it "breaks" — emptying
// the meter and firing a SUPERCHARGED (longer-running) power-up. It's the
// mode's active, skill-expressive payoff (chain serves → earn a power-up) with
// no new verb. The supercharged power-up runs at DURATION_MULT × the normal
// timed duration so it clearly out-classes a passive customer tip.
export const COMBO_BREAKER_THRESHOLD = 8;
export const COMBO_BREAKER_DURATION_MULT = 2;

// === Health ===================================================================
export const MAX_HEALTH = 100;
export const DAMAGE_PER_EXPIRE = 15;
// Derived from the expire damage so the relationship stays fixed: it takes
// THREE completed orders to undo one expired customer. Tune DAMAGE_PER_EXPIRE
// and the heal follows.
export const HEAL_PER_SERVE = DAMAGE_PER_EXPIRE / 3;

// === Wave-end cashout =========================================================
// At wave clear, the live combo "breaks" into flat points and every scoop left
// on the cone pops for a small bonus. Makes the end of a wave a payout beat and
// clears the tray for a fresh start (health is NOT touched — it persists).
export const COMBO_CASHOUT_PER = 25;        // points per combo point banked
export const STACK_CASHOUT_PER_SCOOP = 10;  // points per leftover tray scoop

// === Spawn demand coupling ====================================================
// Probability that a freshly-spawned scoop is biased toward what waiting
// customers still need (after subtracting tray inventory). The remaining
// fraction stays uniform random so the queue never feels deterministic.
export const SPAWN_DEMAND_BIAS = 0.65;
// Wave 0 (the tutorial wave) leans harder toward what the lone customer needs,
// so a new player reliably catches the flavor in front of them.
export const WAVE0_DEMAND_BIAS = 0.75;

// === Order size mix ==========================================================
// Relative spawn weights for order SIZE (#scoops), per wave. pickOrder rolls a
// size by these weights (restricted to the sizes actually present in the wave's
// section-gated pool, then renormalized), THEN picks a recipe of that size.
// This decouples how OFTEN a size shows up from how MANY recipes of that size
// exist — so 3-scoop becomes the rich, dominant core while 1-scoop tapers off
// late. Sizes cap at 3 (no 4-scoop content). Indexed by wave; waves past the
// end clamp to the last row.
/** @type {Record<number, number>[]} */
export const ORDER_SIZE_WEIGHTS = [
  { 1: 1 },                  // wave 0 — tutorial: singles only
  { 1: 1 },                  // wave 1 — pool is singles only
  { 1: 50, 2: 50 },          // wave 2 — doubles arrive
  { 1: 35, 2: 50, 3: 15 },   // wave 3
  { 1: 25, 2: 45, 3: 30 },   // wave 4 — 3-scoop core opens
  { 1: 18, 2: 37, 3: 45 },   // wave 5
  { 1: 12, 2: 30, 3: 58 },   // wave 6 — full 3-scoop core
  { 1: 10, 2: 25, 3: 65 },   // wave 7
  { 1: 8,  2: 22, 3: 70 },   // wave 8
  { 1: 7,  2: 20, 3: 73 },   // wave 9
  { 1: 6,  2: 18, 3: 76 }    // wave 10+ — 3-scoop is the late-game core
];

// === New-recipe discovery bias ===============================================
// Probability that a spawn deliberately targets a not-yet-discovered recipe (of
// the rolled size), so the player keeps meeting new recipes instead of re-
// rolling ones they've already made. Ramps UP with wave (over WAVE_RAMP) because
// later waves have the most undiscovered recipes to surface — the opposite of
// the old pure-uniform pick, where a growing pool made discovery progressively
// less likely.
export const DISCOVERY_BIAS_START = 0.25;  // wave 1
export const DISCOVERY_BIAS_END = 0.6;     // wave WAVE_RAMP and beyond

// Per-recipe combo weight is now defined per-group in recipes.js — each
// recipe inherits its weight from the group it belongs to.

// === Top-down delivery =======================================================
// Each accepted partial serve (one scoop handed to a customer who still
// needs that color) buys this much patience back. Encourages players to make
// progress on hard orders even when they don't have the whole order yet.
export const PARTIAL_SERVE_EXTEND_S = 1.2;

// === Scene floor + actor embedding ===========================================
// Sand floor lives at FLOOR_Y_RATIO of canvas height. Each actor positions
// itself relative to that line — the cone tip embeds CONE_EMBED_PX below
// the sand top, customers wade in by CUSTOMER_FACE_OFFSET_PX, and the
// mini-cone they hold is embedded too.
//
// Customers sit well below the sand line so their speech bubbles (which
// extend ~100px above each face) drop into the lower-screen zone instead
// of overlapping the cone above them.
// Sky/ground split — the fixed fraction of canvas height that is sky (ground
// begins here); read via config.groundYFor. Shrunk from 0.65 → 0.55 for mobile:
// a shorter sky cuts the fall distance (scoops arrive sooner) AND lifts the
// whole play block up, growing the empty bottom band so a one-handed thumb rests
// below the customers/orders instead of over them.
export const FLOOR_Y_RATIO = 0.55;
// Cone sits deeper in the sand now (center ≈ on the sand line) so it reads as
// planted in the ground rather than balancing on the surface. Shifts the cone
// — and the whole stack riding on it — down with it.
export const CONE_EMBED_PX = 55;              // positive = cone tip this many px below the sand top
// Customers sit well down in the sand so their speech bubbles (which rise
// ~160px above the face) clear the cone and its scoop stack instead of
// overlapping the player.
export const CUSTOMER_FACE_OFFSET_PX = 175;   // positive = face center this many px below the sand top

// === Handing animation =======================================================
// On serve, the cone briefly leans toward the customer it just handed a
// scoop to — a physical "reach" gesture before snapping back.
export const HANDOFF_REACH = 28;       // px of peak lean
export const HANDOFF_DURATION_S = 0.32;

// === Served-scoop flight =====================================================
// Time a scoop spends in flight from the cone to the customer's mini-cone.
export const SERVED_FLIGHT_S = 0.32;
export const SERVED_FLIGHT_ARC = 50;   // peak upward bump along the arc

// Mini-cone proportions (customer's held cone, fills with served scoops).
// Scaled up alongside the larger customer faces so the completion read stays
// proportional to the customer (and legible from the now-taller ground band).
export const MINI_SCOOP_RADIUS = 19;
export const MINI_CONE_OFFSET_X = 58;       // right of the customer face
export const MINI_CONE_W = 40;
export const MINI_CONE_H = 50;
// Mini-cone tip relative to the customer's *face center* — so the held
// cone tracks the customer however they're positioned (in/out of sand).
// Scaled with the larger face; puts the cone tip just below the chin, with
// the scoop-stack growing up beside the face.
export const MINI_CONE_FACE_OFFSET_PX = 46;
