import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';

const CAP = 360;
const DUST_MAX = 120;

const VERT = `
attribute float size;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (80.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vAlpha < 0.01) discard;
  float soft = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vColor, soft * vAlpha);
}
`;

export type BurstKind = 'spark' | 'ember' | 'shard';

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
  private cursor = 0;
  private dust = 0;
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
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('alpha', new BufferAttribute(this.alphas, 1));
    const material = new ShaderMaterial({
      uniforms: {},
      vertexShader: VERT,
      fragmentShader: FRAG,
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

  setFocus(x: number, y: number, z: number): void {
    this.focusX = x;
    this.focusY = y;
    this.focusZ = z;
  }

  burst(x: number, y: number, z: number, count: number, hex: number, kind: BurstKind = 'spark'): void {
    const color = new Color(hex);
    const room = CAP - DUST_MAX;
    const n = Math.min(count, this.budget, room);
    for (let i = 0; i < n; i++) {
      const index = this.cursor % room;
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
      this.colors[o] = color.r;
      this.colors[o + 1] = color.g;
      this.colors[o + 2] = color.b;
      this.life[index] = this.maxLife[index];
    }
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    const room = CAP - DUST_MAX;
    for (let i = 0; i < room; i++) this.step(i, dt, 2.4);
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
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
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
    this.alphas[index] = ratio;
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
    this.colors[o] = 0.75;
    this.colors[o + 1] = 0.88;
    this.colors[o + 2] = 1;
    this.maxLife[index] = 2.5 + Math.random() * 2.5;
    this.life[index] = this.maxLife[index];
    this.baseSize[index] = 3 + Math.random() * 4;
  }
}
