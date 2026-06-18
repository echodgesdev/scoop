# Design Backlog

## Combo Cashout — "Star Power"

**Status:** designed, not implemented
**Inspiration:** Guitar Hero's star power. Build a multiplier, choose when to cash it in.

### Concept

Right now the combo is purely a score multiplier — fragile, decays if you stop scoring, breaks if a customer expires. The only thing it does is multiply points; losing it just feels bad with no offsetting tool.

**Cashout** turns the combo into a *resource the player can spend*. Once the combo is ≥ 3× the player can press **↑ (Up Arrow)** to cash it out: combo resets to 1×, and a separate "Star Power" buff activates whose duration scales with the cashed-out combo value. The existing combo decay bar (top-left under the score) visually re-purposes into the Star Power countdown.

This adds a real timing decision:
- **Greedy:** keep chaining serves, multiplier compounds. One fumble erases everything.
- **Steady:** cash out at 3×, take a small buff, build again. Lower scores but constant utility.
- **Hybrid:** ride to ~8×, cash out for a long Star Power window, build from 1× during it.

### Control remap

Currently both **↑** and **Enter** trigger delivery. Cashout needs ↑ exclusively.

- **Enter / Return** — deliver one tray scoop to the customer in reach (existing behavior, unchanged).
- **↑ (Up Arrow)** — cashout (NEW). Does nothing if combo < 3× (play a soft "nope" beep so the player learns the threshold).

The help text in [index.html](index.html) currently reads "↑ / Enter to serve" — update to "Enter to serve, ↑ to cash out combo".

### What Star Power does

While active: **all score gained is doubled** (score multiplier × 2, applied on top of the active combo). The combo can still be built up during Star Power so a perfectly-timed cashout produces a compounding window — Star Power active + combo growing = high payout.

This is **independent** of the four catch-bubble powerups (heart / feather / pause / rainbow). The existing mutual-exclusion model among those four stays intact. Star Power is a fifth, parallel slot. So a player can be running rainbow + star power simultaneously, or pause + star power, etc.

### Duration scaling

Linear:

```
durationSeconds = comboAtCashout
```

So:
- 3× combo → 3s of Star Power
- 5× → 5s
- 10× → 10s
- 15× → 15s

Cap at `STAR_POWER_MAX_S = 20` so extreme combos don't trivialize a wave.

If a player tries to cash out below 3×, the input is rejected (sound.bad()). 3× is the floor; design intent is "cashout costs a noticeable build".

### Stacking rules

- Star Power's score doubling stacks **multiplicatively** with the active combo:
  - Score per complete order = `recipe.value × combo × (starPowerActive ? 2 : 1)`
- Cashing out **while Star Power is already active**: the new cashout's duration is added to the remaining time (NOT max-of). This rewards back-to-back cashouts for skilled players.
- Star Power does NOT affect partial-serve patience extension or any other system — purely a score multiplier.

### UI changes

1. **Combo bar repurposing.** The decay bar (`.combo-decay-fill` in [styles.css](styles.css)) currently shows time until combo decays to 0. When Star Power is active, the same bar shows Star Power's remaining duration. Color-shift the gradient from the current pink/gold to a bright cyan/white to telegraph the change.

2. **Combo readout.** While Star Power is active, prefix the combo text with "⭐" — e.g., "⭐ 4× combo" — so the player sees the doubling effect is live.

3. **Cashout-ready cue.** When combo crosses the 3× threshold, briefly pulse the combo readout (CSS animation) so the player learns the tool is available. Optional but recommended for discoverability.

4. **Star Power active visual.** Add a subtle full-screen tint or vignette while active (e.g., faint cyan around the canvas edges) — like Guitar Hero's blue glow. Reuse `effects.addShake` family or a CSS overlay.

### Implementation outline

#### tuning.js

```js
export const CASHOUT_MIN_COMBO = 3;
export const STAR_POWER_SCORE_MULT = 2;
export const STAR_POWER_MAX_S = 20;
// Per-combo seconds. Currently 1.0 = "combo value in seconds";
// drop below 1 if cashouts feel too long.
export const STAR_POWER_S_PER_COMBO = 1.0;
```

#### shop.js

Add Star Power state and helpers:

```js
// In constructor / reset:
this.starPowerT = 0;        // seconds remaining
this.starPowerDuration = 0; // total duration (for fraction bar)

// New method:
cashOutCombo() {
  if (this.combo < CASHOUT_MIN_COMBO) return false;
  const seconds = Math.min(STAR_POWER_MAX_S, this.combo * STAR_POWER_S_PER_COMBO);
  // Stack: ADD to existing duration rather than replacing.
  this.starPowerT += seconds;
  this.starPowerDuration = Math.max(this.starPowerDuration, this.starPowerT);
  this.combo = 1;
  this.comboTimer = 0;
  return true;
}

get starPowerActive() { return this.starPowerT > 0; }
get starPowerFraction() {
  return this.starPowerDuration > 0 ? this.starPowerT / this.starPowerDuration : 0;
}
```

Tick `starPowerT` down in `shop.update(dt)` (similar to comboTimer):

```js
if (this.starPowerT > 0) {
  this.starPowerT = Math.max(0, this.starPowerT - dt);
  if (this.starPowerT === 0) this.starPowerDuration = 0;
}
```

Apply the multiplier in `serveOne()` at the final-completion branch:

```js
const baseGain = c.order.value * this.combo;
const gained = baseGain * (this.starPowerActive ? STAR_POWER_SCORE_MULT : 1);
```

#### input.js

Split delivery and cashout:

```js
// Add new handler:
this.onCashout = () => {};

// Update switch:
case 'ArrowUp':
  if (!e.repeat) this.onCashout();
  e.preventDefault();
  break;
case 'Enter':
  if (!e.repeat) this.onDeliver();
  e.preventDefault();
  break;
```

(Currently both keys go to `onDeliver`. Split them.)

#### game.js

Wire the new input + implement `_cashout`:

```js
this.input.onCashout = () => this._cashout();

_cashout() {
  if (!this.running || this.paused || this.inPauseMenu || this.inWaveTransition) return;
  if (this.player.locked) return;
  if (this.shop.cashOutCombo()) {
    this.sound.perfect();            // celebratory ding
    this.effects.addShake(6);
    this.hud.setCombo(this.shop.combo, this.shop.comboFraction);
    // Optional: emit a 'cashout' bus event for FX listeners.
  } else {
    this.sound.bad();
  }
}
```

#### hud.js

`setCombo` already updates the decay bar. Add a `setStarPower(active, fraction)` method called every step from `_step`:

```js
setStarPower(active, fraction) {
  this.comboEl.classList.toggle('star-power', active);
  if (active) {
    this.comboDecayFillEl.style.width = `${fraction * 100}%`;
    this.comboTextEl.textContent = `⭐ ${this.shop.combo}× combo`;
  }
  // If not active, the regular setCombo flow handles the bar.
}
```

In game `_step`, after the existing combo/HUD update:

```js
this.hud.setStarPower(this.shop.starPowerActive, this.shop.starPowerFraction);
```

#### styles.css

```css
#combo.star-power .combo-text {
  color: #5cb8ff;
  text-shadow: 0 0 8px #5cb8ff, 0 1px 0 #fff;
}
#combo.star-power .combo-decay-fill {
  background: linear-gradient(90deg, #5cb8ff, #ffffff);
}

/* Optional full-screen tint while Star Power is active. */
#game::after { /* Hmm, can't do this on canvas — use an overlay div */ }
```

For the full-screen tint, add a `<div id="star-power-tint"></div>` to index.html, position fixed, pointer-events none, opacity controlled by JS. Keep simple.

### Tuning knobs

| Knob | Default | Purpose |
| --- | --- | --- |
| `CASHOUT_MIN_COMBO` | 3 | Floor before cashout is allowed. Higher = more commitment before reward. |
| `STAR_POWER_SCORE_MULT` | 2 | Score multiplier during active Star Power. Try 1.5 if 2 feels too strong. |
| `STAR_POWER_S_PER_COMBO` | 1.0 | Seconds of Star Power per combo point. 0.7 for short windows, 1.5 for long. |
| `STAR_POWER_MAX_S` | 20 | Hard cap so extreme combos don't trivialize entire waves. |

### Open design questions

1. **Should cashout cost more than 0?** Currently it's free — combo resets to 1× but you don't lose anything else. Could also cost ~1s of customer patience or a tray slot. Probably not needed; the cooldown is implicit (you have to rebuild the combo).

2. **Should Star Power affect anything beyond score?** Tempting to add a secondary effect like "no combo decay during Star Power" or "next bubble is free". I'd resist — keep the mechanic legible. One axis (score), one decision (when to cash out).

3. **Should cashout interact with Star Power-already-active?** Current design: cashout while active **adds** time. Alternative: prevent cashout while active (force player to wait). Adding is more rewarding and easier to time; preventing is simpler. Default to "adds".

4. **Should the cashout button be visible on screen** (a button next to the combo readout that's clickable, in addition to ↑)? Could help discoverability. Defer until playtesting shows discoverability is an issue.

5. **Tutorialize via challenges?** A challenge set ~3-4 could include "Cash out a combo of 5× or higher" to force the player to learn the verb. Slots into the existing challenge-as-tutorial pattern.

### Recommended order to implement

1. **tuning.js** + **shop.js** Star Power state and methods (no UI yet — verify the math works).
2. **input.js** key split + **game.js** `_cashout` wiring. Cashout works but only via a `console.log` or sound cue.
3. **hud.js** combo bar repurposing + `setStarPower` call. Player can now SEE Star Power.
4. **styles.css** color shift on `.star-power`.
5. **Optional polish:** full-screen tint overlay, pulse animation when combo crosses 3×.
6. **Challenge integration:** add a "Cash out a 5× combo" challenge to set 3 or 4 so the mechanic gets introduced to new players via the gating system.

### Memory note for the next session

Per [scoop-solitaire-direction.md](C:/Users/edward.hodges/.claude/projects/c--Users-edward-hodges-Documents-chris-scoop/memory/scoop-solitaire-direction.md), the design should reinforce depth over breadth — *planning, peek-then-commit, sequence resolution*. Cashout fits: it's a new *decision* (when to cash out), not a new *parallel chore* (no extra customer to track, no new threat to dodge). It deepens the combo system rather than widening the game.

---

## Customer Regulars — unlockable characters

**Status:** ALL PHASES SHIPPED. Phases 1/2/6 (2026-06-14): sprite sheet + roster
+ selection waterfall (replacing `mascot_test.png`), the persisted unlock/served
store ([game/regulars.js](js/game/regulars.js)), first-serve unlocking, and the
Regulars collection screen. Phases 3/4/5 (2026-06-16): locked-spawn gating with
the per-run "mystery" mechanic, the day-end flip reveal, and the "serve a regular
N times" challenge family. Favorite *flavor* → favorite *recipe*. The roster now
splits **5 starters / 4 challenge-reward / 4 mystery** — and the challenge-set
reward ladder that drives the four challenge unlocks (plus the coin/power-up
unlocks) is its own section below: **Challenge Reward Ladder**. See the per-phase
breakdown below. Next idea (not built): a mechanical hook for favorite recipe
(currently cosmetic).

### Concept

Customers are no longer one anonymous face cycling moods — they're a roster of
named **regulars**, each with a favorite recipe, a one-line blurb, and a lifetime
**Served** count. The overarching epic: regulars are **unlockable**. The first
time you serve a new one (or hit some trigger), a wave-end animation reveals them
— their blank "Empty" face appears inside a coin and flips to their default face.
Served counts then seed a new challenge family ("Serve Annie 10 times"), giving
the serve half of the loop its own collectible progression — depth, not breadth
(see the solitaire-direction memory: a new *goal to chase*, not a new chore).

### The sprite sheet (shipped)

`assets/customer_sheet.png` — source JSON in
[dev_tools/base_sprite_sheet_jsons/customer_sheet.json](dev_tools/base_sprite_sheet_jsons/customer_sheet.json).
14 rows × 7 columns of 256px cells. Re-export the JSON from the sprite editor and
re-derive the compact runtime def when the art changes.

- **Rows = characters.** Row 0 (`Empty`) is the column-label/legend strip —
  **not playable**. Rows 1–13 are the regulars (Annie, Amara, Sanjay, Gerald,
  Chad, Missy, Karen, Axel, Reginald, Chris, Freddie, Harvey Green, Poop).
- **Columns = expressions:** `0 Empty` (blank/silhouette — the pre-unlock coin
  face) · `1 Default` · `2 Hungry` · `3 Upset` · `4 Angry` · `5 Drool` ·
  `6 Frozen`. This is the old 6-mood layout shifted one column right (Empty took
  column 0), so a face's column = its old index + 1.
- Faces don't collide (tap-targeted by lane x), so every frame's `body` is null.
- Display size is **178px** (102 × 1.75 — sized to read clearly larger than a
  ~70px falling scoop; the bubble / tip badge / mini-cone offsets sit against it);
  the 256px art is downscaled. Grow faces by bumping `FACE_SIZE` alone in
  [view/stations.js](js/view/stations.js).

Files: [view/sprites/customerSprite.js](js/view/sprites/customerSprite.js) (def),
[game/customers.js](js/game/customers.js) (roster + waterfall),
[view/stations.js](js/view/stations.js) (renders row=character, column=mood).

### Selection waterfall (shipped)

`pickCustomer()` in [game/customers.js](js/game/customers.js) decides who walks up
next, as a strict→loose cascade (each looser tier reached only if the stricter one
above would leave nobody):

1. **(hard)** a regular appears at most once on screen at a time — `onScreen`
   spans every state (arriving/waiting/leaving) so they can't reappear while still
   sliding off.
2. **(soft)** never immediately re-spawn the one that just left — `justLeft`
   (tracked as `Shop.lastDeparted`, set when a customer is spliced off the board).

Uniform-random within the surviving pool. `rng` is injectable for tests. Shop
assigns `c.character` in both spawn paths and bumps `CHARACTER_BY_NAME.served` on
order completion (in-session only for now). Roster (13) > slots (5), so the pool
never empties.

**Locked gating** is now handled one level up, at the *roster source* rather than
inside the waterfall: `pickCustomer` is fed `world.eligibleRegulars()` (unlocked
starters/regulars + this run's mystery candidate), so locked characters simply
aren't candidates. Further tiers can still be added inside the cascade as the epic
grows, keeping strict→loose order so it degrades gracefully:
- **Cooldown / least-recently-seen bias** — widen `lastDeparted` to a short recent
  queue, or weight toward the least-recently-shown, so the same 2–3 don't cluster.

### Shipped 2026-06-14 (phases 1, 2, 6)

- **Unlock store + persistence (phase 1).** [game/regulars.js](js/game/regulars.js)
  — a `Regulars` store (localStorage `scoop.regulars`) holding `{ unlocked, served }`
  keyed by name, owned by World, wiped by the Settings reset. `served` now lives
  here (no longer on the roster object). `drainPendingReveals()` exposes
  just-unlocked names for the future flip animation.
- **Unlock trigger (phase 2): first serve.** World `_onOrderComplete` calls
  `regulars.recordServed(customer.character)`, which bumps `served` and unlocks on
  the first completed order. Simple + legible; paces with play.
- **Collection screen (phase 6).** `#regularsOverlay` (a card grid) reachable from
  the title, pause, and game-over menus. Each card crops its face from the sprite
  sheet via CSS `background-position`; unlocked cards show the Default face (col 1)
  + name + favorite recipe + blurb + served count, locked cards show the sheet's
  Empty white-shadow sprite (col 0) colorized grey + "???" (a tease that previews
  the eventual unlock flip — grey shadow → full face).

### Shipped 2026-06-16 (phases 3, 4, 5)

- **Locked-spawn gating + the "mystery" mechanic (phase 3).** Five roster entries
  are **starters** (`starter: true` in [game/customers.js](js/game/customers.js)),
  always in the spawn pool — so it never starves (max ~4 on screen). The shop's
  selection waterfall now draws from `world.eligibleRegulars()` (via
  `shop.setRosterSource`): unlocked regulars **plus** this run's mystery candidate.
  On each `World.reset`, one still-locked **mystery-pool** regular (`mystery: true`
  — Missy/Axel/Reginald/Chris; challenge-reward regulars are excluded) is rolled as
  the mystery (`regulars.pickMysteryCandidate`) and a reveal day is picked in
  **[3,7]**; the mystery only joins the pool once `waves.wave ≥ revealDay`, and
  unlocks when first served. So a single life can unlock **at most one** mystery
  regular — you must die to roll the next candidate. (Starters keep the roster from
  being burned in one run; the other four regulars unlock from challenge sets.)
- **Day-end unlock-reveal QUEUE (phase 4, generalized).** The CSS 3D **coin flip**
  is now the shared "you unlocked something" animation for **all** unlock kinds:
  regulars (silhouette → face crop), power-ups, the coin tip, and recipe sections
  (an emoji `?` coin → the token/section emoji). `game._beginWaveTransition` passes
  the day's regular reveals (`world.drainTutorialReveals()` + `regulars.drainPendingReveals()`)
  into `hud.showWaveTransition({ reveals })`; the HUD holds them until AFTER the
  challenge cross-offs, then `_afterCrossOffs` commits the set, builds ONE queue of
  `[…regulars, …rewards]`, and `_runUnlockQueue` flips them **one at a time** (one
  spins, cuts to the next, until all are shown) before the resume countdown. Card
  markup: `_unlockCardHtml`; reward→card mapping: `_rewardToCard`. The old static
  `.wt-rewards` text box is retired (kept hidden). Hitting Play skips the queue.
- **"Serve a regular N times" challenge family (phase 5).** New `serve_regular`
  challenge type ([game/challenges.js](js/game/challenges.js), reads
  `regulars.servedCount(param)`); `Challenges` now takes the `regulars` store.
  Seeded into the late sets (Set 8 "Serve Gerald 15 times", Set 10 "Serve Annie
  25 times") — both target STARTERS so they're always reachable.
- **Favorite flavor → favorite recipe.** Each regular now stores a `favoriteRecipe`
  (canonical recipe id, e.g. `pink+pink`); the collection card shows its color dots
  + recipe name, resolved via `RECIPE_BY_ID` ([game/recipes.js](js/game/recipes.js)).
- **Tutorial-end "meet your first regulars".** The scripted Day-0 tutorial (see the
  **Scripted Tutorial** section) stages its customers; while it's active,
  `world._onOrderComplete` records the served starters (`world.drainTutorialReveals()`,
  capped at 3) so the day-end queue can flip them in alongside Set 1's rewards
  (🪙 Coin + the first two recipe sections) — the only time a STARTER gets a reveal
  coin (they're never actually locked).

### Open ideas (not built)

- **Favorite recipe as a mechanical hook.** Currently cosmetic; could grant a bonus
  (extra tip / patience) when you serve a regular their favorite recipe.
- **Reveal-day tuning.** Days 3–7 spreads the mystery across early-to-mid runs. If
  unlocking feels too rare/common, tighten the window or gate on a serve/score
  milestone instead of a day.

> **Note:** challenge-gated unlocks (once an open idea) shipped — four regulars
> (Freddie/Harvey Green/Karen/Poop) now unlock via the `unlock_regular` challenge
> reward; see the **Challenge Reward Ladder** section below.

---

## Challenge Reward Ladder

**Status:** SHIPPED 2026-06-16 (sections re-coupled 2026-06-16). The 10 challenge
sets ([game/challenges.js](js/game/challenges.js)) are the spine of progression:
each set is the *only* source of its feature(s), and clearing one is the gate for
the next. Rewards are coin/power-ups, regulars, AND recipe sections (sections were
briefly day-gated, then brought back here).

### The ladder

Each set is 3 goals; clearing all 3 grants the set's reward. The unlock order:

A set may grant MULTIPLE rewards (`rewards: Reward[]`). Sets 1–5 also dole out the
six non-tutorial recipe sections (Junior Scoop is always unlocked):

| Set | Name | Reward(s) |
|----:|------|-----------|
| 1 | Getting Started | 🪙 **Coin** tips + 🍨 Daily Double + ☯️ Yin & Yang (tutorial set) |
| 2 | Taste the Rainbow | 🌈 Rainbow power-up + 🎭 Odd Couple |
| 3 | Making Regulars | 😀 **Freddie** (regular) + 🎪 Three's Company |
| 4 | Heart on the Line | ❤️ Heart power-up + 🥈 Best Two of Three |
| 5 | Local Legend | 😀 **Harvey Green** (regular) + 🎨 Triple Threat (last section) |
| 6 | Brain Freeze | ❄️ Freeze power-up |
| 7 | Speak to the Manager | 😀 **Karen** (regular) |
| 8 | Quickstep | ⚡ Speed power-up |
| 9 | The Whole Crew | 😀 **Poop** (regular) |
| 10 | Top Scooper | — (bragging rights; final cutscene TBD) |

Reward types (`Reward.type` in challenges.js): `unlock_coin`, `unlock_powerup`,
`unlock_regular`, `unlock_section`. Applied once via `_applyReward` (coin sets
`unlocks.coin`, power-ups set `unlocks.powerups[x]`, regulars call
`regulars.unlock(name)`). Sections are **derived** — `unlockedSections()` reads
which sets' rewards have been claimed (`rewardsClaimed`) rather than a stored map,
so old saves get their sections retroactively without a migration step.

### Two hard rules

1. **A set's goals only require features unlocked by EARLIER sets.** A set never
   asks you to *use* the power-up it itself unlocks — so the power-up-use goal for
   Rainbow lives in Set 3 (after Set 2 grants it), Heart's in Set 5, etc. The
   power-up-granting sets (2/4/6/8) gate on combo / serve / master goals instead.
   The rule now also covers **sections**: a set's `discover_recipes` target is
   always ≤ the recipes reachable from sections unlocked by EARLIER sets (Set 2
   "discover 8" vs the 15 from Set 1's 3 sections; Set 5 "discover 18" vs 30 from
   Sets 1–4; Set 9 "discover 35" needs all sections, all unlocked by Set 5).
2. **The next set won't appear until the current run ENDS.** Clearing a set's goals
   unlocks its reward *immediately* (mid-run, via `commitEarned()` — so you can use
   that Rainbow right away), but the *next* set's challenges stay hidden until you
   die. The day-end overlay shows "Challenge set complete! Finish this run to
   unlock the next set of challenges." (`.wt-finish-note`). Mechanically:
   `commitEarned()` applies rewards + reports `setComplete` but does **not** bump
   `currentSet`; `advanceSet()` does the bump, and it's called only at the start of
   the *following* run ([game.js](js/game.js) `start()`), so a player clears at most
   one set per life.

### Tip gating + PACING

Tips can only pay out tokens the player has unlocked (so the Day-0 tutorial tips
nothing; coins begin once Set 1 clears; power-ups join as their sets clear). On top
of that, [modes/tipping.js](js/game/modes/tipping.js) `rollTip()` now **paces** the
mix so a player can't string a chain of big power-ups and blitz the day:

- **Minor tips** — the ❤️ heart heal and the 🪙 coin cash — are eligible anytime
  they're unlocked (they don't break pacing).
- **Major tips** — the timed power-ups 🌈 / ⚡ / ❄️ — are rationed three ways:
  1. **held back early** — only once `waves.waveFraction ≥ MAJOR_TIP_DAY_FRACTION`
     (0.3), so the start of each day is minor-only;
  2. **capped per day** — at most `MAX_MAJOR_TIPS_PER_DAY` (5), tracked in the mode
     and reset when `waves.wave` rolls over;
  3. **de-duplicated** — `_majorBusy()` excludes a major that's already the running
     power-up (`powerups.active` / `activeBubble`) OR already waiting as another
     on-screen customer's `tip`, so two of the same never overlap.

The power-ups modal ([view/hud.js](js/view/hud.js) `_renderPowerups`) still shows the
unlock lock state (coin via `isCoinUnlocked`, power-ups via `isPowerupUnlocked`).

### Recipe sections re-coupled to challenges

Recipe-book sections are challenge rewards **again** (the earlier day-only decoupling
is reverted — players liked the challenge unlock). `Waves` is constructed with
`() => challenges.unlockedSections()`; `recipesForWave` intersects that with the
day pool (`WAVE_GROUPS`), so a section spawns once it's **both** unlocked AND
wave-reached. Junior Scoop is always unlocked (the tutorial singles); Sets 1–5 hand
out the other six (see the ladder table). Each section carries a placeholder `emoji`
([game/recipes.js](js/game/recipes.js) `GROUPS`, looked up via `GROUP_BY_ID`) for the
unlock coin + the challenge reward label.

### Open ideas (not built)

- **Set 10 cutscene.** Set 10 currently rewards nothing (`rewards: []`) — the
  intended payoff is a short "you beat the game" cutscene, TBD.
- **Section emojis are placeholders.** 🍨/☯️/🎭/🎪/🥈/🎨 stand in for real section
  art on the unlock coin + reward label, same as the customer-face placeholders.
- **Reward variety.** Sets 6–10 are single-reward; once there are more reward types
  (cosmetics, etc.) the later sets could grant small bundles like Sets 1–5 do.

---

## Scripted Tutorial

**Status:** SHIPPED 2026-06-17, restructured 2026-06-18 into the five-phase
"introduce-then-rely-on-it" flow below. Day 0 is no longer a passive hint overlay on a
real wave — it's a fully SCRIPTED, one-beat-at-a-time onboarding driven by a step machine
in `TippingTutorial` ([game/modes/tipping.js](js/game/modes/tipping.js)). The class
holds `step` / `_phase` / per-beat scratch, sets `this.bubbles` (canvas speech pills
drawn by `draw`) + `this.dayHintText` (the `#dayHint` gauge callout), and advances by
POLLING world state each `update` (no bus listeners → nothing leaks across runs).

### Design principle: introduce a mechanic, then rely on it

Each phase teaches ONE verb and the next phase assumes it. Scoops are **ghost-plopped**
onto the cone for the whole guided run — catching from the sky isn't introduced until the
final stretch, so the player never juggles two new skills at once. Likewise patience is
OFF until it's explicitly taught, then ON for good.

### The control hooks it borrows

- **Freeze = pause.** `player.frozen` stops movement AND — because `game._deliver` /
  `game._pop` also bail on `frozen` — serving and swiping. So a "frozen" beat is a full
  pause the player can't act through. Used for every plop, the death demo (frozen ~1.3×
  REACH out so they can't serve mid-lesson), and the tip note. The pop + deliver beats
  UNFREEZE — they need the swipe/serve verbs — and just instruct.
- **Ghost plop, not catch.** Guided scoops are plopped onto the cone via an eased ghost
  animation (`_startPlops` / `_advancePlops` → `pl.push`), never caught from the sky. The
  pop lessons plop "junk" colors on top of the wanted (bottom) scoop so there's something
  to swipe off.
- **Stage customers.** `shop.scripted = true` suspends auto-spawn/reconcile;
  `shop.spawnScripted(slot, colors, { value, character, tip })` injects exact customers
  (pins the same `character` when the demo customer resurrects; attaches the tip coin).
  Every guided customer sits ≥1 slot from where the cone ends up (slot spacing > serve
  REACH), so each beat also rehearses moving.
- **Control the sky.** `field.setSpawnPaused(true)` stops the random spawner for the
  guided beats (only ghost plops appear); the final stretch resumes it at a GENTLE cap
  (`field.setMaxLive(2)`, vs the mode's 7) so the first real catching isn't a firehose.
  `_cleanup` restores the mode cap for Day 1.
- **Patience demo.** `world.freezePatience` (separate from `tutorialActive`) freezes the
  countdown for phases 1–2; the death demo drains one customer's `order.timeLeft` by hand,
  sets them angry + calls `world.onExpire(1)` (real health drop + shake — the damage
  STANDS). From phase 3 on patience runs for REAL; guided customers that time out simply
  resurrect (you keep the damage) so the script can't soft-lock.

### The five phases (9-step machine)

1. **Move + deliver, patience OFF** (steps 1–3): plop a scoop on the frozen cone → "move
   left and right" → "tap to deliver" #1 → "+50" pill.
2. **Patience demo, must move to the customer** (steps 4–5): ghost a scoop, carry it to #2,
   then a scripted drain → angry → leaves → health drops; resurrect #2 and deliver for real
   (still no-fail).
3. **Patience ON, escalating pop lessons** (steps 6–7): a plain 1-scoop delivery, then a
   2-scoop and a 3-scoop cone where the customer wants the BOTTOM scoop — "swipe up to toss
   the top scoop" to dig down to it (one pop, then two to master).
4. **A tip** (step 8): a coin-tipped customer, paused to read "tips can be power-ups",
   delivered with a ghost scoop and patience on.
5. **Catching, hands-off** (step 9): hand off to real play — sky scoops resume (gentle cap),
   patience on, no more ghosts. The "complete orders until the day is done" gauge callout
   appears **after the first real delivery**; the remaining customers run unguided with
   REAL patience/health (a careless player can die). Day 0 completes on the **11th serve**
   (`WAVE0_GOAL = 11`, serve-count based — see waves.js): 6 guided + 5 free-play.

### Scoring is neutered for the whole tutorial

Combos and perfect catches are OFF while `world.tutorialActive` is true, so the tutorial
can't be used to cheese a score (they're discovered through real play): `world._onCatch`
zeroes `perfect`; `shop.comboEnabled` (driven each step from `!tutorialActive`) keeps
combo at 0 / multiplier 1 / the combo HUD hidden; and the combo breaker is gated off.

### Settings replay = SANDBOX

Triggering the tutorial from Settings AFTER it's been cleared (`forceTutorial &&
challenges.firstSetCleared()`) is a no-progress sandbox: `challenges.setFrozen(true)`
makes every recorder / `commitEarned` / `advanceSet` a no-op, and `world.tutorialSandbox`
makes `rollTip` pay **coins only**. A first play is the real thing.

### Tutorial end → Set 2 (no "finish your run")

The Day-0→Day-1 transition is special. `game._beginWaveTransition` tags it `'first'`
(real play) or `'replay'` (sandbox). In `hud._afterUnlocks`, `'first'` calls
`challenges.advanceSet()` and fades the day-complete panel to **Set 2's** rows (Day-1's
challenges) instead of the "finish this run to unlock the next set" nudge; `'replay'`
leaves challenges untouched. Normal mid-game day-ends are unchanged.

### Open ideas (not built)

- **Skip control during the unlock queue / beats.** Hitting Play already resumes; an
  explicit "skip tutorial" affordance could help repeat testers.
- **Richer faces during the patience demo.** Today it relies on the patience ring + the
  final angry face; intermediate "worried" expressions would sell the lesson harder.

---

## Mobile Performance — heat / battery / black flashes

**Status:** main pass shipped 2026-06-11 — baked glows, gradient/tint caches,
guarded HUD writes, display-rate rendering with sim interpolation, synchronous
resize repaint. Remaining options if a device is still hot: ocean
simplification (coarser `step`, fewer layers) and a 30fps battery-saver toggle.

### Symptom
Game flashes black on mobile, phone gets hot and drains battery early in play. Suspected to correlate with the sprite renderer, possibly back to the engine separation.

### Diagnosis
**Not a memory leak.** Particles are culled in `effects.update`, domain events fire only on discrete actions (catch/serve/expire — never per-frame), bus listeners are wired once, and the sprite renderer loads 3 sheet images at startup and allocates nothing per frame. The symptoms read as **sustained GPU load (over-painting)**, not a growing heap. Before chasing a leak, confirm the JS heap is flat in DevTools.

### Already shipped (no visual change)
- **`shadowBlur` → baked glow sprites** (`view/glow.js`) — customer bubble +
  tip-badge glows, the active power-up ring, the cone flash, and the tutorial
  pills now blit cached halo canvases instead of running a Gaussian blur per
  fill/stroke per frame. This was the top item in the cost table below.
- **Gradient + color-math caches** — the day-cycle state (`dayCycle.js`), the
  sky/sun gradients, the ocean tint hex math, and the water-body gradient
  (`scene.js`) are memoized; they only change on serves but were rebuilt 60×/s.
  The rainbow order swatch is baked once (`stations.js`).
- **`backdrop-filter` removed** from the HUD panel + pause/fullscreen buttons —
  it re-blurred the canvas backdrop on every painted frame.
- **Guarded per-frame DOM writes** — `Hud.setScore/setHealth/setGauge/setCombo`
  early-out (with quantization) when nothing visibly changed, so the gauge's
  SVG drop-shadow filter and the bar transitions stop invalidating every frame.
- **Display-rate rendering + sim interpolation** — replaces the earlier 60fps
  render cap, which judders on 90 Hz panels (paints every 2nd vsync = 45fps
  over a 60 Hz sim → 1,1,2 sim steps per painted frame). The loop now renders
  every rAF and the view lerps movers (scoop y, cone x, customer x/yOff,
  served-scoop flights) by the leftover-step alpha.
- **Synchronous repaint after canvas realloc** — `canvas.width =` wipes the
  backing store; `_resize` now redraws in the same task, killing the **black
  flash** on URL-bar/fullscreen changes (debounce alone still flashed once).
- **`loop.stop()` actually stops** — it used to re-arm mid-tick and render the frozen scene forever after game over.
- **Debounced window `resize`** — the mobile URL-bar show/hide fires a burst of resizes; coalesced into one after it settles.
- **`#stage` rect cached** for the touch layer's `_toVirtual` — it ran
  `getBoundingClientRect()` (a layout pass) on every pointermove, mid-drag.

### Per-frame cost distribution (estimate — active play, ~5 customers)
Ranked by op type, **not** a device profile; ordering is reliable, percentages are rough.

| Cost | ~Share | Why |
| --- | --- | --- |
| **`shadowBlur` glows** (customer speech-bubble + tip-badge glows, ×customers) | **~35–50%** | per-frame Gaussian blur passes; scale with customer count (~10–15 blurs/frame at 5 customers) |
| **Full-screen gradient fills** (sky linear + sun/moon radial) | ~10–20% | paints every canvas pixel via a gradient shader |
| **Ocean** (~6 full-width path fills/strokes + gradient + per-frame `mixHex`/`scaleHex` string allocs) | ~10–20% | many large path fills over the lower band |
| **Sprites** (`drawImage`: scoops + faces + mini-cones) | ~5–10% | GPU-cheap textured quads |
| **Effects** (particle arcs + pop-text) | ~5% | bursty |
| **Off-canvas HUD repaint** (`styles.css` has ~31 `box-shadow`/`backdrop-filter`/`blur`; gauge + combo widths change every frame via `_syncHud`) | hidden but real | `backdrop-filter` re-composites the backdrop on each repaint |

### Remaining options (only if a device is still hot after the shipped pass)
1. **Ocean simplification** — coarser `step` (e.g. `W/40`), fewer wave layers.
   The tint math + water gradient are already cached; the remaining cost is the
   ~5 full-width polyline fills per frame.
2. **Battery-saver toggle** — an optional reduced-render mode for weak/old
   phones. NOTE: a plain fps cap was tried and **reverted** — capping below the
   display rate makes painted frames advance uneven sim-step counts (judder on
   90 Hz panels). A battery saver should instead skip ALTERNATE vsyncs only
   when the measured refresh rate is an exact multiple of the target.

**Ruled out — scoops as squares instead of circles:** scoops already render as `ctx.drawImage` (textured quads); the `ctx.arc` circle path is only the offline fallback when a sheet hasn't loaded, so there are no circle fills in normal play. Shape isn't the cost.

### How to measure (do before/after)
- **Remote-debug the phone.** Chrome DevTools → Performance: record ~5 s of play, read the Scripting / Rendering / **Painting** split + long tasks. iOS → Safari Web Inspector → Timelines.
- **Debug → Show FPS** overlay for the aggregate — after the interpolation
  change it should read the display's native rate (60/90/120), with motion
  smooth at all of them.
