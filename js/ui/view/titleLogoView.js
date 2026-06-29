// @ts-check
// The title "sign" logo, drawn ON THE CANVAS (not the DOM) during the attract
// screen, through the same SpriteSheet path as every other sprite (def in
// ui/sprites/logoSprite.js). Canvas — not a CSS overlay — so it anchors to the
// cone's real world coordinates and shares the world scale: the sign's arrow points
// down-left at the scoop, so we pin the ARROW TIP to the cone and let the rest of
// the sign hang up-and-right of it. The composition is asymmetric (the arrow weights
// the lower-left), so anchoring the tip — not centering the bounding box — keeps it
// from reading lopsided. Fades itself in while the attract screen shows and out on
// tap, easing off the shared clock (see game.clock).

import { SpriteSheet } from '../../engine/spriteSheet.js';
import LOGO_SPRITE from '../sprites/logoSprite.js';
import { CONE } from '../../game/config.js';

const logoSheet = new SpriteSheet(LOGO_SPRITE);

// === Placement knobs — TUNE these to land the arrow tip on the scoop ===========
// Sign width in FIXED WORLD px (like coneRenderer's CONE_SPRITE_W = 168), NOT a
// fraction of the viewport. The play-area WIDTH flexes with device aspect
// (viewport.js: a fixed 1520-tall canvas × 0.42–0.75 aspect → ~640px wide on a tall
// phone, ~1140px on a desktop column), so a width-fraction made the sign ~2× bigger
// on desktop than phone (and a too-small phone sign sat low enough to overlap the
// scoops). A world-px width reads identically on every device, like the cone/scoops.
const LOGO_W = 513;
// The arrow TIP's position within the art, normalized 0..1 (x from left, y from top).
// Dialed in LIVE. Profiling the pink arrow region put the geometric arrowhead point
// near ~0.43/0.89; 0.57/0.93 composes better in-game — pinning a touch PAST the tip
// lets the sign sit more centered while the arrow still reads as aimed at the cone.
const TIP_NX = 0.57, TIP_NY = 0.93;
// Cone-relative target for the tip, in world px. The cone center is (player.x,
// CONE.Y); aim ABOVE it so the arrow lands on the scoop stack, not the bowl.
const TARGET_DX = 0;
const TARGET_DY = -80;
// Fade ease rate (per second) toward shown/hidden.
const FADE_PER_S = 3.2;
// Slow idle "breathing": a gentle scale pulse, kept whisper-subtle so the vintage
// sign reads solid. It scales ABOUT the arrow tip (the anchor below derives from the
// pulsed size), so the tip stays glued to the cone as it breathes.
const PULSE_AMP = 0.009;   // ±~0.9% scale
const PULSE_SPEED = 1.7;   // rad/s → ~3.7s period
// ================================================================================

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

  const pulse = 1 + PULSE_AMP * Math.sin(game.clock * PULSE_SPEED);
  const scale = (LOGO_W * pulse) / logoSheet.frameW;   // sheet px → world px
  const w = logoSheet.frameW * scale, h = logoSheet.frameH * scale;
  const targetX = game.world.player.x + TARGET_DX;     // cone is centered at player.x on attract
  const targetY = CONE.Y + TARGET_DY;
  // SpriteSheet.draw centers the frame on the anchor, so offset the anchor by the
  // tip's distance from the frame center — landing the arrow tip on (targetX, targetY).
  const ax = targetX - (TIP_NX - 0.5) * w;
  const ay = targetY - (TIP_NY - 0.5) * h;

  ctx.save();
  ctx.globalAlpha = _alpha;
  logoSheet.draw(ctx, 'logo', 0, ax, ay, scale);       // no-ops (returns false) until the image loads
  ctx.restore();
}
