// @ts-check
/** @typedef {{ x: number, y: number, vx: number, vy: number, life: number, maxLife: number, r: number, color: string }} Particle */
/** @typedef {{ x: number, y: number, vy: number, text: string, color: string, size: number, life: number, maxLife: number }} FloatText */
/** @typedef {{ cx: number, cy: number, angle: number, radius: number, angVel: number, radVel: number, rot: number, spin: number, size: number, color: string, life: number, maxLife: number }} Swirl */

const GRAVITY = 520;

/** Particle bursts + screen shake + floating text + power-up swirls, drawn onto the game canvas. */
export class Effects {
  constructor() {
    /** @type {Particle[]} */
    this.particles = [];
    /** @type {FloatText[]} */
    this.texts = [];
    /** @type {Swirl[]} triangle shards that orbit + spiral out (power-up "got it" flourish) */
    this.swirls = [];
    this.shake = 0;
  }

  reset() {
    this.particles = [];
    this.texts = [];
    this.swirls = [];
    this.shake = 0;
  }

  /**
   * A rising, fading label (e.g. "Perfect!", "+450").
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {{ color?: string, size?: number, life?: number }} [opts]
   */
  popText(x, y, text, { color = '#fff', size = 26, life = 0.9 } = {}) {
    this.texts.push({ x, y, vy: -70, text, color, size, life, maxLife: life });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string[]} hexColors
   * @param {number} [count]
   */
  burst(x, y, hexColors, count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life: 0.7 + Math.random() * 0.4,
        maxLife: 1.1,
        r: 3 + Math.random() * 5,
        color: hexColors[Math.floor(Math.random() * hexColors.length)]
      });
    }
  }

  /**
   * A quick ring of triangle shards that orbits a center (the cone) and spirals
   * outward as it fades — the power-up "got it" flourish (replaces the pop text).
   * @param {number} cx @param {number} cy
   * @param {string[]} colors palette each shard's color is picked from
   * @param {number} [count]
   */
  swirl(cx, cy, colors, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const life = 0.55 + Math.random() * 0.2;
      this.swirls.push({
        cx, cy, angle,
        radius: 16 + Math.random() * 10,
        angVel: 7 + Math.random() * 4,        // rad/s — the orbit
        radVel: 38 + Math.random() * 46,      // px/s — spirals outward
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 12,
        size: 6 + Math.random() * 5,
        color: colors[i % colors.length],
        life, maxLife: life
      });
    }
  }

  /** @param {number} magnitude */
  addShake(magnitude) {
    this.shake = Math.max(this.shake, magnitude);
  }

  offset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return {
      x: (Math.random() * 2 - 1) * this.shake,
      y: (Math.random() * 2 - 1) * this.shake
    };
  }

  /** @param {number} dt */
  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y += t.vy * dt;
      t.vy *= 0.92;
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.swirls.length - 1; i >= 0; i--) {
      const s = this.swirls[i];
      s.angle += s.angVel * dt;
      s.radius += s.radVel * dt;
      s.rot += s.spin * dt;
      s.life -= dt;
      if (s.life <= 0) this.swirls.splice(i, 1);
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const s of this.swirls) {
      const x = s.cx + Math.cos(s.angle) * s.radius;
      const y = s.cy + Math.sin(s.angle) * s.radius;
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.translate(x, y);
      ctx.rotate(s.rot);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(0, -s.size);
      ctx.lineTo(s.size * 0.86, s.size * 0.5);
      ctx.lineTo(-s.size * 0.86, s.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const t of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.maxLife * 1.4));
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.size}px 'Comic Sans MS', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }
}
