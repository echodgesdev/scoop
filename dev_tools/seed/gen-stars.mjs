// seed/gen-stars.mjs
// Bakes the night-sky star field — was `Array.from({length:60}, () => ({ x:
// Math.random(), … }))` rolled once at module load in js/scene.js — into a
// static array, so there's no load-time randomness and the sky is identical
// every run. Deterministic (seeded PRNG), so re-running reproduces the SAME
// field; tweak the seed/count below to reshuffle.
//
// Run:  node seed/gen-stars.mjs
// Then paste the printed `const STARS = [...]` block into js/scene.js.

const COUNT = 60;
const SEED = 0x5c008; // change to reshuffle the (still-deterministic) layout

// mulberry32 — tiny deterministic PRNG (so regeneration is reproducible).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
const r2 = n => Number(n.toFixed(2));
const r4 = n => Number(n.toFixed(4));

// Same shape + ranges as the original: x across the sky, y in the upper 62%,
// r = dot radius, tw = static twinkle brightness. Draw order matches the old
// object literal (x, y, r, tw) so the distribution is equivalent.
const stars = Array.from({ length: COUNT }, () => ({
  x:  r4(rng()),
  y:  r4(rng() * 0.62),
  r:  r2(rng() * 1.4 + 0.4),
  tw: r2(0.55 + rng() * 0.45)
}));

const out = ['const STARS = ['];
for (const s of stars) out.push(`  { x: ${s.x}, y: ${s.y}, r: ${s.r}, tw: ${s.tw} },`);
out.push('];');
console.log(out.join('\n'));
console.error(`# ${stars.length} stars (seed ${SEED.toString(16)})`);
