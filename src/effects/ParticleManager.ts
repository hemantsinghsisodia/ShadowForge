import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';

const CAP = 360;
const DUST_MAX = 120;

export const PARTICLE_VERT = `
uniform float uScale;
attribute vec3 aColor;
attribute float size;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(64.0, size * uScale * 80.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vAlpha < 0.01) discard;
  float soft = 1.0 - smoothstep(0.05, 0.5, d);
  gl_FragColor = vec4(vColor, soft * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type BurstKind = 'spark' | 'ember' | 'shard';

/** Fixed colour multiplier for embers; sparks and shards are luminance-targeted via `kindIntensity`. Dust stays below the bloom threshold. */
export const KIND_INTENSITY: Record<BurstKind, number> = { spark: 3.0, shard: 2.5, ember: 2.0 };
/** Linear luma targets that sparks and shards are scaled to, so dark hues still clear the bloom threshold. */
export const SPARK_TARGET_LUMA = 3.0;
export const SHARD_TARGET_LUMA = 1.6;
const lumaScratch = new Color();

/** Linear Rec709 luma of `hex`. */
export function luminance(hex: number): number {
  lumaScratch.set(hex);
  return 0.2126 * lumaScratch.r + 0.7152 * lumaScratch.g + 0.0722 * lumaScratch.b;
}

/** Spark and shard colours are scaled toward SPARK_/SHARD_TARGET_LUMA (clamped to [1, 12]); embers keep their fixed value. */
export function kindIntensity(hex: number, kind: BurstKind): number {
  if (kind === 'ember') return KIND_INTENSITY.ember;
  const target = kind === 'shard' ? SHARD_TARGET_LUMA : SPARK_TARGET_LUMA;
  return Math.min(12, Math.max(1, target / Math.max(0.05, luminance(hex))));
}

export const DUST_INTENSITY = 0.6;
/** Warm ash 0xffd0a0: the raw bytes are treated as linear on purpose, which gives dust a pale warm-ash tint. */
const DUST_COLOR = { r: 0xff / 255, g: 0xd0 / 255, b: 0xa0 / 255 };
/** Rendered-alpha multiplier for dust motes so they stay subtle atmosphere. */
export const DUST_ALPHA = 0.3;

/** Round additive motes: forge sparks, embers, collapse shards and beam dust. */
export class ParticleManager {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly points: Points;
  private readonly uniforms = { uScale: { value: 1 } };
  private cursor = 0;
  private dust = 0;
  private hiAlive = 0;
  private colorDirty = false;
  private fullUpload = false;
  private focusX = 0;
  private focusY = 1;
  private focusZ = 0;
  budget: number;

  constructor(scene: Scene, budget: number) {
    this.budget = budget;
    this.positions = new Float32Array(CAP * 3);
    this.velocities = new Float32Array(CAP * 3);
    this.life = new Float32Array(CAP);
    this.maxLife = new Float32Array(CAP);
    this.colors = new Float32Array(CAP * 3);
    this.sizes = new Float32Array(CAP);
    this.alphas = new Float32Array(CAP);
    this.baseSize = new Float32Array(CAP);
    this.positions.fill(0);
    for (let i = 1; i < CAP * 3; i += 3) this.positions[i] = -999;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('alpha', new BufferAttribute(this.alphas, 1));
    for (const name of ['position', 'aColor', 'size', 'alpha']) {
      (this.geometry.getAttribute(name) as BufferAttribute).setUsage(DynamicDrawUsage);
    }
    // Dust colour is constant: write it once and upload it with the first frame.
    for (let i = CAP - DUST_MAX; i < CAP; i++) {
      this.colors[i * 3] = DUST_COLOR.r * DUST_INTENSITY;
      this.colors[i * 3 + 1] = DUST_COLOR.g * DUST_INTENSITY;
      this.colors[i * 3 + 2] = DUST_COLOR.b * DUST_INTENSITY;
    }
    this.fullUpload = true;
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setBudget(budget: number): void {
    this.budget = budget;
  }

  setDust(count: number): void {
    this.dust = Math.max(0, Math.min(DUST_MAX, count));
  }

  setPixelRatio(dpr: number): void {
    this.uniforms.uScale.value = dpr;
  }

  setFocus(x: number, y: number, z: number): void {
    this.focusX = x;
    this.focusY = y;
    this.focusZ = z;
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    hex: number,
    kind: BurstKind = 'spark',
    intensity: number = kindIntensity(hex, kind),
  ): void {
    const color = new Color(hex);
    const n = Math.min(count, this.budget, CAP - DUST_MAX);
    for (let i = 0; i < n; i++) this.spawn(x, y, z, color, kind, intensity);
  }

  /** Spawns `perPoint` particles at each packed xyz point, never exceeding the budget. */
  burstPoints(
    points: Float32Array,
    perPoint: number,
    hex: number,
    kind: BurstKind,
    dir?: [number, number, number],
    intensity: number = kindIntensity(hex, kind),
  ): void {
    const color = new Color(hex);
    let left = Math.min(this.budget, CAP - DUST_MAX);
    const count = Math.floor(points.length / 3);
    if (count === 0 || perPoint <= 0 || left <= 0) return;
    // Stride across the set when it does not fit, so the budget is not spent on the first points only.
    const step = Math.max(1, Math.ceil((count * perPoint) / left));
    for (let i = 0; i < count && left > 0; i += step) {
      const p = i * 3;
      for (let k = 0; k < perPoint && left > 0; k++, left--) {
        this.spawn(points[p], points[p + 1], points[p + 2], color, kind, intensity, dir);
      }
    }
  }

  update(dt: number): void {
    const room = CAP - DUST_MAX;
    let hi = 0;
    for (let i = 0; i < room; i++) {
      if (this.life[i] > 0) hi = i + 1;
      this.step(i, dt, 2.4);
    }
    this.hiAlive = hi;
    const dustStart = CAP - this.dust;
    for (let i = dustStart; i < CAP; i++) {
      if (this.life[i] <= 0) this.seedDust(i);
      this.step(i, dt, 0);
    }
    for (let i = CAP - DUST_MAX; i < dustStart; i++) {
      if (this.life[i] > 0) {
        this.life[i] = 0;
        this.positions[i * 3 + 1] = -999;
        this.alphas[i] = 0;
        this.fullUpload = true;
      }
    }
    this.upload(dustStart);
  }

  private upload(dustStart: number): void {
    if (this.hiAlive === 0 && this.dust === 0 && !this.fullUpload) return;
    for (const name of ['position', 'size', 'alpha']) {
      const attr = this.geometry.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      if (!this.fullUpload) {
        if (this.hiAlive > 0) attr.addUpdateRange(0, this.hiAlive * attr.itemSize);
        if (this.dust > 0) attr.addUpdateRange(dustStart * attr.itemSize, this.dust * attr.itemSize);
      }
      attr.needsUpdate = true;
    }
    if (this.colorDirty || this.fullUpload) {
      (this.geometry.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
      this.colorDirty = false;
    }
    this.fullUpload = false;
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    color: Color,
    kind: BurstKind,
    intensity: number,
    dir?: [number, number, number],
  ): void {
    const index = this.cursor % (CAP - DUST_MAX);
    this.cursor++;
    const o = index * 3;
    this.positions[o] = x + (Math.random() - 0.5) * 0.5;
    this.positions[o + 1] = y + Math.random() * 0.25;
    this.positions[o + 2] = z + (Math.random() - 0.5) * 0.5;
    if (kind === 'shard') {
      this.velocities[o] = (Math.random() - 0.5) * 3.4;
      this.velocities[o + 1] = 0.8 + Math.random() * 2.2;
      this.velocities[o + 2] = (Math.random() - 0.5) * 3.4;
      this.baseSize[index] = 7 + Math.random() * 6;
      this.maxLife[index] = 0.35 + Math.random() * 0.35;
    } else if (kind === 'ember') {
      this.velocities[o] = (Math.random() - 0.5) * 0.4;
      this.velocities[o + 1] = 0.25 + Math.random() * 0.55;
      this.velocities[o + 2] = (Math.random() - 0.5) * 0.4;
      this.baseSize[index] = 4 + Math.random() * 4;
      this.maxLife[index] = 0.8 + Math.random() * 0.7;
    } else {
      this.velocities[o] = (Math.random() - 0.5) * 1.8;
      this.velocities[o + 1] = 0.7 + Math.random() * 1.6;
      this.velocities[o + 2] = (Math.random() - 0.5) * 1.8;
      this.baseSize[index] = 5 + Math.random() * 5;
      this.maxLife[index] = 0.4 + Math.random() * 0.45;
    }
    if (dir) {
      this.velocities[o] += dir[0] * 1.6;
      this.velocities[o + 1] += dir[1] * 1.6;
      this.velocities[o + 2] += dir[2] * 1.6;
    }
    this.colors[o] = color.r * intensity;
    this.colors[o + 1] = color.g * intensity;
    this.colors[o + 2] = color.b * intensity;
    this.life[index] = this.maxLife[index];
    this.colorDirty = true;
  }

  private step(index: number, dt: number, gravity: number): void {
    if (this.life[index] <= 0) {
      this.alphas[index] = 0;
      this.sizes[index] = 0;
      return;
    }
    this.life[index] -= dt;
    const o = index * 3;
    this.velocities[o + 1] -= gravity * dt;
    this.positions[o] += this.velocities[o] * dt;
    this.positions[o + 1] += this.velocities[o + 1] * dt;
    this.positions[o + 2] += this.velocities[o + 2] * dt;
    const ratio = Math.max(0, this.life[index] / Math.max(0.05, this.maxLife[index]));
    this.alphas[index] = index >= CAP - DUST_MAX ? ratio * DUST_ALPHA : ratio;
    this.sizes[index] = this.baseSize[index] * (0.35 + ratio * 0.65);
    if (this.life[index] <= 0) {
      this.positions[o + 1] = -999;
      this.alphas[index] = 0;
    }
  }

  private seedDust(index: number): void {
    const o = index * 3;
    this.positions[o] = this.focusX + (Math.random() - 0.5) * 12;
    this.positions[o + 1] = this.focusY + 0.3 + Math.random() * 4.2;
    this.positions[o + 2] = this.focusZ + (Math.random() - 0.5) * 12;
    this.velocities[o] = (Math.random() - 0.5) * 0.2;
    this.velocities[o + 1] = 0.04 + Math.random() * 0.16;
    this.velocities[o + 2] = (Math.random() - 0.5) * 0.2;
    this.maxLife[index] = 2.5 + Math.random() * 2.5;
    this.life[index] = this.maxLife[index];
    this.baseSize[index] = 1.5 + Math.random() * 2;
  }
}
