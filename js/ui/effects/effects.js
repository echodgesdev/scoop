// @ts-check
/** @typedef {{ x: number, y: number, vx: number, vy: number, life: number, maxLife: number, r: number, color: string }} Particle */
/** @typedef {{ x: number, y: number, vy: number, text: string, color: string, size: number, life: number, maxLife: number }} FloatText */
/** @typedef {{ cx: number, cy: number, angle: number, radius: number, angVel: number, radVel: number, rot: number, spin: number, size: number, color: string, life: number, maxLife: number }} Swirl */
/** @typedef {{ cx: number, y: number, angle: number, angVel: number, topRadius: number, rise: number, rot: number, spin: number, size: number, color: string, life: number, maxLife: number }} Vortex */
/** @typedef {{ x: number, y: number, vx: number, vy: number, rot: number, spin: number, size: number, color: string, life: number, maxLife: number }} Shard */

const GRAVITY = 520;

// Damage flash: a full-screen red tint whose alpha rides the `hurt` timer (seeded
// by reactions on damage, decays in update). HURT_REF_S is the timer value the max
// tint maps to.
const HURT_RGB       = '230, 57, 70';
const HURT_MAX_ALPHA = 0.35;
const HURT_REF_S     = 0.3;

/** Particle bursts + screen shake + floating text + power-up swirls + damage flash, drawn onto the game canvas. */
export class Effects {
  constructor() {
    /** @type {Particle[]} */
    this.particles = [];
    /** @type {FloatText[]} */
    this.texts = [];
    /** @type {Swirl[]} triangle shards that orbit + spiral out (power-up "got it" flourish) */
    this.swirls = [];
    /** @type {Vortex[]} dots spiralling up a vertical axis + converging — the power-up / tip vortex */
    this.vortices = [];
    /** @type {Shard[]} chunky debris flung outward with gravity + spin (the cone fracturing) */
    this.shards = [];
    this.shake = 0;
    this.hurt = 0;
  }

  reset() {
    this.particles = [];
    this.texts = [];
    this.swirls = [];
    this.vortices = [];
    this.shards = [];
    this.shake = 0;
    this.hurt = 0;
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

  /**
   * A conical vortex: triangle shards spiral around a vertical axis (a shallow
   * ellipse, so they read as orbiting IN FRONT OF and BEHIND the cone rather than
   * a flat ring) while climbing and FANNING OUT toward the top, then dissipate —
   * the power-up / tip "got it" flourish wrapped around the whole cone. The funnel
   * is apex-down: a tight point at (cx, cy) widening as it rises. `height` is the
   * px each shard climbs over its life, so the column fades out ~that tall.
   * @param {number} cx @param {number} cy base of the funnel (the narrow point)
   * @param {string[]} colors palette each shard's color is picked from
   * @param {number} height px climbed before a shard dissipates (the funnel height)
   * @param {number} [count]
   */
  vortex(cx, cy, colors, height, count = 60) {
    for (let i = 0; i < count; i++) {
      const life = 0.6 + Math.random() * 0.45;
      this.vortices.push({
        cx,
        y: cy + Math.random() * 8,              // tight base — the narrow point of the cone
        angle: Math.random() * Math.PI * 2,
        angVel: 7 + Math.random() * 4,          // rad/s — all one direction (a coherent spin)
        topRadius: 30 + Math.random() * 22,     // orbit radius at the wide top
        rise: height / life,                    // climbs `height` over its life -> fades at the top
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 12,     // tumble
        size: 7 + Math.random() * 6,
        color: colors[i % colors.length],
        life, maxLife: life
      });
    }
  }

  /**
   * Chunky angular debris — the cone fracturing on death. Bigger than burst
   * particles, flung outward with an upward bias, tumbling (spin) and falling under
   * gravity as they fade.
   * @param {number} x @param {number} y
   * @param {string[]} colors palette each chunk's color is picked from
   * @param {number} [count]
   */
  fracture(x, y, colors, count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;
      const life = 0.9 + Math.random() * 0.5;
      this.shards.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 180,   // upward bias so they pop up, then fall
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 14,
        size: 7 + Math.random() * 11,
        color: colors[Math.floor(Math.random() * colors.length)],
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

  /** Seed the damage flash (seconds it lasts; also drives the tint alpha). @param {number} seconds */
  flashHurt(seconds) {
    this.hurt = seconds;
  }

  /**
   * Full-screen red damage tint, alpha riding the hurt timer. Screen-fixed: drawn
   * inside the shake transform, so it counteracts the (ox, oy) offset to fill the
   * viewport.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ width: number, height: number }} bounds @param {number} ox @param {number} oy
   */
  drawHurt(ctx, bounds, ox, oy) {
    if (this.hurt <= 0) return;
    ctx.fillStyle = `rgba(${HURT_RGB}, ${HURT_MAX_ALPHA * (this.hurt / HURT_REF_S)})`;
    ctx.fillRect(-ox, -oy, bounds.width, bounds.height);
  }

  /** @param {number} dt */
  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt);
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
    for (let i = this.vortices.length - 1; i >= 0; i--) {
      const v = this.vortices[i];
      v.angle += v.angVel * dt;
      v.y -= v.rise * dt;
      v.rot += v.spin * dt;
      v.life -= dt;
      if (v.life <= 0) this.vortices.splice(i, 1);
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      s.life -= dt;
      if (s.life <= 0) this.shards.splice(i, 1);
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
    for (const v of this.vortices) {
      const q = 1 - v.life / v.maxLife;             // 0 at the narrow base .. 1 at the wide top
      const r = v.topRadius * (0.25 + 0.88 * q);    // fan OUT as it climbs (apex-down cone)
      const px = v.cx + Math.cos(v.angle) * r;
      const py = v.y + Math.sin(v.angle) * r * 0.3; // shallow ellipse -> orbit AROUND a vertical axis
      const sz = v.size * (1 - 0.3 * q);
      ctx.save();
      ctx.globalAlpha = Math.max(0, v.life / v.maxLife);
      ctx.translate(px, py);
      ctx.rotate(v.rot);
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.86, sz * 0.5);
      ctx.lineTo(-sz * 0.86, sz * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const s of this.shards) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, s.life / s.maxLife));
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = s.color;
      // A jagged waffle chunk (irregular quad) so it reads as cone debris, not a dot.
      ctx.beginPath();
      ctx.moveTo(0, -s.size);
      ctx.lineTo(s.size * 0.9, -s.size * 0.1);
      ctx.lineTo(s.size * 0.5, s.size * 0.9);
      ctx.lineTo(-s.size * 0.8, s.size * 0.4);
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
