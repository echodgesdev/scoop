// @ts-check
import { PICKUP_TYPE, HEART_HEAL_AMOUNT } from './game/config.js';

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
      const top = { x: scoop.x, y: game.world.player.stackTopY() };
      game.sound.perfect();
      game.haptics.catch_();
      game.effects.burst(top.x, top.y, ['#fff', game.world.shop.hex(scoop.color)], 10);
      game.effects.popText(top.x, top.y - 24, 'Perfect!', { color: '#ffec5c', size: 22, life: 0.7 });
      game.world.player.triggerFlash(0.25);
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
    game.effects.burst(x, y, colors.map(c => game.world.shop.hex(c)));
    game.effects.popText(x, y, `+${gained}`, { color: '#ffec5c', size: 28 });
    if (combo > 1) {
      game.effects.popText(x, y - 30, `${combo}× combo!`, { color: '#ff6fa3', size: 20, life: 0.8 });
    }
    game.world.player.triggerFlash();
    game.effects.addShake(6);
    game.sound.match();
    game.haptics.serve();
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
  game.bus.on('partialServe', ({ x, y }) => {
    game.sound.catch_();
    game.effects.popText(x, y, '✓', { color: '#43aa8b', size: 22, life: 0.5 });
  });

  // The combo chain decayed (patience timeout) — a soft "lost it" beep.
  game.bus.on('comboLost', () => {
    game.sound.bad();
  });

  // A power-up fired (a tip or the combo breaker). Heart heal vs. a timed
  // power-up differ only in the burst palette + which trigger ding plays.
  game.bus.on('powerup', ({ type, x, y }) => {
    switch (type) {
      case PICKUP_TYPE.HEART:
        game.effects.burst(x, y, ['#ff6fa3', '#fff', '#ffd166'], 20);
        game.effects.popText(x, y - 10, `+${HEART_HEAL_AMOUNT} ❤`, { color: '#ff6fa3', size: 24 });
        break;
      case PICKUP_TYPE.FEATHER:
        game.effects.burst(x, y, ['#bfdcff', '#fff'], 16);
        game.effects.popText(x, y - 10, 'Speed!', { color: '#5cb8ff', size: 24 });
        break;
      case PICKUP_TYPE.PAUSE:
        game.effects.burst(x, y, ['#c9b6ff', '#fff'], 16);
        game.effects.popText(x, y - 10, 'Frozen!', { color: '#b69aff', size: 24 });
        break;
      case PICKUP_TYPE.RAINBOW:
        game.effects.burst(x, y, ['#ff5b5b', '#ffb15c', '#fff36a', '#7fe3c4', '#6a8cff', '#c067ff'], 30);
        game.effects.popText(x, y - 10, 'Rainbow!', { color: '#ffb703', size: 26 });
        break;
    }
    game.world.player.triggerFlash(0.2);
    if (type === PICKUP_TYPE.HEART) game.sound.heart(); else game.sound.powerupTrigger();
    game.haptics.powerup();
  });

  // Combo-breaker crescendo over the normal power-up FX: extra ding, shake,
  // confetti, banner. The power-up itself fires via its own 'powerup' event.
  game.bus.on('comboBreak', ({ x, y }) => {
    game.sound.perfect();
    game.effects.addShake(12);
    game.effects.burst(x, y, ['#ffec5c', '#ff6fa3', '#7fe3c4', '#6a8cff', '#fff'], 36);
    game.effects.popText(x, y - 46, '⚡ SUPERCHARGED!', { color: '#ffec5c', size: 30, life: 1.2 });
  });

  // Toss-top (upward gesture): burst at the popped scoop + the "let go" beep.
  game.bus.on('discard', ({ x, y, color }) => {
    game.effects.burst(x, y, [game.world.shop.hex(color), '#fff'], 10);
    game.sound.catch_();
  });

  // Coin tip: gold burst + points pop.
  game.bus.on('coin', ({ x, y, points }) => {
    game.effects.burst(x, y, ['#ffd700', '#fff7c0', '#fff'], 18);
    game.effects.popText(x, y - 28, `+${points}`, { color: '#ffd700', size: 24 });
    game.sound.bubblePop();
  });

  // A challenge requirement was newly met — bottom-of-screen toast.
  game.bus.on('challengeEarned', ({ title }) => {
    game.hud.showChallengeToast({ title });
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
    game.hud.setGauge(game.world.waves.wave, 1);
    game.hud.flashWaveUp();
    game.sound.levelUp();
    game.haptics.wave();
    game.effects.addShake(14);
    const c = game.hud.gaugeCenter();
    if (c) game.effects.burst(c.x, c.y, ['#ffec5c', '#ffd166', '#ff6fa3', '#7fe3c4'], 60);
  });
}
