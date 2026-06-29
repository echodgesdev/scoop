// @ts-check
// Shared easing curves for UI entrances. One leaf module so the views
// (titleLogoView, playerView, …) share a single implementation.

/**
 * Ease-out "back": overshoots past 1 near the end, then settles — the springy
 * landing used for the title-screen entrances (the logo + cone bounce down from
 * above, the buttons bounce up from below). t in [0, 1].
 * @param {number} t @returns {number}
 */
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
