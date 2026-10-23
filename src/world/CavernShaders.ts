/** Dave Hoskins' hash without sine, plus bilinear value noise. Used by the abyss. */
const NOISE = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
`;

export const DOME_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const DOME_FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uHaze;
  uniform vec3 uTop;
  void main() {
    vec3 dir = normalize(vDir);
    vec3 col = mix(uHaze, uTop, smoothstep(-0.25, 0.15, dir.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const MOLTEN_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const MOLTEN_FRAG = `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uCrust;
  uniform vec3 uGlowCol;
  uniform vec3 uCrackCol;
  uniform vec3 uHaze;
  uniform float uAbyssTime;
  uniform float uFlow;
  uniform float uGlow;
  uniform float uCrackHdr;
  uniform float uPulse;
  ${NOISE}
  float field(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < OCTAVES; i++) {
      sum += amp * vnoise(p);
      norm += amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }
  void main() {
    vec2 p = vWorld.xz * 0.18 + uFlow * uAbyssTime;
    #ifdef WARP
      p += 0.6 * vec2(vnoise(p + 3.1), vnoise(p - 1.7));
    #endif
    float n = field(p);
    float ridge = 1.0 - abs(2.0 * n - 1.0);
    float crack = smoothstep(0.88, 0.97, ridge);
    float halo = smoothstep(0.55, 0.92, ridge);
    vec3 col = uCrust * (0.6 + n) + uGlowCol * halo * uGlow * uPulse + uCrackCol * crack * uCrackHdr * uPulse;
    col = mix(col, uHaze, smoothstep(25.0, 70.0, distance(cameraPosition, vWorld)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const ROCK_VERT = `
  attribute float aRock;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRock;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vRock = aRock;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Unlit far walls: near-black rock, lit from below by the abyss glow (stronger on rock crests and up-facing ledges), fading to the dome's haze with distance. */
export const ROCK_FRAG = `
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRock;
  uniform vec3 uGlowCol;
  uniform vec3 uHaze;
  uniform vec3 uTop;
  uniform float uGlow;
  uniform float uPulse;
  uniform float uDark;
  void main() {
    float rock = 0.03 * (0.5 + vRock) * (0.7 + 0.6 * vRock);
    float ledge = (0.6 + 0.8 * (0.5 + 0.5 * vNormal.y));
    vec3 col = vec3(rock) + uGlowCol * uGlow * exp(-(vWorld.y + 9.0) * 0.16) * uPulse * 0.5 * mix(0.3, 1.5, smoothstep(0.25, 0.75, vRock)) * ledge;
    col *= uDark;
    col = mix(col, uTop, smoothstep(2.0, 18.0, vWorld.y));
    col = mix(col, uHaze, smoothstep(25.0, 70.0, distance(cameraPosition, vWorld)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
