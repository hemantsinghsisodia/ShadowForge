import { Color, DoubleSide, ShaderMaterial } from 'three';

const VERT = `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform float stab;
uniform vec3 color;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.4);
  vec3 tint = mix(vec3(0.95, 0.22, 0.12), color, clamp(stab, 0.0, 1.0));
  vec3 warm = mix(tint, vec3(1.0, 0.62, 0.28), smoothstep(0.45, 0.15, stab));
  vec3 col = vec3(0.015, 0.03, 0.045) + warm * (0.22 + fres * 1.35);
  col += warm * fres * 0.6;
  gl_FragColor = vec4(col, 0.78 + fres * 0.2);
}
`;

/** Dark glassy solid shadow. `stab` is 1 when stable and 0 as it fails. */
export function createObsidianMaterial(stability: number, color = new Color(0x5ce1ff)): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      stab: { value: stability },
      color: { value: new Color(color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
}
