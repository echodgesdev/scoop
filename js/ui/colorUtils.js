// @ts-check
// Tiny hex-color math shared by the scene's view layers (sky, ocean, clouds).
// Pure functions over '#rrggbb' strings — no canvas, no state. Kept in one leaf
// module so scene.js and the *View.js passes share a single implementation
// instead of each carrying its own copy (and so the views don't import back
// through scene.js, which would be circular).

/** Parse '#rrggbb' → { r, g, b } (0..255). */
export function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/** Serialize { r, g, b } → '#rrggbb', clamping each channel to 0..255. */
function toHex(c) {
  const p = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + p(c.r) + p(c.g) + p(c.b);
}

/** Blend hex a→b by t (0..1). */
export function mixHex(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

/** Multiply a hex color's brightness by f. */
export function scaleHex(hex, f) {
  const c = rgb(hex);
  return toHex({ r: c.r * f, g: c.g * f, b: c.b * f });
}

/** Perceptual-ish luminance 0..1. */
export function luminance(hex) {
  const c = rgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** '#rrggbb' + alpha → 'rgba(r, g, b, a)' (alpha clamped to 0..1). */
export function hexWithAlpha(hex, a) {
  const c = rgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, a))})`;
}
