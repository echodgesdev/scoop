// @ts-check
// Generic sprite-sheet renderer. Consumes the data contract the sprite editor
// (assets/index.html) exports — see SpriteSheetDef in types.js — so every sprite
// swap in the game is just a different `def`, never new rendering code.
//
// Coordinates in the def are the sheet's native pixels. The renderer is told an
// ANCHOR (the world point the sprite is pinned to) and a SCALE (sheet px → world
// px); a frame's `offset` places the sprite center relative to the anchor, and a
// frame's `body` is the rigid shape the engine collides with. Callers decide the
// scale — typically by fitting a frame's body onto a known world size (the body
// is the contract between art and physics), so art resolution/padding can change
// without moving anything else.

/** @typedef {import('../types.js').SpriteSheetDef} SpriteSheetDef */
/** @typedef {import('../types.js').SpriteFrame} SpriteFrame */

export class SpriteSheet {
  /** @param {SpriteSheetDef} def */
  constructor(def) {
    this.def = def;
    this.frameW = def.frame.width;
    this.frameH = def.frame.height;
    this.animations = def.animations || [];
    /** @type {Map<string, number>} animation name → index */
    this._byName = new Map(this.animations.map((a, i) => [a.name, i]));
    this.ready = false;
    this.img = new Image();
    this.img.onload = () => { this.ready = true; };
    this.img.onerror = () => { this.ready = false; };
    this.img.src = def.image;
  }

  /**
   * Resolve an animation reference (index or name) to an index, or -1.
   * @param {number | string} anim
   */
  animIndex(anim) {
    if (typeof anim === 'number') return anim;
    const i = this._byName.get(anim);
    return i === undefined ? -1 : i;
  }

  /**
   * The frame metadata, or null if the animation/frame doesn't exist. Available
   * before the image loads (it comes from the def), so callers can read a frame's
   * body to compute scale up front.
   * @param {number | string} anim @param {number} [frameIndex]
   * @returns {SpriteFrame | null}
   */
  frame(anim, frameIndex = 0) {
    const a = this.animations[this.animIndex(anim)];
    if (!a) return null;
    return a.frames[frameIndex] || null;
  }

  /** Frame count of an animation (0 if unknown) — for looping/clamping. @param {number | string} anim */
  frameCount(anim) {
    const a = this.animations[this.animIndex(anim)];
    return a ? a.frames.length : 0;
  }

  /**
   * Blit a frame, centered on the anchor + the frame's offset, scaled sheet→world
   * by `scale`. Returns false if the image isn't loaded or the frame is missing
   * (so the caller can fall back).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number | string} anim @param {number} frameIndex
   * @param {number} ax @param {number} ay  anchor (world)
   * @param {number} [scale]  sheet px → world px
   * @returns {boolean}
   */
  draw(ctx, anim, frameIndex, ax, ay, scale = 1) {
    if (!this.ready) return false;
    const f = this.frame(anim, frameIndex);
    if (!f) return false;
    const dw = this.frameW * scale, dh = this.frameH * scale;
    const cx = ax + (f.offset ? f.offset.x : 0) * scale;
    const cy = ay + (f.offset ? f.offset.y : 0) * scale;
    ctx.drawImage(this.img, f.x, f.y, this.frameW, this.frameH, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }

  /**
   * A frame's rigid body in world space (for collision / debug overlays), or null
   * when the frame has no body. Anchor + scale match draw().
   * @param {number | string} anim @param {number} frameIndex
   * @param {number} ax @param {number} ay @param {number} [scale]
   * @returns {({shape:'circle',x:number,y:number,radius:number}|{shape:'rect',x:number,y:number,width:number,height:number}|null)}
   */
  body(anim, frameIndex, ax, ay, scale = 1) {
    const f = this.frame(anim, frameIndex);
    if (!f || !f.body) return null;
    const b = f.body;
    const cx = ax + (b.x || 0) * scale, cy = ay + (b.y || 0) * scale;
    if (b.shape === 'rect') {
      return { shape: 'rect', x: cx, y: cy, width: (b.width || 0) * scale, height: (b.height || 0) * scale };
    }
    return { shape: 'circle', x: cx, y: cy, radius: (b.radius || 0) * scale };
  }
}
