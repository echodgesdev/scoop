// @ts-check
import { PICKUP_TYPE } from './game/config.js';
import { PICKUPS } from './ui/powerupVisuals.js';

/** @typedef {import('./game.js').Game} Game */

/**
 * Presentation reactions: subscribe sound + haptics + effects + HUD to the
 * high-level domain events the simulation emits. The sim just mutates state and
 * emits; all the juice (bursts, pops, shakes, dings, buzzes) lives here, the one
 * seam where the model meets the senses. Called once at construction.
 * @param {Game} game
 */
export function wireReactions(game) {
  // Fire the Sound method named in a pickup's descriptor (the table is the one
  // place type → palette/name/sound lives). Falls back to the generic trigger.
  /** @param {string} type a PICKUP_TYPE value */
  const playPickupSound = (type) => {
    const def = PICKUPS[type];
    const fn = def && /** @type {any} */ (game.sound)[def.sound];
    if (typeof fn === 'function') fn.call(game.sound);
    else game.sound.powerupTrigger();
  };

  game.bus.on('catch', ({ scoop, perfect }) => {
    // The scoop is already on the stack, so its height (0-based) is the pitch
    // step: each added scoop rings the next degree up the pentatonic scale.
    game.sound.catch_(game.world.player.stack.length - 1);
    if (perfect) {
      // Perfect catch: layer the sparkle ding + burst + flash over the pitched
      // note, but no "Perfect!" word — floating text is reserved for the recipe
      // name on serve.
      const top = { x: scoop.x, y: game.world.player.stackTopY() };
      game.sound.perfect();
      game.haptics.catch_();
      game.effects.burst(top.x, top.y, ['#fff', game.world.shop.hex(scoop.color)], 10);
      game.world.player.triggerFlash(0.25);
    }
  });

  game.bus.on('trayFull', () => {
    game.sound.bad();
    game.haptics.error();
    game.effects.addShake(8);
    game.effects.flashHurt(0.2);
  });

  // Order completed: confetti burst at the customer. No floating text — points
  // ride the HUD score, combo rides the HUD combo meter, and flavor names surface
  // via the discovery toast (below) + the end-of-day reveal coins.
  game.bus.on('serve', ({ colors, x, y }) => {
    game.effects.burst(x, y, colors.map(c => game.world.shop.hex(c)));
    game.world.player.triggerFlash();
    game.effects.addShake(6);
    game.sound.match();
    game.haptics.serve();
  });

  // First time a recipe is completed: a quick toast naming the new flavor.
  game.bus.on('discover', ({ name }) => {
    if (name) game.hud.showDiscoveryToast(name);
  });

  game.bus.on('serveFail', () => {
    game.sound.bad();
    game.haptics.error();
    game.effects.addShake(4);
  });

  // A scoop physically left the tray toward a customer — burst at the cone
  // source (fires on every accepted handoff: partial, complete, each scoop of a
  // whole-tray serve).
  game.bus.on('handoff', ({ x, y, color }) => {
    game.effects.burst(x, y, [game.world.shop.hex(color), '#fff'], 10);
  });

  // Accepted but the order still needs more — the "✓" tick at the customer.
  // Plays the dedicated delivery sound, NOT the pentatonic stack tone (handing a
  // scoop over isn't a stack pop). Completing the whole order rings match() above.
  game.bus.on('partialServe', ({ x, y }) => {
    game.sound.deliver();
    game.effects.popText(x, y, '✓', { color: '#43aa8b', size: 22, life: 0.5 });
  });

  // The combo chain decayed (patience timeout) — a soft "lost it" beep.
  game.bus.on('comboLost', () => {
    game.sound.bad();
  });

  // A power-up fired. Palette + per-type sound come straight from the PICKUPS
  // table (ui/powerupVisuals.js) — the one place a token's look/sound lives.
  // Power-up fired: a conical vortex of colored shards spiralling up around the
  // CONE and dissipating — no text. (Names live in the Power-ups Journal tab; the
  // in-play read is purely the color.)
  game.bus.on('powerup', ({ type }) => {
    const p = game.world.player;
    const cx = p.x, cy = p.y;
    const height = cy - p.scoopPosition(5).y;   // funnel fades out ~5 scoops tall
    const def = PICKUPS[type];
    const palette = (def && def.palette) || ['#ffd700', '#ffb703', '#ffe9a0']; // fallback gold
    game.effects.vortex(cx, cy, palette, height);
    game.world.player.triggerFlash(0.2);
    playPickupSound(type);
    game.haptics.powerup();
  });

  // Combo-breaker crescendo over the normal power-up FX: extra ding, shake,
  // confetti, banner. The power-up itself fires via its own 'powerup' event.
  game.bus.on('comboBreak', ({ x, y }) => {
    game.sound.perfect();
    game.effects.addShake(12);
    game.effects.burst(x, y, ['#ffec5c', '#ff6fa3', '#7fe3c4', '#6a8cff', '#fff'], 36);
  });

  // Toss-top (upward gesture): launch a stretch-and-fade ghost of the popped
  // scoop, a small puff, and the "let go" beep.
  game.bus.on('discard', ({ x, y, color }) => {
    game.world.player.launchToss(color, x, y);
    game.effects.burst(x, y, [game.world.shop.hex(color), '#fff'], 10);
    game.sound.catch_(game.world.player.stack.length - 1);
  });

  // Coin tip ($): a yellow/orange vortex spiralling up around the cone — no text.
  // Points still land on the HUD score counter.
  game.bus.on('coin', () => {
    const p = game.world.player;
    const cx = p.x, cy = p.y;
    const height = cy - p.scoopPosition(5).y;   // funnel fades out ~5 scoops tall
    game.effects.vortex(cx, cy, PICKUPS[PICKUP_TYPE.COIN].palette, height);
    playPickupSound(PICKUP_TYPE.COIN);
  });

  // A challenge requirement was newly met — bottom-of-screen toast.
  game.bus.on('challengeEarned', ({ title }) => {
    game.hud.showChallengeToast({ title });
  });

  game.bus.on('expire', () => {
    game.sound.expire();
    game.haptics.expire();
    game.effects.addShake(12);
    game.hud.flashHealthDamage();
    game.effects.flashHurt(0.35);
  });

  game.bus.on('phaseUp', () => {
    game.hud.flashPhaseUp();
    game.sound.phaseUp();
    game.haptics.phaseUp();
    game.effects.addShake(4);
    const c = game.hud.gaugeCenter();
    if (c) game.effects.burst(c.x, c.y, ['#ffd166', '#fff'], 14);
  });

  game.bus.on('waveUp', () => {
    // The day number rolls over at night-end (Game._frame), NOT here — the gauge
    // is held by _dayRolling so it doesn't jump ahead during the cashout/transition.
    game.hud.flashWaveUp();
    game.sound.levelUp();
    game.haptics.wave();
    game.effects.addShake(14);
    const c = game.hud.gaugeCenter();
    if (c) game.effects.burst(c.x, c.y, ['#ffec5c', '#ffd166', '#ff6fa3', '#7fe3c4'], 60);
  });
}
