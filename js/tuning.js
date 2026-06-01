// @ts-check
// Balance numbers — what a designer would tweak without touching game logic.
// Re-exported from config.js so existing imports keep working; this file is
// the canonical place to change values.

export const PERFECT_CATCH_BAND = 14;
export const PERFECT_CATCH_BONUS = 40;

// === Wave / phase campaign structure ==========================================
export const PHASES_PER_WAVE = 4;
// Customer parallelism caps at 3. Late-wave difficulty now comes from richer
// recipes (R4*/R5same) rather than more simultaneous bubbles to track.
export const PHASE_ACTIVE = [1, 2, 3, 3];
export const PHASE_GOAL = [3, 5, 8, 13];
export const WAVE_CELEBRATE_S = 1.4;

// Per-recipe point values are now defined per-group in recipes.js — each
// recipe inherits its value from the group it belongs to.

// === Pickups & power-ups ======================================================
// Pickups now drift HORIZONTALLY across the screen inside bubbles. Their
// y-position is the strategic axis: lower-flying bubbles can be caught
// by the cone alone, higher-flying ones require taller stacks to reach.
export const PICKUP_RADIUS = 24;
export const PICKUP_SPAWN_MIN_S = 5.5;
export const PICKUP_SPAWN_MAX_S = 10.0;
export const PICKUP_WEIGHTS = [0.35, 0.3, 0.2, 0.15];
// Drift speed range. Each bubble picks its own value — slower ones give
// time to plan, faster ones force quick stack management.
export const PICKUP_FLOAT_MIN_SPEED = 50;
export const PICKUP_FLOAT_MAX_SPEED = 160;
// Vertical band (as fraction of canvas height) where bubbles can spawn. This
// is a deliberately NARROW lane that sits in the sky above the cone — one of
// the three readable zones (fall / catch / serve). MAX stays above the cone
// top (cone sits ~0.57H now that the ground is taller) so bubbles never drift
// into the customer area; MIN is high enough that the topmost bubbles need a
// tall stack to reach. Tuned together with FLOOR_Y_RATIO below.
export const PICKUP_MIN_Y_RATIO = 0.26;
export const PICKUP_MAX_Y_RATIO = 0.50;
// Bubble visual is slightly larger than the icon for readability.
export const PICKUP_BUBBLE_RADIUS_MULT = 1.35;

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
export const SCOOP_FALL_MIN = 130;
export const SCOOP_FALL_RANGE = 140;
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
export const BUBBLE_CASHOUT = STACK_CASHOUT_PER_SCOOP * 3;  // a banked bubble (Banked mode) is worth 3 scoops

// === Between-wave store =======================================================
// Score IS the currency — spending lowers your run total, so the high score
// reflects how efficiently you converted survival into points. Costs are flat
// (tune against typical per-wave income). The store is off by default and
// toggled from the debug panel while the economy is being explored.
export const HEAL_COST = 400;       // full heal
export const LOOTBOX_COST = 250;    // one random unlocked power-up

// === Spawn demand coupling ====================================================
// Probability that a freshly-spawned scoop is biased toward what waiting
// customers still need (after subtracting tray inventory). The remaining
// fraction stays uniform random so the queue never feels deterministic.
export const SPAWN_DEMAND_BIAS = 0.65;
// Wave 0 (the tutorial wave) leans harder toward what the lone customer needs,
// so a new player reliably catches the flavor in front of them.
export const WAVE0_DEMAND_BIAS = 0.75;

// Per-recipe combo weight is now defined per-group in recipes.js — each
// recipe inherits its weight from the group it belongs to.

// === Top-down delivery =======================================================
// Each accepted partial serve (one scoop handed to a customer who still
// needs that color) buys this much patience back. Encourages players to make
// progress on hard orders even when they don't have the whole order yet.
export const PARTIAL_SERVE_EXTEND_S = 1.2;

// === Banked power-up inventory (Banked game mode) ============================
// In Banked mode, catching a bubble adds it to a FIFO queue instead of firing
// it; Shift spends the front. The cap prevents stockpiling — catching while
// full evicts the oldest. (Auto mode ignores this — it fires on catch.)
export const MAX_PU_INVENTORY = 3;

// === Scene floor + actor embedding ===========================================
// Sand floor lives at FLOOR_Y_RATIO of canvas height. Each actor positions
// itself relative to that line — the cone tip embeds CONE_EMBED_PX below
// the sand top, customers wade in by CUSTOMER_FACE_OFFSET_PX, and the
// mini-cone they hold is embedded too.
//
// Customers sit well below the sand line so their speech bubbles (which
// extend ~100px above each face) drop into the lower-screen zone instead
// of overlapping the cone above them.
// Ground is now ~35% of the canvas (was 18%). Giving the serve/solitaire half
// real estate rebalances the "this is a reaction game" signal the old layout
// sent — the customers read as a co-equal play area, not a footer strip.
export const FLOOR_Y_RATIO = 0.65;
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

// === Slingshot (space) =======================================================
// Space launches the bottom tray scoop straight up as a smaller projectile.
// It pops bubbles on collision (firing the same _onPickup path as a normal
// catch), then disappears. Misses fly off the top of the screen. The
// reduced scale signals that the scoop has transformed — it's no longer a
// stack scoop, it's a shot.
export const PROJECTILE_SPEED = 800;    // px/s upward
export const PROJECTILE_SCALE = 0.55;   // fraction of tray-scoop radius

// === Stack rotate (down arrow) ===============================================
// Pressing Down rotates the tray: top wraps to bottom, others shift up. The
// movement lock is the cost — while rotating you can't move, catch, pop, or
// deliver. The window is short, but in a falling-scoop game, half a second
// of paralysis is real pressure: bad scoops accumulate that you can't dodge.
export const ROTATE_LOCK_S = 0.22;
// Lateral bow-out of the wrap-around scoop as it travels top → bottom. Makes
// the rotation read clearly instead of the scoop teleporting through the cone.
export const ROTATE_ARC_OUT_PX = 60;
