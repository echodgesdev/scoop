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
