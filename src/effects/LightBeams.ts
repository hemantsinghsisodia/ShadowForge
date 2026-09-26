import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from 'three';

const BEAM_VERT = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BEAM_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 color;
uniform float strength;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 1.6);
  float along = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
  float dist = length(cameraPosition - vWorld);
  float nearFade = smoothstep(0.6, 2.4, dist);
  float alpha = fres * along * strength * 0.28 * nearFade;
  gl_FragColor = vec4(color, alpha);
}
`;

function haloTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, 'rgba(255,220,170,0.45)');
  gradient.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

const haloMap = haloTexture();
const down = new Vector3(0, -1, 0);

export interface BeamView {
  cone: Mesh;
  halo: Sprite;
  material: ShaderMaterial;
}

export function createBeam(color: Color): BeamView {
  const material = new ShaderMaterial({
    uniforms: {
      color: { value: color.clone() },
      strength: { value: 1 },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const cone = new Mesh(new ConeGeometry(0.9, 1, 16, 1, true), material);
  cone.frustumCulled = false;
  cone.renderOrder = 1;
  const halo = new Sprite(
    new SpriteMaterial({
      map: haloMap,
      color,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0.85,
    }),
  );
  halo.scale.set(0.7, 0.7, 1);
  return { cone, halo, material };
}

/** Point the cone from the lamp toward `direction`, with `length` in world units. */
export function aimBeam(view: BeamView, direction: Vector3, length: number, strength: number): void {
  const dir = direction.clone().normalize();
  view.cone.quaternion.setFromUnitVectors(down, dir);
  view.cone.scale.set(Math.min(1.1, 0.18 + length * 0.04), Math.max(0.4, length), Math.min(1.1, 0.18 + length * 0.04));
  view.cone.position.copy(dir).multiplyScalar(length * 0.5);
  view.material.uniforms.strength.value = strength;
  view.cone.visible = strength > 0.02;
  view.halo.visible = strength > 0.02;
  const sprite = view.halo.material as SpriteMaterial;
  sprite.opacity = 0.35 + strength * 0.5;
}
