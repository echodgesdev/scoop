// @ts-check
// The colour SOURCE OF TRUTH for everything that isn't a baked sprite sheet.
//
// Two render surfaces share these colours: the CANVAS (scoops' procedural glow,
// reactions, speech bubbles, effects) and the DOM/CSS HUD (buttons, gauges,
// modals). To stop the two surfaces drifting apart, the values live HERE once;
// `installPaletteVars()` mirrors the shared set into the document `:root` at boot
// so CSS can read them as `var(--go)` etc. while canvas code imports the JS objects
// directly. Edit a colour in ONE place; both surfaces follow.
//
// What is NOT here, on purpose:
//   • FLAVOUR identities (pink/mint/choco/vanilla/blueberry) — those are owned by
//     game/config.js because the SIM uses them (orders, recipes) and they're baked
//     into scoop_sheet.png / hud_scoop_sheet.png. We re-export them so rendering has
//     ONE import surface, but changing them means re-rendering those sheets too.
//   • Self-contained computed ramps (day/night sky in game/dayCycle.js, ocean tints)
//     — they're local to their module's maths; hoisting them here buys nothing.
//   • Pure HUD-chrome colours (waffle bevels, modal scrims, focus rings, debug) —
//     those stay in styles/ (see styles/base/tokens.css).

import { COLORS as FLAVOR } from '../game/config.js';

export { FLAVOR };

// === Semantic tokens =========================================================
// One token per MEANING. Where a colour reads as a small "ramp" (a bevelled
// button, a glow → core → shadow trio) the stops are grouped under that meaning,
// the same way the brown button bevel is one deliberate ramp — NOT drift.
export const SEMANTIC = Object.freeze({
  // GO — success / confirm / "this is servable". The mint FLAVOR colour is
  // deliberately NOT reused for this; flavour mint stays a flavour.
  go:        '#06d6a0',   // base — fills, rings, the servable bubble outline
  goHi:      '#2fe3b4',   // button bevel top
  goDeep:    '#04b58a',   // button bevel bottom
  goShadow:  '#038f6d',   // drop edge under a go button
  goInk:     '#16302a',   // dark text to sit ON `go` (white-on-go fails WCAG)

  // GOLD — reward / coins / score / stars. Three stops, one currency.
  gold:      '#ffd166',   // base
  goldHi:    '#ffec5c',   // highlight / sheen
  goldDeep:  '#ffb703',   // deep edge / glow

  // DANGER — destructive + the "you got hit" red.
  danger:       '#c1121f',  // canonical destructive (passes AA on white)
  dangerBright: '#ff3b3b',  // alert pulse / low-health flash

  // HEAT — the low-health gauge gradient (a distinct meaning from danger).
  heatHi:    '#ffcf4d',
  heatMid:   '#ff9e2c',
  heat:      '#e8631a',

  // PINK — combo / hearts / playful accents. Base IS the flavour pink, unified.
  pink:      FLAVOR.pink, // '#ff6fa3'
  pinkHi:    '#ff8fb3',
  pinkDeep:  '#e23a6e',

  // INK — the parlor "brown text" family, collapsed from eight near-dupes to three.
  ink:       '#3a2a1a',   // primary text (already ~13:1 on cream)
  inkMuted:  '#7a5230',   // secondary labels
  inkFaint:  '#9a8463',   // captions / disabled

  // OUTLINE — the dark sprite contour (scoops, cone). Shared so the customer rim
  // (ui/sprites/customerRenderer.js) can match the rest of the cast.
  outline:   '#2b1608',

  // Helper rim for vanilla scoops drawn on a cream ground (low edge contrast).
  vanillaRim: '#e8c36a'
});

// camelCase → kebab-case for the CSS custom-property name (goHi → --go-hi).
const kebab = k => '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

/**
 * Mirror the shared palette into the document `:root` as CSS custom properties so
 * stylesheets can use `var(--go)`, `var(--gold-hi)`, … Idempotent; guarded for
 * headless/test environments with no DOM. Call once at boot, before first paint.
 * @param {Document} [doc]
 */
export function installPaletteVars(doc = typeof document !== 'undefined' ? document : undefined) {
  if (!doc || !doc.documentElement) return;
  const root = doc.documentElement.style;
  for (const [k, v] of Object.entries(SEMANTIC)) root.setProperty(kebab(k), v);
  // Flavours too, so HUD CSS can reference them without a second literal.
  for (const [k, v] of Object.entries(FLAVOR)) root.setProperty('--' + k, v);
}
