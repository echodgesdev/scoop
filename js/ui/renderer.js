// @ts-check
import { drawEnvironment } from './scene.js';
import { drawField as drawScoopField } from './view/scoopsView.js';
import { drawPlayer } from './view/playerView.js';
import { drawActivePowerup } from './view/activePowerupView.js';
import { drawHitboxes, drawFps } from './view/debugView.js';
import { drawBanner, drawPauseOverlay } from './view/overlayView.js';

/** @typedef {import('../game.js').Game} Game */

/**
 * Draw one full frame. READS the game (its actors, effects, flags, banner, …)
 * and paints — never mutates.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Game} game
 * @param {number} [alpha] leftover sim-step fraction (0..1) — moving actors are
 *   drawn interpolated between their previous and current sim positions, so
 *   rendering at 90/120Hz over the 60Hz sim stays smooth.
 */
export function drawFrame(ctx, game, alpha = 1) {
  const { x, y } = game.effects.offset();
  ctx.save();
  ctx.translate(x, y);

  const world = game.world;
  const rainbow = world.powerups.rainbowActive;

  // Background: sky/sun (or the between-wave night cycle), sand, and ocean — the
  // actors below layer over the floor.
  drawEnvironment(ctx, game);

  drawScoopField(ctx, world.field, rainbow, alpha);
  drawPlayer(ctx, world.player, rainbow, alpha);
  const pausePatience = world.powerups.pauseActive || !game.flags.patternTimer;
  game.customers.draw(ctx, world.shop.list, {
    activeIndex:    world.shop.customerAt(world.player.x),
    canServe:       i => world.shop.canServe(i, world.player.colors(), rainbow),
    pausePatience,
    rainbow,
    time:           game.clock,
    tipLabel:       game.tutorial.active,
    coneX:          world.player.drawX(alpha),  // fades a bubble translucent as the cone passes behind it
    alpha
  });
  // Tutorial hint pills — over the scene but under the effect bursts.
  if (game.tutorial.active) game.tutorial.draw(ctx, game);
  game.effects.draw(ctx);

  drawHitboxes(ctx, game);

  // Screen-text overlays + flashes — all still inside the shake transform, so each
  // counteracts the (x, y) offset to stay screen-fixed.
  drawBanner(ctx, game, x, y);
  game.effects.drawHurt(ctx, game.bounds, x, y);
  drawPauseOverlay(ctx, game, x, y);

  ctx.restore();   // pop the shake transform

  // Screen-fixed (drawn after the shake transform is popped).
  drawActivePowerup(ctx, game);
  drawFps(ctx, game);
}

