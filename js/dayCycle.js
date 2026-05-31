// @ts-check
import { groundYFor } from './config.js';

/**
 * Day cycle driven by wave-gauge progress (0..1). Five keyframes — dawn,
 * morning, noon, afternoon, sunset — interpolate as the gauge fills, matching
 * the four phase checkpoints (0.25 / 0.50 / 0.75 / 1.00). The sun arcs from
 * the lower-left horizon, peaks overhead at midday, and dips to the lower-
 * right by sunset, then snaps back to dawn for the next wave. Horizon is
 * pinned to groundY so the sun rises from behind the sand.
 */

// Index into KEYFRAMES = round(fraction * 4). Continuous lerping in between.
const KEYFRAMES = [
  { // 0.00 — Dawn
    skyTop:    '#ff9b6b',
    skyBottom: '#ffd9b3',
    sunColor:  '#ffb15c',
    sunGlow:   0.75,
    floor:     '#e8b97a'
  },
  { // 0.25 — Morning
    skyTop:    '#7fc8f0',
    skyBottom: '#fff1d4',
    sunColor:  '#fff3a0',
    sunGlow:   0.55,
    floor:     '#f3d9a1'
  },
  { // 0.50 — Midday
    skyTop:    '#4fb6f0',
    skyBottom: '#cee9f7',
    sunColor:  '#fff8c0',
    sunGlow:   0.50,
    floor:     '#f7e0a0'
  },
  { // 0.75 — Afternoon
    skyTop:    '#9d8ec4',
    skyBottom: '#ffc28a',
    sunColor:  '#ffcb6b',
    sunGlow:   0.70,
    floor:     '#d99a5e'
  },
  { // 1.00 — Sunset
    skyTop:    '#352b5c',
    skyBottom: '#ff7a3a',
    sunColor:  '#ff6f3c',
    sunGlow:   1.00,
    floor:     '#6f4d3a'
  }
];

function hexToRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHex(c) {
  const part = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + part(c.r) + part(c.g) + part(c.b);
}

function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t
  });
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Night cycle keyframes for the between-wave reset: dusk → midnight → pre-dawn.
// The last frame leans toward the day cycle's Dawn so it blends into the next
// wave's opening sky. `star` is the star-field opacity at that keyframe.
const NIGHT_KEYFRAMES = [
  { skyTop: '#241a44', skyBottom: '#7a3f48', floor: '#3a2b39', star: 0.25 }, // dusk
  { skyTop: '#070a22', skyBottom: '#141d3e', floor: '#161d36', star: 1.00 }, // midnight
  { skyTop: '#5a4f86', skyBottom: '#ffb487', floor: '#b78a5c', star: 0.10 }  // pre-dawn
];

/**
 * Sped-up night cycle for the between-wave reset (fraction 0..1). The crescent
 * moon arcs across like the sun does in the day cycle; the sky races through
 * dusk → midnight → pre-dawn and the star field fades in at the midpoint.
 * @returns {{ skyTop: string, skyBottom: string, floor: string, starAlpha: number, moonX: number, moonY: number, moonR: number }}
 */
export function nightCycleState(fraction, bounds) {
  const t = Math.max(0, Math.min(1, fraction));
  const seg = t * (NIGHT_KEYFRAMES.length - 1);
  const i   = Math.min(NIGHT_KEYFRAMES.length - 2, Math.floor(seg));
  const lt  = seg - i;
  const A = NIGHT_KEYFRAMES[i];
  const B = NIGHT_KEYFRAMES[i + 1];

  const baseY     = groundYFor(bounds.height);
  const peakY     = bounds.height * 0.08;
  const arcHeight = baseY - peakY;

  return {
    skyTop:    lerpColor(A.skyTop, B.skyTop, lt),
    skyBottom: lerpColor(A.skyBottom, B.skyBottom, lt),
    floor:     lerpColor(A.floor, B.floor, lt),
    starAlpha: lerp(A.star, B.star, lt),
    moonX: lerp(bounds.width * 0.12, bounds.width * 0.88, t),
    moonY: baseY - arcHeight * Math.sin(Math.PI * t),
    moonR: 40
  };
}

/**
 * Compute the cycle state for a given waveFraction (0..1) and viewport bounds.
 * @returns {{ skyTop: string, skyBottom: string, sunX: number, sunY: number, sunR: number, sunColor: string, sunGlow: number, floor: string }}
 */
export function dayCycleState(fraction, bounds) {
  const t = Math.max(0, Math.min(1, fraction));

  // Locate the surrounding pair of keyframes.
  const seg = t * (KEYFRAMES.length - 1);
  const i   = Math.min(KEYFRAMES.length - 2, Math.floor(seg));
  const lt  = seg - i;
  const A   = KEYFRAMES[i];
  const B   = KEYFRAMES[i + 1];

  // Sun arc: horizon pinned to groundY so sunrise/sunset emerge from behind
  // the sand. Peak sits 10% from the top so it doesn't clip on small screens.
  const baseY     = groundYFor(bounds.height);
  const peakY     = bounds.height * 0.10;
  const arcHeight = baseY - peakY;
  const sunX = lerp(bounds.width * 0.10, bounds.width * 0.90, t);
  const sunY = baseY - arcHeight * Math.sin(Math.PI * t);

  return {
    skyTop:    lerpColor(A.skyTop, B.skyTop, lt),
    skyBottom: lerpColor(A.skyBottom, B.skyBottom, lt),
    sunColor:  lerpColor(A.sunColor, B.sunColor, lt),
    sunGlow:   lerp(A.sunGlow, B.sunGlow, lt),
    floor:     lerpColor(A.floor, B.floor, lt),
    sunX,
    sunY,
    sunR: 52
  };
}
