import { DISSONANCE_THRESHOLD, type Figure, LOCK_THRESHOLD, TAU, sampleBreaker, sampleTarget } from '../breach/PhaseLock';
import type { IceClass } from '../breach/presets';
import { BEAM, type RGB, SPECIAL, hot, rgba } from './palette';
import { drawVfd } from './vfd';

export interface Shard {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  vx: number;
  vy: number;
  spin: number;
  color: RGB;
}

export interface Tendril {
  /** start on the screen edge, normalised 0..1 */
  sx: number;
  sy: number;
  wobble: number[];
}

export interface FrameView {
  time: number;
  dt: number;
  theta: number;
  cls: IceClass;
  iceLabel: string;
  diffLabel: string;
  phase: 'title' | 'ready' | 'engaged' | 'shatter' | 'down';
  phaseT: number;
  layerNo: number;
  ratio: readonly [number, number];
  phi: number;
  R: number;
  Phi: number;
  roll: number;
  m: number;
  meter: number;
  trace: number;
  neural: number;
  elapsed: number;
  telegraph: { k: number; left: number; next: readonly [number, number]; nextPhi: number } | null;
  grip: { left: number; k: number } | null;
  down: 'flatline' | 'burned' | null;
  lastTime: number | null;
  shards: Shard[];
  tendrils: Tendril[];
  eeg: Float32Array;
  eegHead: number;
  flags: { bot: boolean; ghost: boolean; purist: boolean; reduceFlash: boolean; muted: boolean; audio: boolean };
  summary: { you: string; auto: string; recent: string[] };
}

const N_FIG = 720;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private persist = document.createElement('canvas');
  private pctx: CanvasRenderingContext2D;
  private bloom = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private scratch = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private figT: Figure = { x: new Float32Array(N_FIG), y: new Float32Array(N_FIG) };
  private figB: Figure = { x: new Float32Array(N_FIG), y: new Float32Array(N_FIG) };
  private figG: Figure = { x: new Float32Array(N_FIG), y: new Float32Array(N_FIG) };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.pctx = this.persist.getContext('2d')!;
    this.bctx = this.bloom.getContext('2d')!;
    this.sctx = this.scratch.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = Math.floor(innerWidth * this.dpr);
    this.h = Math.floor(innerHeight * this.dpr);
    for (const c of [this.canvas, this.persist, this.scratch]) {
      c.width = this.w;
      c.height = this.h;
    }
    this.bloom.width = Math.max(1, this.w >> 2);
    this.bloom.height = Math.max(1, this.h >> 2);
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
  }

  /** Facet geometry: centre and half-size, in device px. */
  facet(): { cx: number; cy: number; S: number } {
    return { cx: this.w * 0.5, cy: this.h * 0.47, S: Math.min(this.w, this.h) * 0.25 };
  }

  draw(v: FrameView): void {
    const { ctx, w, h } = this;
    const { cx, cy, S } = this.facet();
    const u = h / 46;

    // Phosphor persistence decays toward black; trails pick up the P7 afterglow tint.
    const keep = Math.exp(-v.dt / 0.22);
    this.pctx.globalCompositeOperation = 'source-over';
    this.pctx.fillStyle = `rgba(0,0,0,${(1 - keep).toFixed(4)})`;
    this.pctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    this.lattice(v);

    const intro = v.phase === 'shatter' ? Math.max(0, (v.phaseT - 1.2) / 0.6) : 1;
    const showFacet = v.phase !== 'title' && !(v.phase === 'shatter' && v.phaseT < 1.2);
    if (showFacet) this.drawFacet(v, cx, cy, S, intro);

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.persist, 0, 0);

    const scale = S * 0.82;
    const mapX = (x: number) => cx + x * scale;
    const mapY = (y: number) => cy - y * scale;

    if (v.phase === 'engaged' || v.phase === 'down') {
      const [a, b] = v.ratio;
      const iceCol = v.cls === 'black' ? SPECIAL.BLACK_ICE_EDGE : BEAM.ICE;
      let iceI = v.cls === 'black' ? 2.6 : 1.6;
      if (v.telegraph) iceI *= v.flags.reduceFlash ? 0.85 + 0.15 * Math.cos(v.time * TAU * 2) : 0.72 + 0.28 * hash(Math.floor(v.time * 15));
      sampleTarget(a, b, v.phi, v.theta, N_FIG, this.figT);
      this.figure(this.figT, mapX, mapY, iceCol, iceI, 1.6 * this.dpr);
      if (v.telegraph && v.flags.ghost) {
        sampleTarget(v.telegraph.next[0], v.telegraph.next[1], v.telegraph.nextPhi, v.theta, N_FIG, this.figG);
        this.ghost(this.figG, mapX, mapY, iceCol, Math.min(1, v.telegraph.k * 1.6));
      }
      sampleBreaker(v.R, v.Phi + v.roll, a, b, v.theta, N_FIG, this.figB);
      const brI = 1.6 + 2.4 * v.m;
      this.figure(this.figB, mapX, mapY, BEAM.AMBER, brI, 1.8 * this.dpr);
      this.trail(this.figT, mapX, mapY, 0.05);
      this.trail(this.figB, mapX, mapY, 0.07 + 0.05 * v.m);
    }

    if (v.shards.length) this.drawShards(v, mapX, mapY);

    this.hud(v, u, cx, cy, S);

    // Cheap bloom: quarter-res blurred copy added back.
    this.bctx.globalCompositeOperation = 'source-over';
    this.bctx.filter = 'blur(3px)';
    this.bctx.clearRect(0, 0, this.bloom.width, this.bloom.height);
    this.bctx.drawImage(this.canvas, 0, 0, this.bloom.width, this.bloom.height);
    this.bctx.filter = 'none';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bloom, 0, 0, w, h);
    ctx.globalAlpha = 1;

    if (v.grip) this.drawTendrils(v, cx, cy, S);
    if (v.phase === 'down') this.collapse(v, u);
    if (v.phase === 'title') this.title(v, u);
  }

  private lattice(v: FrameView): void {
    const { ctx, w, h } = this;
    const step = Math.round(Math.min(w, h) / 18);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    const ox = (w / 2) % step;
    const oy = (h * 0.47) % step;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = -1, x = ox; x < w; x += step, i++) {
        if ((i % 4 === 0) !== (pass === 1)) continue;
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let i = -1, y = oy; y < h; y += step, i++) {
        if ((i % 4 === 0) !== (pass === 1)) continue;
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.strokeStyle = rgba(BEAM.GRID, (pass ? 0.09 : 0.035) * (v.phase === 'down' ? 0.3 : 1));
      ctx.stroke();
    }
  }

  private drawFacet(v: FrameView, cx: number, cy: number, S: number, intro: number): void {
    const { ctx } = this;
    const sx = Math.max(0.02, Math.sin((intro * Math.PI) / 2));
    const corners = (s: number, rot: number): Array<[number, number]> =>
      [0, 1, 2, 3].map((i) => {
        const ang = rot + Math.PI / 4 + (i * Math.PI) / 2;
        return [cx + Math.cos(ang) * s * Math.SQRT2 * sx, cy + Math.sin(ang) * s * Math.SQRT2];
      });
    const poly = (pts: Array<[number, number]>) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    };
    const face = corners(S, 0);
    const flick = v.telegraph ? (v.flags.reduceFlash ? 0.8 + 0.2 * Math.cos(v.time * TAU * 2) : 0.65 + 0.35 * hash(Math.floor(v.time * 15) + 7)) : 1;

    if (v.cls === 'black') {
      // Subtractive: a black solid that occludes the lattice, with a thin crawling ultraviolet edge.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      poly(corners(S * 1.08, 0));
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.setLineDash([S * 0.05, S * 0.03, S * 0.012, S * 0.03]);
      ctx.lineDashOffset = -v.time * S * 0.35;
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeStyle = rgba(SPECIAL.BLACK_ICE_EDGE, 0.75 * flick);
      poly(face);
      ctx.stroke();
      ctx.lineDashOffset = v.time * S * 0.22;
      ctx.strokeStyle = rgba(SPECIAL.BLACK_ICE_EDGE, 0.35 * flick);
      poly(corners(S * 1.08, 0));
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    ctx.globalCompositeOperation = 'lighter';
    // Moiré hatching: two nearly-parallel line families on the facet.
    ctx.save();
    poly(face);
    ctx.clip();
    const dense = v.cls === 'gray';
    const sp = (dense ? 0.034 : 0.05) * S;
    const fam = (ang: number, spacing: number, a: number) => {
      ctx.beginPath();
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const L = S * 2;
      for (let d = -L; d <= L; d += spacing) {
        ctx.moveTo(cx + ca * -L - sa * d, cy + sa * -L + ca * d);
        ctx.lineTo(cx + ca * L - sa * d, cy + sa * L + ca * d);
      }
      ctx.lineWidth = this.dpr;
      ctx.strokeStyle = rgba(BEAM.ICE, a * flick);
      ctx.stroke();
    };
    fam(0.0, sp, dense ? 0.075 : 0.05);
    fam(0.045 + 0.012 * Math.sin(v.time * 0.21), sp * 1.035, dense ? 0.075 : 0.05);
    ctx.restore();

    ctx.lineWidth = 1.4 * this.dpr;
    ctx.strokeStyle = rgba(BEAM.ICE, 0.55 * flick);
    poly(face);
    ctx.stroke();
    if (dense) {
      // Counter-rotating nested shells.
      ctx.lineWidth = this.dpr;
      ctx.strokeStyle = rgba(BEAM.ICE, 0.22 * flick);
      poly(corners(S * 1.18, v.time * 0.12));
      ctx.stroke();
      ctx.strokeStyle = rgba(BEAM.ICE, 0.14 * flick);
      poly(corners(S * 1.34, -v.time * 0.08));
      ctx.stroke();
    }
  }

  /** A beam figure: bright head, decaying tail, halo + core passes. */
  private figure(f: Figure, mx: (x: number) => number, my: (y: number) => number, col: RGB, I: number, width: number): void {
    const { ctx } = this;
    const chunks = 24;
    const per = Math.ceil(N_FIG / chunks);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const core = hot(col, I);
    for (let c = 0; c < chunks; c++) {
      const k = 0.3 + 0.7 * Math.pow(c / (chunks - 1), 1.4);
      const p = new Path2D();
      const i0 = c * per;
      const i1 = Math.min(N_FIG - 1, i0 + per);
      p.moveTo(mx(f.x[i0]), my(f.y[i0]));
      for (let i = i0 + 1; i <= i1; i++) p.lineTo(mx(f.x[i]), my(f.y[i]));
      ctx.lineWidth = width * 5;
      ctx.strokeStyle = rgba(col, 0.045 * I * k);
      ctx.stroke(p);
      ctx.lineWidth = width * 2.2;
      ctx.strokeStyle = rgba(col, 0.13 * I * k);
      ctx.stroke(p);
      ctx.lineWidth = width;
      ctx.strokeStyle = rgba(core, Math.min(1, 0.3 * I * k));
      ctx.stroke(p);
    }
    const hx = mx(f.x[N_FIG - 1]);
    const hy = my(f.y[N_FIG - 1]);
    ctx.fillStyle = rgba(hot(col, 4), 0.9);
    ctx.beginPath();
    ctx.arc(hx, hy, width * 1.6, 0, TAU);
    ctx.fill();
  }

  /** Telegraph preview: the incoming figure as plotted points, fading in. */
  private ghost(f: Figure, mx: (x: number) => number, my: (y: number) => number, col: RGB, k: number): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.5 * k);
    const r = 1.1 * this.dpr;
    for (let i = 0; i < N_FIG; i += 5) {
      ctx.fillRect(mx(f.x[i]) - r, my(f.y[i]) - r, r * 2, r * 2);
    }
  }

  private trail(f: Figure, mx: (x: number) => number, my: (y: number) => number, a: number): void {
    const p = this.pctx;
    p.globalCompositeOperation = 'lighter';
    p.lineWidth = 2 * this.dpr;
    p.strokeStyle = rgba(BEAM.AFTERGLOW, a);
    p.beginPath();
    p.moveTo(mx(f.x[0]), my(f.y[0]));
    for (let i = 1; i < N_FIG; i += 2) p.lineTo(mx(f.x[i]), my(f.y[i]));
    p.stroke();
  }

  private drawShards(v: FrameView, mx: (x: number) => number, my: (y: number) => number): void {
    const t = v.phaseT;
    const fade = Math.max(0, 1 - t / 1.2);
    if (fade <= 0) return;
    const g = 1.4;
    for (const pass of [this.ctx, this.pctx]) {
      pass.globalCompositeOperation = 'lighter';
      pass.lineCap = 'round';
      for (const s of v.shards) {
        const dx = s.vx * t;
        const dy = s.vy * t - 0.5 * g * t * t;
        const mxp = (s.x0 + s.x1) / 2;
        const myp = (s.y0 + s.y1) / 2;
        const ang = s.spin * t;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const hx = (s.x1 - s.x0) / 2;
        const hy = (s.y1 - s.y0) / 2;
        const ax = mxp + dx - (hx * ca - hy * sa);
        const ay = myp + dy - (hx * sa + hy * ca);
        const bx = mxp + dx + (hx * ca - hy * sa);
        const by = myp + dy + (hx * sa + hy * ca);
        pass.strokeStyle = pass === this.ctx ? rgba(hot(s.color, 1 + 3 * fade), 0.9 * fade) : rgba(BEAM.AFTERGLOW, 0.25 * fade);
        pass.lineWidth = (pass === this.ctx ? 1.6 : 2.4) * this.dpr;
        pass.beginPath();
        pass.moveTo(mx(ax), my(ay));
        pass.lineTo(mx(bx), my(by));
        pass.stroke();
      }
    }
  }

  private drawTendrils(v: FrameView, cx: number, cy: number, S: number): void {
    const { ctx, w, h } = this;
    const k = v.grip!.k;
    for (const td of v.tendrils) {
      const sx = td.sx * w;
      const sy = td.sy * h;
      const ex = sx + (cx - sx) * (0.15 + 0.7 * k);
      const ey = sy + (cy - sy) * (0.15 + 0.7 * k);
      const nx = -(ey - sy);
      const ny = ex - sx;
      const nl = Math.hypot(nx, ny) || 1;
      const pts: Array<[number, number]> = [];
      const n = td.wobble.length;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const amp = S * 0.09 * Math.sin(t * Math.PI) * (td.wobble[i] + 0.3 * Math.sin(v.time * 5 + i));
        pts.push([sx + (ex - sx) * t + (nx / nl) * amp, sy + (ey - sy) * t + (ny / nl) * amp]);
      }
      const path = new Path2D();
      path.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) path.lineTo(p[0], p[1]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = S * 0.06;
      ctx.strokeStyle = '#000';
      ctx.stroke(path);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = this.dpr;
      ctx.strokeStyle = rgba(SPECIAL.BLACK_ICE_EDGE, 0.5);
      ctx.stroke(path);
    }
  }

  private collapse(v: FrameView, u: number): void {
    const { ctx, w, h } = this;
    const t = v.phaseT;
    this.sctx.globalCompositeOperation = 'copy';
    this.sctx.drawImage(this.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const flat = v.down === 'flatline';
    if (t < 0.25) {
      const sy = Math.max(0.004, 1 - t / 0.25);
      ctx.drawImage(this.scratch, 0, h * (1 - sy) * 0.5, w, h * sy);
    } else if (t < 0.45) {
      const sx = Math.max(0.003, 1 - (t - 0.25) / 0.2);
      ctx.fillStyle = rgba(hot(BEAM.GRID, 3), 0.9);
      ctx.fillRect(w * (1 - sx) * 0.5, h * 0.5 - this.dpr, w * sx, 2 * this.dpr);
    } else if (t < 2.45) {
      ctx.fillStyle = rgba(hot(BEAM.GRID, 4), 1 - (t - 0.45) / 2.5);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 2.5 * this.dpr, 0, TAU);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      if (flat) {
        ctx.strokeStyle = rgba(BEAM.MITSU, 0.35);
        ctx.lineWidth = this.dpr;
        ctx.beginPath();
        ctx.moveTo(w * 0.2, h * 0.5);
        ctx.lineTo(w * 0.8, h * 0.5);
        ctx.stroke();
      }
      drawVfd(ctx, flat ? 'FLATLINE' : 'BURNED  TRACE COMPLETE', w / 2, h * 0.36, { color: SPECIAL.VFD, size: u * 1.4, align: 'center', ghost: true });
      drawVfd(ctx, 'SPACE  RETRY', w / 2, h * 0.6, { color: SPECIAL.VFD, size: u * 0.7, align: 'center', intensity: 0.6 });
    }
  }

  private title(v: FrameView, u: number): void {
    const { ctx, w, h } = this;
    drawVfd(ctx, 'NONSPACE', w / 2, h * 0.3, { color: SPECIAL.VFD, size: u * 2.2, align: 'center', ghost: true });
    drawVfd(ctx, 'PHASE LOCK LAB  M4.1', w / 2, h * 0.3 + u * 3.2, { color: SPECIAL.VFD, size: u * 0.8, align: 'center', intensity: 0.7 });
    const blink = 0.55 + 0.45 * Math.cos(v.time * 3);
    drawVfd(ctx, 'PRESS ANY KEY', w / 2, h * 0.62, { color: SPECIAL.VFD, size: u * 0.9, align: 'center', intensity: blink });
  }

  private hud(v: FrameView, u: number, cx: number, cy: number, S: number): void {
    const { ctx, w, h } = this;
    const vfd = SPECIAL.VFD;
    const m = u * 1.2;
    if (v.phase === 'title') return;
    const dim = v.phase === 'down' ? 0.4 : 1;

    drawVfd(ctx, `ICE ${v.iceLabel}`, m, m, { color: vfd, size: u, ghost: true, intensity: dim });
    drawVfd(ctx, `${v.diffLabel}${v.flags.purist ? ' PURIST' : ''}`, m, m + u * 1.6, { color: vfd, size: u * 0.7, intensity: 0.75 * dim });
    drawVfd(ctx, `LAYER ${pad(v.layerNo, 2)}`, m, m + u * 2.8, { color: vfd, size: u * 0.7, intensity: 0.75 * dim });
    drawVfd(ctx, `T ${fix(v.elapsed, 4, 1)}`, m, m + u * 4.0, { color: vfd, size: u * 0.7, intensity: 0.75 * dim, ghost: true });

    drawVfd(ctx, `TRACE ${pad(Math.floor(v.trace), 3)}%`, w - m, m, { color: vfd, size: u, align: 'right', ghost: true, intensity: dim });
    drawVfd(ctx, `NEURAL ${pad(Math.floor(v.neural), 3)}`, w - m, m + u * 1.6, { color: vfd, size: u * 0.7, align: 'right', intensity: (v.neural > 60 ? 1 : 0.75) * dim });

    // Status line above the facet.
    const sy = cy - S * 1.45 - u * 1.2;
    if (v.grip) {
      drawVfd(ctx, `GRIP ${fix(v.grip.left, 3, 1)}`, cx, sy, { color: vfd, size: u * 1.3, align: 'center', ghost: true });
    } else if (v.telegraph) {
      const on = v.flags.reduceFlash ? 1 : Math.floor(v.time * 6) % 2 === 0 ? 1 : 0.35;
      drawVfd(ctx, 'REKEY', cx, sy, { color: vfd, size: u * 1.3, align: 'center', ghost: true, intensity: on });
      const bw = S * 1.1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(vfd, 0.8);
      ctx.fillRect(cx - bw / 2, sy + u * 1.8, bw * (1 - v.telegraph.k), Math.max(2, u * 0.18));
    } else if (v.phase === 'ready') {
      drawVfd(ctx, 'CLICK OR SPACE  ENGAGE', cx, sy, { color: vfd, size: u * 0.9, align: 'center', intensity: 0.6 + 0.4 * Math.cos(v.time * 3) });
    } else if (v.phase === 'shatter' && v.lastTime !== null) {
      drawVfd(ctx, `CRACKED ${fix(v.lastTime, 4, 1)}S`, cx, sy, { color: vfd, size: u * 1.1, align: 'center', ghost: true });
    } else {
      drawVfd(ctx, '     ', cx, sy, { color: vfd, size: u * 1.3, align: 'center', ghost: true });
    }

    // Lock meter: 20 VFD bar cells under the facet.
    const my = cy + S * 1.45 + u * 0.6;
    const cells = 20;
    const cw = (S * 2.2) / cells;
    const lit = Math.round(v.meter * cells);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < cells; i++) {
      const x = cx - S * 1.1 + i * cw;
      const on = i < lit;
      ctx.fillStyle = rgba(vfd, on ? 0.85 * dim : 0.06);
      ctx.fillRect(x + cw * 0.12, my, cw * 0.76, u * 0.9);
      if (on) {
        ctx.fillStyle = rgba(vfd, 0.12 * dim);
        ctx.fillRect(x, my - u * 0.15, cw, u * 1.2);
      }
    }
    drawVfd(ctx, `LOCK ${pad(Math.floor(v.meter * 100), 3)}`, cx - S * 1.1, my + u * 1.4, { color: vfd, size: u * 0.7, ghost: true, intensity: dim });
    // Sync bar: the match m, with the 0.85 lock and 0.3 dissonance marks.
    const sw = S * 0.9;
    const sx0 = cx + S * 1.1 - sw;
    const sby = my + u * 1.55;
    ctx.fillStyle = rgba(vfd, 0.06);
    ctx.fillRect(sx0, sby, sw, u * 0.4);
    ctx.fillStyle = rgba(vfd, (v.m >= LOCK_THRESHOLD ? 0.95 : v.m < DISSONANCE_THRESHOLD ? 0.35 : 0.6) * dim);
    ctx.fillRect(sx0, sby, sw * v.m, u * 0.4);
    ctx.fillStyle = rgba(vfd, 0.5);
    ctx.fillRect(sx0 + sw * LOCK_THRESHOLD, sby - u * 0.2, Math.max(1, this.dpr), u * 0.8);
    ctx.fillRect(sx0 + sw * DISSONANCE_THRESHOLD, sby - u * 0.1, Math.max(1, this.dpr), u * 0.6);
    drawVfd(ctx, 'SYNC', sx0 - u * 0.5, my + u * 1.4, { color: vfd, size: u * 0.7, align: 'right', intensity: 0.6 * dim });

    // Knob readouts, left of the facet.
    const kx = cx - S * 1.45 - u * 0.8;
    drawVfd(ctx, `R ${fix(v.R, 5, 3)}`, kx, cy - u * 1.2, { color: BEAM.AMBER, size: u * 0.8, align: 'right', ghost: true, intensity: 0.8 * dim });
    drawVfd(ctx, `PHI ${pad(Math.round((((v.Phi % TAU) + TAU) % TAU) * (180 / Math.PI)), 3)}`, kx, cy + u * 0.4, { color: BEAM.AMBER, size: u * 0.8, align: 'right', ghost: true, intensity: 0.8 * dim });

    // EEG trace, bottom left.
    const ex = m;
    const eyc = h - u * 5.2;
    const ew = Math.min(w * 0.22, u * 14);
    const n = v.eeg.length;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(vfd, 0.75 * dim);
    ctx.lineWidth = this.dpr * 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const s = v.eeg[(v.eegHead + i) % n];
      const x = ex + (ew * i) / (n - 1);
      const y = eyc - s * u * 1.4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    drawVfd(ctx, 'EEG', ex, eyc - u * 2.6, { color: vfd, size: u * 0.55, intensity: 0.6 * dim });

    // Tries summary, right.
    const rx = w - m;
    let ry = h * 0.3;
    drawVfd(ctx, 'TIME TO LOCK', rx, ry, { color: vfd, size: u * 0.6, align: 'right', intensity: 0.7 * dim });
    ry += u * 1.1;
    drawVfd(ctx, v.summary.you, rx, ry, { color: vfd, size: u * 0.6, align: 'right', intensity: 0.9 * dim });
    ry += u * 1.0;
    drawVfd(ctx, v.summary.auto, rx, ry, { color: vfd, size: u * 0.6, align: 'right', intensity: 0.55 * dim });
    ry += u * 1.4;
    for (const line of v.summary.recent) {
      drawVfd(ctx, line, rx, ry, { color: vfd, size: u * 0.55, align: 'right', intensity: 0.5 * dim });
      ry += u * 0.9;
    }

    // Key help, bottom.
    const f = v.flags;
    const on = (b: boolean) => (b ? '*' : ' ');
    const help1 = '1 WHITE-1  2 GRAY-2  3 GRAY-3  4 BLACK-1     Z STORY  X NORMAL  C HARD     T TUNING  SPACE ENGAGE';
    const help2 = `MOUSE X RATIO  MOUSE Y PHASE  SHIFT FINE  ARROWS    B${on(f.bot)}AUTO  G${on(f.ghost)}GHOST  P${on(f.purist)}PURIST  F${on(f.reduceFlash)}CALM  M${on(f.muted)}MUTE`;
    drawVfd(ctx, help1, w / 2, h - u * 2.2, { color: vfd, size: u * 0.5, align: 'center', intensity: 0.45 });
    drawVfd(ctx, help2, w / 2, h - u * 1.2, { color: vfd, size: u * 0.5, align: 'center', intensity: 0.45 });
    if (!f.audio) drawVfd(ctx, 'AUDIO OFF  CLICK TO ENABLE', w - m, h - u * 4.2, { color: vfd, size: u * 0.5, align: 'right', intensity: 0.5 });
    if (f.bot) drawVfd(ctx, 'AUTO', m, m + u * 5.4, { color: BEAM.AMBER, size: u * 0.7, intensity: 0.8 });
  }
}

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function pad(n: number, len: number): string {
  return String(Math.max(0, n)).padStart(len, '0');
}

function fix(n: number, len: number, digits: number): string {
  return n.toFixed(digits).padStart(len, '0');
}
