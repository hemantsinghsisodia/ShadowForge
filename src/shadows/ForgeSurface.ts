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
uniform vec3 color;
varying vec2 vUv;

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
  vec2 gridUv = abs(fract(vUv * cells) - 0.5);
  float grid = smoothstep(0.46, 0.5, max(gridUv.x, gridUv.y));
  float ripple = 0.5 + 0.5 * sin(vUv.x * 16.0 - time * 2.2);
  float pulse = 0.5 + 0.5 * sin(time * 3.0);
  vec3 base = vec3(0.015, 0.03, 0.045);
  vec3 previewCol = color * (0.16 + 0.22 * ripple) + color * pedge * (1.3 + pulse * 0.4);
  vec3 hot = mix(vec3(0.9, 0.22, 0.18), color, clamp(stab, 0.0, 1.0));
  vec3 solidCol = hot * (0.85 + 0.2 * ripple) + color * sedge;
  vec3 col = base + grid * vec3(0.04, 0.07, 0.09);
  col = mix(col, previewCol, clamp(preview * (1.0 - solid), 0.0, 1.0));
  col = mix(col, solidCol, solid);
  float warp = pedge * sin(time * 6.0 + vUv.y * 30.0) * 0.04;
  col += color * abs(warp);
  float alpha = 0.16 + preview * 0.42 + solid * 0.78 + pedge * 0.35 + grid * 0.12;
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

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
