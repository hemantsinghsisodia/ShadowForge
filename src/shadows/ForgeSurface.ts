import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Mesh,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three';
import type { SurfaceDef } from './types';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D maskMap;
uniform vec2 cells;
uniform float time;
uniform float wave;
uniform vec3 color;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 m = texture2D(maskMap, vUv);
  float preview = m.r;
  float solid = m.g;
  float stab = m.b;
  vec2 texel = 1.0 / cells;
  float pr = texture2D(maskMap, vUv + vec2(texel.x, 0.0)).r;
  float pl = texture2D(maskMap, vUv - vec2(texel.x, 0.0)).r;
  float pu = texture2D(maskMap, vUv + vec2(0.0, texel.y)).r;
  float pd = texture2D(maskMap, vUv - vec2(0.0, texel.y)).r;
  float sr = texture2D(maskMap, vUv + vec2(texel.x, 0.0)).g;
  float sl = texture2D(maskMap, vUv - vec2(texel.x, 0.0)).g;
  float su = texture2D(maskMap, vUv + vec2(0.0, texel.y)).g;
  float sd = texture2D(maskMap, vUv - vec2(0.0, texel.y)).g;
  float pedge = preview * (1.0 - min(min(pr, pl), min(pu, pd)));
  float sedge = solid * (1.0 - min(min(sr, sl), min(su, sd)));
  vec2 cell = vUv * cells;
  vec2 row = vec2(cell.x + step(0.5, fract(cell.y * 0.5)) * 0.5, cell.y);
  vec2 hex = abs(fract(row) - 0.5);
  float grid = smoothstep(0.42, 0.5, max(hex.x, hex.y * 0.85));
  float flow = hash(floor(cell) + floor(time * 2.0));
  float scan = 0.55 + 0.45 * sin(cell.y * 3.1 - time * 4.0);
  float ripple = 0.5 + 0.5 * sin(vUv.x * 18.0 - time * 2.2 + flow);
  float age = time - wave;
  float ring = wave > 0.0 ? smoothstep(0.45, 0.0, abs(length(vUv - 0.5) * 2.2 - age * 1.6)) : 0.0;
  float dissolve = hash(floor(cell * 2.0));
  float broken = solid * smoothstep(stab + 0.05, stab - 0.15, dissolve);
  vec3 base = vec3(0.012, 0.025, 0.04);
  vec3 previewCol = color * (0.12 + 0.28 * scan * ripple) + color * pedge * 1.8 + color * flow * 0.08;
  vec3 hot = mix(vec3(1.0, 0.22, 0.12), color, clamp(stab, 0.0, 1.0));
  vec3 solidCol = hot * (0.55 + 0.35 * ripple) + color * sedge * 1.6;
  solidCol += vec3(1.0, 0.25, 0.15) * broken * 1.4;
  vec3 col = base + grid * vec3(0.05, 0.09, 0.12);
  col = mix(col, previewCol, clamp(preview * (1.0 - solid), 0.0, 1.0));
  col = mix(col, solidCol, solid * (1.0 - broken * 0.65));
  col += color * ring * 1.5;
  float alpha = 0.18 + preview * 0.45 + solid * 0.82 + pedge * 0.4 + grid * 0.1 + ring * 0.5;
  alpha *= mix(1.0, 0.25, broken);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export class ForgeSurface {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly texture: DataTexture;
  private readonly pixels: Uint8Array;

  constructor(readonly def: SurfaceDef) {
    const { cols, rows, sizeU, sizeV } = def;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const across = cols + 1;
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const u = (col / cols) * sizeU - sizeU / 2;
        const v = (row / rows) * sizeV - sizeV / 2;
        positions.push(
          def.origin.x + def.axisU.x * u + def.axisV.x * v,
          def.origin.y + def.axisU.y * u + def.axisV.y * v + 0.03,
          def.origin.z + def.axisU.z * u + def.axisV.z * v,
        );
        uvs.push(col / cols, row / rows);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const a = row * across + col;
        indices.push(a, a + across, a + 1, a + 1, a + across, a + across + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.pixels = new Uint8Array(cols * rows * 4);
    this.texture = new DataTexture(this.pixels as BufferSource, cols, rows, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.flipY = false;
    this.texture.colorSpace = NoColorSpace;
    this.texture.needsUpdate = true;
    this.material = new ShaderMaterial({
      uniforms: {
        maskMap: { value: this.texture },
        cells: { value: new Vector2(cols, rows) },
        time: { value: 0 },
        wave: { value: -10 },
        color: { value: new Vector3(0.35, 0.88, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  write(preview: Uint8Array, solid: Uint8Array, stability: number): void {
    const count = preview.length;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      this.pixels[o] = preview[i] ? 255 : 0;
      this.pixels[o + 1] = solid[i] ? 255 : 0;
      this.pixels[o + 2] = Math.max(0, Math.min(255, Math.round(stability * 255)));
      this.pixels[o + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  setTime(time: number): void {
    this.material.uniforms.time.value = time;
  }

  /** Solidify wave, measured from the current shader clock. */
  pulse(): void {
    this.material.uniforms.wave.value = this.material.uniforms.time.value as number;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
