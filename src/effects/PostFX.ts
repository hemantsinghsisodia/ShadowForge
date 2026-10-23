import { Color } from 'three';

/** A transient hit of presentation: added on top of the tier base each frame. */
export interface Punch {
  flash: number;
  exposure: number;
  bloom: number;
  ca: number;
  /** Hex colour of the flash. White when omitted. */
  flashColor?: number;
}

export const ZERO_PUNCH: Readonly<Punch> = Object.freeze({ flash: 0, exposure: 0, bloom: 0, ca: 0 });

export interface PunchResult {
  exposure: number;
  bloom: number;
  ca: number;
  flash: number;
}

export function applyPunch(
  base: { exposure: number; bloom: number; ca: number },
  p: Readonly<Punch>,
  out: PunchResult = { exposure: 0, bloom: 0, ca: 0, flash: 0 },
): PunchResult {
  out.exposure = base.exposure + p.exposure;
  out.bloom = base.bloom + p.bloom;
  out.ca = base.ca + p.ca;
  out.flash = p.flash;
  return out;
}

/** Full-screen grade for ShaderPass: vignette, film grain, a cool tint, a colour flash and chromatic aberration. */
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    time: { value: 0 },
    amount: { value: 1 },
    flash: { value: 0 },
    flashColor: { value: new Color(1, 1, 1) },
    ca: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    uniform float flash;
    uniform vec3 flashColor;
    uniform float ca;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      texel.rgb = vec3(
        texel.r == texel.r ? texel.r : 0.0,
        texel.g == texel.g ? texel.g : 0.0,
        texel.b == texel.b ? texel.b : 0.0);
      texel.rgb = min(max(texel.rgb, vec3(0.0)), vec3(64.0));
      if (ca > 0.0) {
        vec2 d = (vUv - 0.5) * ca * dot(vUv - 0.5, vUv - 0.5) * 4.0;
        float r = texture2D(tDiffuse, vUv + d).r;
        float b = texture2D(tDiffuse, vUv - d).b;
        r = r == r ? r : 0.0;
        b = b == b ? b : 0.0;
        texel.r = min(max(r, 0.0), 64.0);
        texel.b = min(max(b, 0.0), 64.0);
      }
      vec2 uv = vUv - 0.5;
      float vig = smoothstep(0.88, 0.3, length(uv * vec2(1.2, 1.05)));
      float grain = fract(sin(dot(vUv + fract(time * 0.37), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 col = texel.rgb;
      col *= mix(1.0, vig, 0.5 * amount);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= 1.0 + (grain - 0.5) * 0.06 * amount * smoothstep(0.002, 0.05, lum);
      col = mix(col, col * vec3(0.86, 0.96, 1.08) + vec3(0.008, 0.016, 0.03), amount);
      col += flashColor * flash * (0.25 + 0.75 * vig);
      gl_FragColor = vec4(col, texel.a);
    }
  `,
};
