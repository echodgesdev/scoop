// @ts-check
// Fixed virtual-resolution presets. Game logic runs entirely in these units;
// the canvas backing store is sized to the chosen preset and the element is
// letterboxed (scaled, aspect-preserved, centered) into whatever viewport it
// lives in. Switching aspect is a debug affordance — see DebugPanel.
//
// Design note: scalability comes BEFORE reactivity here. Everything positions
// itself as a fraction of these constant bounds, so the same layout reads
// identically at any window size or in fullscreen.

/** @typedef {{ width: number, height: number }} Dims */

// Heights are chosen so the fixed-size assets (cone = 110px tall) read at a
// comfortable fraction of the screen — the portrait default puts the cone at
// ~1/16 of height, which keeps a tall scoop stack from towering and spreads
// the customer slots far enough apart that the speed power-up earns its keep.
// Assets are NOT rescaled per aspect; a bigger logical canvas simply zooms the
// whole scene out in proportion.
//
// 3:4 is the default (vertical play suits top-fall / bottom-serve). The
// landscape entries are standard photography ratios, offered as debug
// experiments via the aspect selector.
// Scale split halfway between the first (960×1280) and zoomed-out (1320×1760)
// portrait passes — cone lands at ~1/14 of height: not towering, not cramped.
// All entries hold their exact ratio; a bigger logical canvas just zooms the
// scene out in proportion (assets are never rescaled per aspect).
/** @type {Record<string, Dims>} */
export const ASPECTS = {
  '3:4':  { width: 1140, height: 1520 }, // portrait — default
  '9:16': { width: 1080, height: 1920 }, // portrait — tall
  '4:3':  { width: 1520, height: 1140 }, // landscape
  '3:2':  { width: 1560, height: 1040 }, // landscape (35mm)
  '16:9': { width: 1664, height: 936 }   // landscape (widescreen)
};

export const DEFAULT_ASPECT = '9:16';

/** @param {string} name @returns {Dims} */
export function virtualDims(name) {
  return ASPECTS[name] || ASPECTS[DEFAULT_ASPECT];
}

// === Responsive ("Auto") sizing ==============================================
// Default mode: the virtual canvas matches the *device's* aspect so it fills
// the screen edge-to-edge (native feel on mobile) instead of letterboxing.
// Height is fixed so the gameplay scale (cone size vs. screen) is constant; the
// width flexes with the viewport, clamped to a portrait range. On a wide
// desktop the aspect caps at 3:4, leaving a centered portrait column (usable,
// not stretched). At 3:4 the dims equal the fixed preset, so portrait phones
// and the old default render identically.
export const BASE_HEIGHT = 1520;
export const MIN_ASPECT = 0.42;  // tallest allowed (~20:9 phones)
export const MAX_ASPECT = 0.75;  // widest allowed (= 3:4; desktop column cap)

/**
 * Virtual dims matching the viewport aspect, clamped to the portrait range.
 * @param {number} availW @param {number} availH @returns {Dims}
 */
export function responsiveDims(availW, availH) {
  const ar = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, availW / availH));
  return { width: Math.round(BASE_HEIGHT * ar), height: BASE_HEIGHT };
}

/**
 * Fit a vw×vh rectangle inside (availW, availH) preserving aspect ratio,
 * centered — i.e. classic letterbox. Returns the display rect (CSS px) and
 * the uniform scale applied.
 * @param {number} availW
 * @param {number} availH
 * @param {number} vw
 * @param {number} vh
 * @returns {{ left: number, top: number, width: number, height: number, scale: number }}
 */
export function fitRect(availW, availH, vw, vh) {
  const scale = Math.min(availW / vw, availH / vh);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);
  const left = Math.round((availW - width) / 2);
  const top = Math.round((availH - height) / 2);
  return { left, top, width, height, scale };
}
