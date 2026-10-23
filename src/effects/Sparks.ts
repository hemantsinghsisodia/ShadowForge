import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';
import { mulberry32 } from '../core/random';
import { GANTRY_PAUSE, GANTRY_SPEED, gantryX, trolleyRange, type Rail } from '../world/CavernLayout';
import { FORGE } from '../world/ForgePalette';

/** Per-spark constants; the GPU derives everything else from the clocks. vz already carries the away-from-corridor sign. */
export interface SparkSeed {
  phase: number;
  speed: number;
  vx: number;
  vz: number;
  size: number;
}

/** Sparks leave the hook, 3.2 m below the rail. */
const DROP = 3.2;
const GRAVITY = 9.0;
const MAX_VX = 0.4;
const MAX_VZ = 0.3;
/** Life 0.9-1.4 s. At 1.4 s a spark has fallen 8.82 m from 2.8 m up (RAIL_Y 6 less DROP), to -6.02, still above the abyss (-9). */
const MIN_LIFE = 0.9;
const MAX_LIFE = 1.4;
const HDR = 2.4;
const HOT = 0xffd27a;
/** The origin clock wraps here (a day); the life clock wraps at 600 so fract(time * speed + phase) stays continuous. */
const ABS_PERIOD = 86400;
const LIFE_PERIOD = 600;

/**
 * Deterministic sparks. `side` is +1 when the rail lies on the +Z side of the corridor and -1 on the -Z side, so vz
 * always points away from the play area.
 */
export function seedSparks(count: number, seed: number, side: 1 | -1 = 1): SparkSeed[] {
  const rand = mulberry32(seed);
  const slowest = Math.round(LIFE_PERIOD / MAX_LIFE);
  const fastest = Math.floor(LIFE_PERIOD / MIN_LIFE);
  const seeds: SparkSeed[] = [];
  for (let i = 0; i < count; i++) {
    const phase = rand();
    // A multiple of 1/600 keeps fract(600 * speed + phase) continuous across the `% 600` clock wrap.
    const k = Math.min(fastest, Math.max(slowest, Math.round(LIFE_PERIOD / (MIN_LIFE + rand() * (MAX_LIFE - MIN_LIFE)))));
    seeds.push({
      phase,
      speed: k / LIFE_PERIOD,
      vx: (rand() * 2 - 1) * MAX_VX,
      vz: rand() * MAX_VZ * side,
      size: 1 + rand(),
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

/**
 * CPU twin of the vertex shader: where a spark is, and how visible, at a given time. `time` is the wrapped life clock
 * (t % 600); `timeAbs` is the unwrapped origin clock (t % 86400) that places the trolley at the spark's birth. They are
 * equal below 600 s.
 */
export function sparkState(s: SparkSeed, time: number, rail: Rail, timeAbs: number = time): { x: number; y: number; z: number; alpha: number } {
  const life = fract(time * s.speed + s.phase);
  const age = life / s.speed;
  const birth = timeAbs - age;
  return {
    x: gantryX(birth, rail) + s.vx * age,
    y: rail.y - DROP - 0.5 * GRAVITY * age * age,
    z: rail.z + s.vz * age,
    alpha: smoothstep(0, 0.05, life) * (1 - smoothstep(0.6, 1, life)),
  };
}

export const SPARK_VERT = `
uniform float uTime;
uniform float uTimeAbs;
uniform float uScale;
uniform float uRailX0;
uniform float uRailX1;
uniform float uRailZ;
uniform float uRailY;
uniform float uSpeed;
uniform float uPause;
attribute vec4 aSeed;
attribute float aSize;
varying float vLife;
varying float vAlpha;

// Mirror of gantryX in CavernLayout.ts. uRailX0/uRailX1 hold the trolley range (trolleyRange), not the full rail;
// mod() is already positive for a positive period.
float gantryX(float t) {
  float travel = (uRailX1 - uRailX0) / uSpeed;
  float period = 2.0 * (travel + uPause);
  float u = mod(t, period);
  if (u < travel) return uRailX0 + uSpeed * u;
  if (u < travel + uPause) return uRailX1;
  if (u < 2.0 * travel + uPause) return uRailX1 - uSpeed * (u - travel - uPause);
  return uRailX0;
}

void main() {
  float life = fract(uTime * aSeed.y + aSeed.x);
  float age = life / aSeed.y;
  float birth = uTimeAbs - age;
  vec3 p = vec3(
    gantryX(birth) + aSeed.z * age,
    uRailY - ${DROP.toFixed(1)} - 0.5 * ${GRAVITY.toFixed(1)} * age * age,
    uRailZ + aSeed.w * age
  );
  vLife = life;
  vAlpha = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.6, 1.0, life));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(8.0 * uScale, aSize * uScale * 50.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const SPARK_FRAG = `
precision highp float;
uniform vec3 uHot;
uniform vec3 uEmber;
varying float vLife;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5 || vAlpha < 0.01) discard;
  float soft = 1.0 - smoothstep(0.05, 0.5, d);
  vec3 col = mix(uHot, uEmber, vLife) * ${HDR.toFixed(1)};
  gl_FragColor = vec4(col, soft * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Sparks falling from the gantry trolley's hook, animated entirely in the vertex shader from two time uniforms. */
export class Sparks {
  readonly points: Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uTimeAbs: { value: 0 },
    uScale: { value: 1 },
    uRailX0: { value: 0 },
    uRailX1: { value: 0 },
    uRailZ: { value: 0 },
    uRailY: { value: 0 },
    uSpeed: { value: GANTRY_SPEED },
    uPause: { value: GANTRY_PAUSE },
    uHot: { value: new Color(HOT) },
    uEmber: { value: new Color(FORGE.ember) },
  };

  constructor(seeds: SparkSeed[], rail: Rail) {
    // The same range the CPU gantryX and the trolley ping-pong over.
    const range = trolleyRange(rail);
    this.uniforms.uRailX0.value = range.x0;
    this.uniforms.uRailX1.value = range.x1;
    this.uniforms.uRailZ.value = rail.z;
    this.uniforms.uRailY.value = rail.y;
    const n = seeds.length;
    const seed = new Float32Array(n * 4);
    const size = new Float32Array(n);
    seeds.forEach((s, i) => {
      seed[i * 4] = s.phase;
      seed[i * 4 + 1] = s.speed;
      seed[i * 4 + 2] = s.vx;
      seed[i * 4 + 3] = s.vz;
      size[i] = s.size;
    });
    const geometry = new BufferGeometry();
    // The shader places every vertex itself; `position` only gives the draw call its vertex count.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 4));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      fog: false,
    });
    this.points = new Points(geometry, material);
    this.points.name = 'sparks';
    this.points.frustumCulled = false;
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t % LIFE_PERIOD;
    this.uniforms.uTimeAbs.value = t % ABS_PERIOD;
  }

  setPixelRatio(dpr: number): void {
    this.uniforms.uScale.value = dpr;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
