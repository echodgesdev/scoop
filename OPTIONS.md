# Design Backlog

Core gameplay + the big UX overhauls (feedback declutter, the Journal hub, the
week/difficulty model) are done — see **Shipped** at the bottom. What's left is
mostly **presentation, content, and polish**, not new mechanics. Top of the list is
the two open items from the original UX audit: **theming** and the **tutorial**.

---

## Theming — "full commit to the bit" (top remaining)

**Why:** the title "Poop in a Scoop" promises a gag the game doesn't pay off, so
players read it as "just ice cream." The decision (locked with the user) is to
**commit to the bit** — emoji-level cheeky, never crude, no new mechanics, each
change a clean revert point.

**Already in place (the hooks):**
- The brown scoop is the soft-serve **swirl** sprite (the 💩 read) — art shipped.
- Flavor names now have an **in-play home**: the discovery toast, the end-of-day
  reveal coin, and the Journal recipe coins. So renamed copy will actually land.

**Remaining work (copy + story, no code-shape changes):**
- **Rename into the cheeky voice** — the chocolate line + the group names + the
  recipe names. The triple-choco cone (the Poop customer's favorite,
  [customers.js](js/game/customers.js)) is the signature **"house special."**
  Names live in [recipes.js `GROUPS`](js/game/recipes.js).
- **Tagline / title copy** — [index.html](index.html) still reads the earnest
  "Serve the beach's freshest scoops!" Replace with a knowing one.
- **Customer blurbs** in the gag voice ([customers.js](js/game/customers.js)) —
  the Poop blurb "…how is he even ordering?" is the target tone.
- **Poop-customer narrative arc** — escalating one-line beats (the wave-transition
  Week header / day-complete card is the natural slot) building to the Poop reveal,
  turning the Set-9 unlock into an actual punchline.

**Cheapest probe:** rename the triple-choco recipe to the house special + one
tagline line — eyeball whether the bit lands before doing the full copy pass.

---

## Tutorial — discovery overhaul (biggest open audit item)

**Why (audit):** the tutorial is an impressive but heavy **scripted 10-step rail**
([TippingTutorial in modes/tipping.js](js/game/modes/tipping.js)) — it freezes the
cone, plops ghost scoops, stages exact customers, and even scripts the *failure*.
It teaches the verbs but deletes the "I figured it out" hit and is long before the
player actually plays.

**Direction:** shift toward the lighter model that already exists —
[`TutorialBase`](js/game/tutorial.js), a hint-overlay on a *real* Day 1 that watches
live state and prompts contextually. Specifically:
- Let Day 1 be genuinely playable; gate nothing.
- Show a contextual prompt only when the player is **stuck** (no input for N
  seconds) — let them discover catch / toss / pop by trying.
- Keep at most one scripted safety beat (the patience/fail demo) if needed.
- Add a **Skip** affordance (returning/testers).

---

## Polish / minor

- **Combo vocabulary.** The wave-end cashout still pops `Combo ×N → +gain`
  ([game.js](js/game.js) `_runWaveCashout`) — the last of the three combo phrasings
  the audit flagged (the rest now read off the HUD combo meter). Fold it into the
  one combo language, or accept it as the milestone payout.
- **Haptics nit.** `error()` double-buzzes on both tray-full and serve-fail
  ([haptics.js](js/engine/haptics.js)) — can feel naggy; consider a lighter cue.
- **Dead CSS sweep.** The Journal/stat-card refactors left unused rules behind:
  `.regular-card`, `.powerup-card`, `.recipe-row`/`.recipe-scoop`, `.stats-row`,
  `.stat`, `.record-pill` ([styles.css](styles.css)). Harmless, pending a cleanup.
- **"Reach Day N" challenges** read off the cumulative max day, so in later weeks
  they show pre-satisfied (the per-week day resets). Make them strictly per-week if
  it reads as a bug.

---

## Content / art (later)

- **Set 10 "you beat the game" payoff.** Week 10 currently rewards nothing
  (`rewards: []`) — a short cutscene / bragging-rights screen is TBD.
- **Sprite placeholders → real art.** Recipe-section emojis (🍨/☯️/🎭/🎪/🥈/🎨) and
  the power-up glyphs are emoji stand-ins on the unlock coins / Journal / tip
  tokens; swap to sprites when the art lands ([powerupVisuals.js](js/view/powerupVisuals.js),
  [recipes.js `GROUPS`](js/game/recipes.js)).

---

## Mobile perf (only if a device is still hot)

Main pass shipped (baked glows, gradient/tint caches, guarded HUD writes,
display-rate rendering with sim interpolation). If a weak device still runs hot:
- **Ocean simplification** — coarser `step` (e.g. `W/40`), fewer wave layers
  ([scene.js](js/view/scene.js) `drawOcean`); ~5 full-width polyline fills/frame remain.
- **Battery-saver toggle** — a reduced-render mode. NOTE: a plain fps cap was tried
  and **reverted** (judders on 90 Hz panels); a saver must skip *alternate vsyncs*
  only when the refresh rate is an exact multiple of the target.

---

## Shipped — don't re-propose

- **Combo cashout / "Star Power"** — designed in depth, then **TRIED & REJECTED** by
  users. Do not re-propose.
- **Feedback declutter** — power-up/coin text → cone swirl particles; removed
  `Perfect!`, the serve `+N`/combo lines, the per-scoop cashout `+N`, and the
  customer-bubble point value; new-flavor discovery → toast + end-of-day reveal coin.
- **Journal hub** — title is Play / 📔 Journal / ⚙ Settings; the four collections
  (Recipes / Regulars / Power-ups / Challenges) are tabs in one hub; each entry is a
  coin with a ring gauge (recipes /10, regulars /50, power-ups & coin /100); recipes
  show scoops stacked vertically; tap a coin for a detail card. 🏠 Home on pause /
  wave-transition / game-over.
- **Week / difficulty model** — `Set` → `Week`; the tutorial is its own Week 1 (Day 1);
  a per-week `dayInWeek` (1–7) drives difficulty + recipe complexity and **resets each
  week**; completing a Week (challenges + Day 7) advances mid-run; "Complete the Week"
  meter; a "Week N" sky title + a `3·2·1·START!` round-start countdown (sim frozen
  until START); the cone re-centers + the day number holds through the night sweep;
  end-of-day **and** game-over **stat cards** (Score / Combo Today / Longest Combo /
  Favorite); fixed the broken "use power-ups in a day" challenge.
- **Customer Regulars** — sprite roster, first-serve + mystery + challenge unlocks,
  collection screen, day-end coin-flip reveal, "serve a regular N times" challenges,
  favorite recipe.
- **Challenge Reward Ladder** — 10 Weeks, each the sole source of its feature(s)
  (coin / power-ups / regulars / recipe sections), with tip pacing.
- **Mobile perf main pass** — see the section above.
