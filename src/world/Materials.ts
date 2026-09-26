import {
  BoxGeometry,
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  PMREMGenerator,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const LEVEL_ACCENTS = [
  0x5ce1ff, 0xffb15a, 0x9b8cff, 0x3ee0c8, 0x7dffe1, 0xd7e6ff, 0xff8a5c, 0x8ee9ff, 0x9ecbff, 0xffd2a1,
];

export function accentFor(levelId: number): Color {
  return new Color(LEVEL_ACCENTS[(Math.max(1, levelId) - 1) % LEVEL_ACCENTS.length]);
}

function paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function floorMap(): CanvasTexture {
  return paint(256, 256, (ctx) => {
    ctx.fillStyle = '#141923';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#243044';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * 256;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 256);
      ctx.moveTo(0, p);
      ctx.lineTo(256, p);
      ctx.stroke();
    }
    ctx.strokeStyle = '#1c6d86';
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(8, 8, 240, 240);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
}

function wallMap(): CanvasTexture {
  return paint(256, 256, (ctx) => {
    ctx.fillStyle = '#10151e';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 8; y < 256; y += 64) {
      for (let x = 8; x < 256; x += 84) {
        ctx.fillStyle = '#1a2230';
        ctx.fillRect(x, y, 72, 48);
        ctx.strokeStyle = '#2a3a52';
        ctx.strokeRect(x + 0.5, y + 0.5, 71, 47);
        ctx.fillStyle = '#16384a';
        ctx.fillRect(x + 6, y + 36, 28, 4);
      }
    }
  });
}

/** Soft mottling only. Row shading here reads as staircase bands on tall faces. */
function metalMap(): CanvasTexture {
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#646d7c';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const radius = 22 + Math.random() * 26;
      const shade = 92 + Math.floor(Math.random() * 18);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${shade},${shade + 3},${shade + 8},0.35)`);
      gradient.addColorStop(1, 'rgba(100,109,124,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 160; i++) {
      const shade = 96 + Math.floor(Math.random() * 24);
      ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},0.16)`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
  });
}

function roughness(base: number): CanvasTexture {
  const texture = paint(64, 64, (ctx) => {
    const value = Math.floor(base * 255);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 30; i++) {
      const v = Math.max(0, Math.min(255, value + (Math.random() * 40 - 20)));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
    }
  });
  texture.colorSpace = NoColorSpace;
  return texture;
}

export interface LabMaterials {
  floor: MeshStandardMaterial;
  wall: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  node: MeshStandardMaterial;
  nodeHot: MeshStandardMaterial;
  shared: Set<import('three').Material>;
  applyEnv(texture: Texture | null): void;
  setAnisotropy(max: number): void;
}

/**
 * Box whose texture repeats by real size, so a thin face is not squashed into dense lines.
 * Face order matches BoxGeometry: +x, -x, +y, -y, +z, -z.
 */
export function worldUvBox(width: number, height: number, depth: number, tile: number): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv');
  const spans: [number, number][] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  const perFace = uv.count / spans.length;
  for (let face = 0; face < spans.length; face++) {
    const repeatU = spans[face][0] / tile;
    const repeatV = spans[face][1] / tile;
    for (let i = 0; i < perFace; i++) {
      const index = face * perFace + i;
      uv.setXY(index, uv.getX(index) * repeatU, uv.getY(index) * repeatV);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

export function createLabMaterials(): LabMaterials {
  const floorTex = floorMap();
  const wallTex = wallMap();
  const metal = metalMap();
  const floor = new MeshStandardMaterial({
    map: floorTex,
    roughnessMap: roughness(0.72),
    color: 0xffffff,
    metalness: 0.45,
    roughness: 0.72,
  });
  const wall = new MeshStandardMaterial({
    map: wallTex,
    color: 0xffffff,
    metalness: 0.35,
    roughness: 0.8,
  });
  const trim = new MeshStandardMaterial({
    color: 0x9af6ff,
    emissive: 0x14586e,
    emissiveIntensity: 0.9,
    metalness: 0.2,
    roughness: 0.35,
  });
  const lamp = new MeshStandardMaterial({
    map: metal,
    roughnessMap: roughness(0.28),
    color: 0xffffff,
    metalness: 0.82,
    roughness: 0.28,
  });
  const stone = new MeshStandardMaterial({
    map: metal,
    roughnessMap: roughness(0.48),
    color: 0x6d7888,
    metalness: 0.4,
    roughness: 0.48,
  });
  const node = new MeshStandardMaterial({ color: 0x8ee9ff, emissive: 0x39d7ff, emissiveIntensity: 1.1, roughness: 0.3 });
  const nodeHot = new MeshStandardMaterial({ color: 0xffd2a1, emissive: 0xffb15a, emissiveIntensity: 1.5, roughness: 0.3 });
  const all = [floor, wall, trim, lamp, stone, node, nodeHot];
  return {
    floor,
    wall,
    trim,
    lamp,
    stone,
    node,
    nodeHot,
    shared: new Set(all),
    applyEnv(texture) {
      for (const material of all) material.envMap = texture;
      for (const material of all) material.needsUpdate = true;
    },
    setAnisotropy(max) {
      const value = Math.min(8, Math.max(1, max));
      const seen = new Set<Texture>();
      for (const material of all) {
        for (const tex of [material.map, material.roughnessMap]) {
          if (!tex || seen.has(tex)) continue;
          seen.add(tex);
          tex.anisotropy = value;
        }
      }
    },
  };
}

export function buildEnvMap(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}
