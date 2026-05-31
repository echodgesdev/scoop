// @ts-check
import {
  COLOR_KEYS,
  SCOOP_RADIUS,
  SCOOP_FALL_MIN,
  SCOOP_FALL_RANGE,
  UPCOMING_COUNT,
  SPAWN_DEMAND_BIAS,
  MAX_LIVE_SCOOPS,
  SCOOP_DISSOLVE_S
} from './config.js';
import { drawScoop } from './player.js';

/** @typedef {import('./types.js').ScoopColor} ScoopColor */
/** @typedef {import('./types.js').Scoop} Scoop */
/** @typedef {import('./types.js').Bounds} Bounds */
/** @typedef {import('./types.js').Hitbox} Hitbox */
/** @typedef {import('./types.js').Tuning} Tuning */

/** @returns {ScoopColor} */
function randomColor() {
  return COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
}

export class ScoopField {
  constructor() {
    /** @type {Scoop[]} */
    this.scoops = [];
    this.spawnTimer = 0;
    /** @type {ScoopColor[]} */
    this.upcoming = [];
    /**
     * Demand source: returns the net colors waiting customers still need
     * (after subtracting tray). With probability SPAWN_DEMAND_BIAS, the next
     * spawn picks from this multi-set instead of uniform random — supply
     * tilts toward what the player actually needs.
     * @type {() => ScoopColor[]}
     */
    this.demandSource = () => [];
    // Probability a spawn is biased toward demand. Seeded from the tuning
    // constant but overridable live via the debug panel — lowering it is the
    // main "make the tray bind" scarcity knob. Persists across reset().
    this.demandBias = SPAWN_DEMAND_BIAS;
    // Hard cap on simultaneously-falling scoops; live-overridable via the debug
    // panel. Persists across reset().
    this.maxLive = MAX_LIVE_SCOOPS;
    this._refill();
  }

  /** @param {() => ScoopColor[]} fn */
  setDemandSource(fn) {
    this.demandSource = fn;
  }

  /** @param {number} n debug override for the max simultaneous falling scoops */
  setMaxLive(n) {
    this.maxLive = Math.max(1, Math.round(n));
  }

  /** @param {number} v probability 0..1 */
  setDemandBias(v) {
    this.demandBias = Math.max(0, Math.min(1, v));
  }

  reset() {
    this.scoops = [];
    this.spawnTimer = 0;
    this.upcoming = [];
    this._refill();
  }

  /** @returns {ScoopColor} */
  _pickColor() {
    const demand = this.demandSource();
    if (demand.length > 0 && Math.random() < this.demandBias) {
      return demand[Math.floor(Math.random() * demand.length)];
    }
    return randomColor();
  }

  /** Scoops that are still catchable (not mid-dissolve). */
  _liveCount() {
    let n = 0;
    for (const s of this.scoops) if (s.dissolve === undefined) n += 1;
    return n;
  }

  /**
   * @param {number} dt
   * @param {Bounds} bounds
   * @param {Tuning} tuning supplied per-frame
   * @param {number} missY y past which an uncaught scoop is unreachable and
   *   begins to dissolve (the cone's lowest possible catch line + a margin)
   * @param {(scoop: Scoop) => boolean} onCatch return true to consume the scoop
   */
  update(dt, bounds, tuning, missY, onCatch) {
    this.spawnTimer += dt;
    if (this.spawnTimer >= tuning.spawnInterval) {
      this.spawnTimer = 0;
      // Idle at the cap — the spawner just retries next interval once a slot
      // frees up. Dissolving scoops don't count against the cap.
      if (this._liveCount() < this.maxLive) this._spawn(bounds, tuning.fallMult);
    }

    for (let i = this.scoops.length - 1; i >= 0; i--) {
      const s = this.scoops[i];

      // Dissolving: drift gently while fading, then cull. Not catchable.
      if (s.dissolve !== undefined) {
        s.dissolve += dt;
        s.y += s.vy * dt * 0.25;
        if (s.dissolve >= SCOOP_DISSOLVE_S) this.scoops.splice(i, 1);
        continue;
      }

      s.y += s.vy * dt;

      if (onCatch(s)) {
        this.scoops.splice(i, 1);
        continue;
      }
      // Past the catch line into the ground — begin the dissolve instead of
      // letting it stream off the bottom of the screen.
      if (s.y > missY) {
        s.dissolve = 0;
        s.vy *= 0.4;
        continue;
      }
      // Safety net for any scoop that somehow slips past (e.g. an off-screen
      // missY on a tiny aspect): cull below the floor.
      if (s.y > bounds.height + 40) this.scoops.splice(i, 1);
    }
  }

  /**
   * Pass `rainbow` to repaint every scoop as rainbow (purely visual).
   * @param {CanvasRenderingContext2D} ctx
   * @param {boolean} [rainbow]
   */
  draw(ctx, rainbow = false) {
    for (const s of this.scoops) {
      if (s.dissolve === undefined) {
        drawScoop(ctx, s.x, s.y, rainbow ? 'rainbow' : s.color);
        continue;
      }
      // Dissolve: fade out + shrink, with an expanding white poof ring so the
      // miss reads as the scoop fizzling into the sand rather than vanishing.
      const p = Math.min(1, s.dissolve / SCOOP_DISSOLVE_S);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawScoop(ctx, s.x, s.y, rainbow ? 'rainbow' : s.color, 1 - 0.4 * p);
      ctx.globalAlpha = (1 - p) * 0.6;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, SCOOP_RADIUS * (1 + 0.7 * p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _refill() {
    while (this.upcoming.length < UPCOMING_COUNT) this.upcoming.push(this._pickColor());
  }

  /**
   * @param {Bounds} bounds
   * @param {number} fallMult
   */
  _spawn(bounds, fallMult) {
    const color = this.upcoming.shift();
    if (!color) return;
    this._refill();
    this.scoops.push({
      x: Math.random() * (bounds.width - 80) + 40,
      y: -SCOOP_RADIUS,
      vy: (SCOOP_FALL_MIN + Math.random() * SCOOP_FALL_RANGE) * fallMult,
      color
    });
  }
}

/**
 * @param {Scoop} scoop
 * @param {Hitbox} hitbox
 */
export function isCaught(scoop, hitbox) {
  const verticalOverlap =
    scoop.y + SCOOP_RADIUS >= hitbox.y - hitbox.r &&
    scoop.y - SCOOP_RADIUS <= hitbox.y + hitbox.r;
  const horizontalOverlap = Math.abs(scoop.x - hitbox.x) < hitbox.halfW;
  return verticalOverlap && horizontalOverlap;
}
