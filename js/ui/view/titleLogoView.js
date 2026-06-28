// @ts-check
// The title "sign" logo, drawn ON THE CANVAS (not the DOM) during the attract
// screen. Canvas — not a CSS overlay — so it can anchor to the cone's real world
// coordinates: the sign's arrow points down-left at the scoop, so we place it by
// pinning the ARROW TIP to the cone and letting the rest of the sign hang up-and-
// right of it. The composition is asymmetric (the arrow weights the lower-left),
// so anchoring the tip — rather than centering the bounding box — is what keeps it
// from reading lopsided. Fades itself in while the attract screen shows and out on
// tap, easing off the shared clock (see game.clock).

import { CONE } from '../../game/config.js';

const LOGO_SRC = 'assets/logo_sheet.png';
const ART_W = 702, ART_H = 800;         // intrinsic art size (for the aspect ratio)

// === Placement knobs — TUNE these to land the arrow tip on the scoop ===========
// Width of the sign as a fraction of the play-area width (≈ the old CSS min(50vw)).
const WIDTH_FRAC = 0.50;
// The arrow TIP's position within the art, normalized 0..1 (x from left, y from top).
// Dialed in LIVE. Profiling the pink arrow region put the geometric arrowhead point
// near ~0.43/0.89; 0.57/0.93 composes better in-game — pinning a touch PAST the tip
// lets the sign sit more centered while the arrow still reads as aimed at the cone.
// (An earlier auto-measure grabbed the bottommost pixel — the vertical shaft's base
// at ~0.155 — which aimed the shaft, not the head.) Pinned to the cone target below;
// the sign hangs up-and-right from it — asymmetric, so it doesn't read lopsided.
const TIP_NX = 0.57, TIP_NY = 0.93;
// Cone-relative target for the tip, in world px. The cone center is (player.x,
// CONE.Y); aim ABOVE it so the arrow lands on the scoop stack, not the bowl. This
// is the main alignment knob now that the tip is measured — nudge to taste.
const TARGET_DX = 0;
const TARGET_DY = -80;
// Fade ease rate (per second) toward shown/hidden.
const FADE_PER_S = 3.2;
// Slow idle "breathing": a gentle scale pulse. Kept whisper-subtle so the vintage
// sign reads solid, not like a cheap zoom loop. It scales ABOUT the arrow tip (dx/dy
// derive from the scaled size below), so the tip stays glued to the cone as it breathes.
const PULSE_AMP = 0.009;   // ±2.5% scale
const PULSE_SPEED = 1.7;   // rad/s → ~3.7s period
// ================================================================================

const img = new Image();
img.src = LOGO_SRC;

let _alpha = 0;
/** @type {number | null} */
let _lastClock = null;

/**
 * Draw the title sign, anchored to the cone, with a self-managed fade. Called every
 * frame from renderer.drawFrame (inside the shake transform, same space as the
 * cone); it no-ops cheaply when fully hidden, so it's safe to call during play too.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../../game.js').Game} game
 */
export function drawTitleLogo(ctx, game) {
  const showing = game.flow.showAttractLogo;

  // dt from the shared clock (no extra plumbing); clamp so a tab-switch hitch or the
  // first frame doesn't snap the fade.
  const dt = _lastClock == null ? 0 : Math.min(0.05, Math.max(0, game.clock - _lastClock));
  _lastClock = game.clock;
  _alpha += ((showing ? 1 : 0) - _alpha) * Math.min(1, dt * FADE_PER_S);

  if (_alpha < 0.01) { if (!showing) _alpha = 0; return; }   // fully hidden — skip
  if (!img.complete || !img.naturalWidth) return;            // art not loaded yet

  const pulse = 1 + PULSE_AMP * Math.sin(game.clock * PULSE_SPEED);
  const w = game.bounds.width * WIDTH_FRAC * pulse;
  const h = w * (ART_H / ART_W);
  const targetX = game.world.player.x + TARGET_DX;   // cone is centered at player.x on attract
  const targetY = CONE.Y + TARGET_DY;
  const dx = targetX - TIP_NX * w;                   // pin the arrow tip to (targetX, targetY)
  const dy = targetY - TIP_NY * h;

  ctx.save();
  ctx.globalAlpha = _alpha;
  ctx.drawImage(img, dx, dy, w, h);
  ctx.restore();
}
