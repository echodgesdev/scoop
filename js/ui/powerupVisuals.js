// @ts-check
// The single home for how power-ups LOOK. Keyed by power-up type
// (heart / feather / pause / rainbow) plus the 'coin' points-tip. Today these
// are an emoji glyph + a ring color; when we move to sprites, the glyph map
// becomes a sprite/atlas lookup and only THIS file changes — every drawer
// (the on-cone active indicator, the customer tip token) reads from here.
//
// The type names stay "feather"/"pause" for code stability, but the icons are
// chosen for legibility (⚡ reads "fast", ❄️ "frozen"). 'coin' uses '$' because
// the coin emoji doesn't render everywhere.
export const PICKUP_ICONS = {
  heart:   '❤️',
  feather: '⚡',
  pause:   '❄️',
  rainbow: '🌈',
  coin:    '$'
};

export const PICKUP_RING_COLOR = {
  heart:   '#ff6fa3',
  feather: '#bfdcff',
  pause:   '#c9b6ff',
  rainbow: '#ffd166',
  coin:    '#ffd700'
};

// Display name + one-line description per token — for the Power-ups reference
// modal (view/hud.js). Names match the challenge reward labels.
export const PICKUP_NAME = {
  heart:   'Heart',
  feather: 'Speed',
  pause:   'Freeze',
  rainbow: 'Rainbow',
  coin:    'Coin Tip'
};
export const PICKUP_DESC = {
  heart:   'Patches you up — restores some health instantly.',
  feather: 'Your cone zips around faster for a few seconds.',
  pause:   "Freezes every customer's patience — serve with no clock ticking.",
  rainbow: 'Every scoop counts as any color — serve any order for a few seconds.',
  coin:    'A cash tip: bonus points, no power-up effect.'
};
