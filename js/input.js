// @ts-check
/** @typedef {import('./types.js').PickupTypeName} PickupTypeName */

/**
 * Keyboard input. Left/Right are polled (held) for movement; Pop, Deliver,
 * and Use-Power are edge-triggered discrete actions exposed as handlers.
 *
 * Q/W/E/R always emit onUsePower — game.js decides whether the user has the
 * charge to spend (or cheat mode is on for infinite supply).
 */
export class Input {
  constructor() {
    this.left = false;
    this.right = false;
    /** @type {() => void} */
    this.onPop = () => {};
    /** @type {() => void} */
    this.onDeliver = () => {};
    /** @type {() => void} */
    this.onRotate = () => {};
    /** @type {(type: PickupTypeName) => void} — debug Q/W/E/R synthesise a catch. */
    this.onUsePower = () => {};
    /** @type {() => void} — Shift: spend the front banked power-up (Banked game mode only). */
    this.onShift = () => {};
    /** @type {() => void} — debug: inflict damage on self (T). Game gates this on the cheat flag. */
    this.onDebugDamage = () => {};
    /** @type {() => void} — Esc toggles the pause menu. */
    this.onPause = () => {};

    window.addEventListener('keydown', e => {
      switch (e.key) {
        case 'ArrowLeft':  this.left = true;  e.preventDefault(); break;
        case 'ArrowRight': this.right = true; e.preventDefault(); break;
        case ' ':
        case 'Spacebar':
          if (!e.repeat) this.onPop();
          e.preventDefault();
          break;
        case 'ArrowUp':
        case 'Enter':
          if (!e.repeat) this.onDeliver();
          e.preventDefault();
          break;
        case 'ArrowDown':
          if (!e.repeat) this.onRotate();
          e.preventDefault();
          break;
        case 'Shift':
          if (!e.repeat) this.onShift();
          e.preventDefault();
          break;
        case 'q': case 'Q': if (!e.repeat) this.onUsePower('heart');   break;
        case 'w': case 'W': if (!e.repeat) this.onUsePower('feather'); break;
        case 'e': case 'E': if (!e.repeat) this.onUsePower('pause');   break;
        case 'r': case 'R': if (!e.repeat) this.onUsePower('rainbow'); break;
        case 't': case 'T': if (!e.repeat) this.onDebugDamage();       break;
        case 'Escape':
          if (!e.repeat) this.onPause();
          e.preventDefault();
          break;
      }
    });

    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft')  this.left = false;
      if (e.key === 'ArrowRight') this.right = false;
    });
  }
}
