// @ts-check
/** @typedef {import('./game.js').Game} Game */

/**
 * Presentation reactions: subscribe sound + haptics + effects + HUD to the
 * high-level domain events the simulation emits. The sim just mutates state and
 * emits; all the juice (bursts, pops, shakes, dings, buzzes) lives here, the one
 * seam where the model meets the senses. Called once at construction.
 * @param {Game} game
 */
export function wireReactions(game) {
  game.bus.on('catch', ({ scoop, perfect }) => {
    if (perfect) {
      const top = { x: scoop.x, y: game.player.stackTopY() };
      game.sound.perfect();
      game.haptics.catch_();
      game.effects.burst(top.x, top.y, ['#fff', game.shop.hex(scoop.color)], 10);
      game.effects.popText(top.x, top.y - 24, 'Perfect!', { color: '#ffec5c', size: 22, life: 0.7 });
      game.player.triggerFlash(0.25);
    } else {
      game.sound.catch_();
    }
  });

  game.bus.on('trayFull', () => {
    game.sound.bad();
    game.haptics.error();
    game.effects.addShake(8);
    game.hurt = 0.2;
  });

  game.bus.on('serve', ({ gained, colors, combo, x, y }) => {
    game.effects.burst(x, y, colors.map(c => game.shop.hex(c)));
    game.effects.popText(x, y, `+${gained}`, { color: '#ffec5c', size: 28 });
    if (combo > 1) {
      game.effects.popText(x, y - 30, `${combo}× combo!`, { color: '#ff6fa3', size: 20, life: 0.8 });
    }
    game.player.triggerFlash();
    game.effects.addShake(6);
    game.sound.match();
    game.haptics.serve();
  });

  game.bus.on('serveFail', () => {
    game.sound.bad();
    game.haptics.error();
    game.effects.addShake(4);
  });

  game.bus.on('expire', () => {
    game.sound.expire();
    game.haptics.expire();
    game.effects.addShake(12);
    game.hurt = 0.35;
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
    // The "WAVE N!" banner fires at the next-wave start (Game._frame, on
    // night-cycle completion), not here.
    game.hud.setGauge(game.waves.wave, 1);
    game.hud.flashWaveUp();
    game.sound.levelUp();
    game.haptics.wave();
    game.effects.addShake(14);
    const c = game.hud.gaugeCenter();
    if (c) game.effects.burst(c.x, c.y, ['#ffec5c', '#ffd166', '#ff6fa3', '#7fe3c4'], 60);
  });
}
