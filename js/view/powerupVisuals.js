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
