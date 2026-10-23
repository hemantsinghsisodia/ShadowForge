import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';
import type { CavernBounds } from '../world/ForgeCavern';
import { ABYSS_Y, FORGE } from '../world/ForgePalette';

/** Spawn point and motion constants of one ember; the GPU derives everything else from the clock. */
export interface EmberSeed {
  x: number;
  z: number;
  phase: number;
  speed: number;
  sway: number;
  size: number;
  rise: number;
}

const SIDE_RISE = 14;
const SIDE_GAP = 1.5;
const SIDE_REACH = 16;
const X_MARGIN = 20;
/** Under the corridor an ember must top out below the floor, so it can never show through a tile gap. */
const FLOOR_CEILING = -1;
const SIDE_SHARE = 0.8;
const HDR = 1.6;
const RED = 0xff3010;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic embers for a level: most in the side bands, the rest glowing up beneath the corridor. */
export function seedEmbers(count: number, bounds: CavernBounds, seed: number): EmberSeed[] {
  const rand = mulberry32(seed);
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  const halfDepth = (bounds.maxZ - bounds.minZ) / 2;
  const underShare = Math.round(1 / (1 - SIDE_SHARE));
  const seeds: EmberSeed[] = [];
  for (let i = 0; i < count; i++) {
    const x = bounds.minX - X_MARGIN + rand() * (bounds.maxX - bounds.minX + 2 * X_MARGIN);
    const under = i % underShare === underShare - 1;
    let z: number;
    let rise: number;
    if (under) {
      z = midZ + (rand() * 2 - 1) * halfDepth;
      rise = Math.min(SIDE_RISE, FLOOR_CEILING - ABYSS_Y);
    } else {
      const off = halfDepth + SIDE_GAP + rand() * (SIDE_REACH - SIDE_GAP);
      z = midZ + (rand() < 0.5 ? -off : off);
      rise = SIDE_RISE;
    }
    const phase = rand();
    // A multiple of 1/600 keeps fract(600 * speed + phase) continuous across the `% 600` clock wrap.
    const speed = Math.max(1, Math.round((0.04 + rand() * 0.06) * 600)) / 600;
    seeds.push({
      x,
      z,
      phase,
      speed,
      sway: 0.3 + rand() * 0.9,
      size: 1.4 + rand() * 1.8,
      rise,
    });
  }
  return seeds;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** CPU twin of the vertex shader: where an ember is, and how visible, at a given time. */
export function emberState(s: EmberSeed, time: number): { x: number; y: number; z: number; alpha: number } {
  const life = fract(time * s.speed + s.phase);
  return {
    x: s.x + Math.sin(life * 9.4 + s.phase * 40.0) * s.sway,
    y: ABYSS_Y + life * s.rise,
    z: s.z,
    alpha: smoothstep(0, 0.12, life) * (1 - smoothstep(0.65, 1, life)),
  };
}

export const EMBER_VERT = `
uniform float uTime;
uniform float uScale;
attribute vec4 aSeed;
attribute float aRise;
varying float vLife;
varying float vAlpha;
void main() {
  float life = fract(uTime * aSeed.y + aSeed.x);
  vec3 p = vec3(
    position.x + sin(life * 9.4 + aSeed.x * 40.0) * aSeed.z,
    ${ABYSS_Y.toFixed(1)} + life * aRise,
    position.z
  );
  vLife = life;
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.65, 1.0, life));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(14.0 * uScale, aSeed.w * uScale * 60.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const EMBER_FRAG = `
precision highp float;
uniform vec3 uEmber;
uniform vec3 uRed;
varying float vLife;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vAlpha < 0.01) discard;
  float soft = 1.0 - smoothstep(0.05, 0.5, d);
  vec3 col = mix(uEmber, uRed, vLife) * ${HDR.toFixed(1)};
  gl_FragColor = vec4(col, soft * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Embers rising out of the abyss, animated entirely in the vertex shader from a single time uniform. */
export class Embers {
  readonly points: Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uScale: { value: 1 },
    uEmber: { value: new Color(FORGE.ember) },
    uRed: { value: new Color(RED) },
  };

  constructor(seeds: EmberSeed[]) {
    const n = seeds.length;
    const position = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const rise = new Float32Array(n);
    seeds.forEach((s, i) => {
      position[i * 3] = s.x;
      position[i * 3 + 2] = s.z;
      seed[i * 4] = s.phase;
      seed[i * 4 + 1] = s.speed;
      seed[i * 4 + 2] = s.sway;
      seed[i * 4 + 3] = s.size;
      rise[i] = s.rise;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 4));
    geometry.setAttribute('aRise', new BufferAttribute(rise, 1));
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      fog: false,
    });
    this.points = new Points(geometry, material);
    this.points.name = 'embers';
    // The shader moves every vertex far from the bounds the geometry knows about.
    this.points.frustumCulled = false;
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t % 600;
  }

  setPixelRatio(dpr: number): void {
    this.uniforms.uScale.value = dpr;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
