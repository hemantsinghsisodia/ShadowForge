import {
  BoxGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
} from 'three';
import type { SolidBox } from '../shadows/types';
import { COLLAPSE_TIME, RISE_TIME, collapseProgress, riseProgress } from './ForgeTimeline';

/**
 * Instanced path: `aAxis` points from the base (the plate) toward the leading face, so `k` runs 0 at
 * the base to 1 at the tip and the box is pulled back along the axis by `(1 - rise)`. Without
 * instancing the box is drawn as-is.
 */
export const OBSIDIAN_VERT = `
varying vec3 vNormal;
varying vec3 vWorld;
varying float vK;
#ifdef USE_INSTANCING
attribute vec3 aAxis;
#endif
uniform float rise;
void main() {
  #ifdef USE_INSTANCING
  float k = dot(position, aAxis) + 0.5;
  vec3 p = position - aAxis * k * (1.0 - rise);
  vK = k;
  mat4 model = modelMatrix * instanceMatrix;
  #else
  vec3 p = position;
  vK = position.y + 0.5;
  mat4 model = modelMatrix;
  #endif
  vec4 world = model * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(model) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const OBSIDIAN_FRAG = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vK;
uniform float stab;
uniform float rise;
uniform float hot;
uniform vec3 color;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.4);
  vec3 tint = mix(vec3(0.95, 0.22, 0.12), color, clamp(stab, 0.0, 1.0));
  vec3 warm = mix(tint, vec3(1.0, 0.62, 0.28), (1.0 - smoothstep(0.15, 0.45, stab)));
  vec3 col = vec3(0.015, 0.03, 0.045) + warm * (0.22 + fres * 1.35);
  col += warm * fres * 1.8;
  float lead = smoothstep(0.75, 1.0, vK) * (1.0 - rise) * 3.0 + hot * 2.5;
  col += mix(color, vec3(1.0, 0.85, 0.6), 0.5) * lead;
  gl_FragColor = vec4(col, 0.78 + fres * 0.2);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Dark glassy solid shadow. `stab` is 1 when stable and 0 as it fails; `rise` 1 is fully grown, `hot` 1 is collapse heat. */
export function createObsidianMaterial(stability: number, color = new Color(0x5ce1ff)): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      stab: { value: stability },
      color: { value: new Color(color) },
      rise: { value: 1 },
      hot: { value: 0 },
    },
    vertexShader: OBSIDIAN_VERT,
    fragmentShader: OBSIDIAN_FRAG,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
}

/** Module-level unit cube every obsidian mesh is cloned from. Never disposed. */
export const OBSIDIAN_UNIT_BOX = new BoxGeometry(1, 1, 1);

const scratch = new Matrix4();

/**
 * One instanced mesh for a surface's boxes: instance matrix = translate(centre) * scale(w, h, d).
 * Each mesh gets its own clone of the unit box because the per-instance `aAxis` attribute lives on
 * the geometry, so the clone (not OBSIDIAN_UNIT_BOX) is what the caller disposes.
 */
export function buildObsidianMesh(boxes: SolidBox[], material: ShaderMaterial): InstancedMesh {
  const geometry = OBSIDIAN_UNIT_BOX.clone();
  const axes = new Float32Array(boxes.length * 3);
  const mesh = new InstancedMesh(geometry, material, boxes.length);
  boxes.forEach((box, i) => {
    const width = Math.max(0.05, box.maxX - box.minX);
    const height = Math.max(0.08, box.maxY - box.minY);
    const depth = Math.max(0.05, box.maxZ - box.minZ);
    scratch.makeScale(width, height, depth);
    scratch.setPosition((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    mesh.setMatrixAt(i, scratch);
    const none = box.nx === 0 && box.ny === 0 && box.nz === 0;
    axes[i * 3] = none ? 0 : box.nx;
    axes[i * 3 + 1] = none ? 1 : box.ny;
    axes[i * 3 + 2] = none ? 0 : box.nz;
  });
  geometry.setAttribute('aAxis', new InstancedBufferAttribute(axes, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export type SolidMode = 'rise' | 'idle' | 'collapse';

export interface SolidState {
  mode: SolidMode;
  t: number;
}

export interface SolidStep {
  rise: number;
  hot: number;
  done: boolean;
}

/** Shared scratch result: `stepSolid` returns this same object every call, so read it before the next call. */
const step: SolidStep = { rise: 1, hot: 0, done: false };

/**
 * Advances one surface's rise / idle / collapse state by `dt`. A rise may start at negative `t` (a delay): `rise` holds
 * at 0 until `t` reaches 0. Mutates `state.t` (and moves `rise` to
 * `idle` once grown) and returns the uniform values for this frame. `done` is true only when a collapse
 * has finished and the mesh can be disposed. Allocation-free.
 */
export function stepSolid(state: SolidState, dt: number): SolidStep {
  step.done = false;
  if (state.mode === 'rise') {
    state.t += dt;
    step.rise = riseProgress(state.t);
    step.hot = 0;
    if (state.t >= RISE_TIME) state.mode = 'idle';
  } else if (state.mode === 'collapse') {
    state.t += dt;
    step.rise = collapseProgress(state.t);
    step.hot = 1;
    step.done = state.t >= COLLAPSE_TIME;
  } else {
    step.rise = 1;
    step.hot = 0;
  }
  return step;
}
