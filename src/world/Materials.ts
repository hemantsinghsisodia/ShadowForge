import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  type WebGLRenderer,
} from 'three';
import { mulberry32 } from '../core/random';
import { buildLabEnvScene } from './LabEnvironment';
import { LIGHTING } from './Lighting';
import { floorHeights, heightToNormal, metalHeights, stoneHeights } from './NormalMaps';

/** One seed per painter, so every texture is the same on every load. */
const SEED = {
  floorMap: 0xf1a0,
  metalMap: 0x3e7a,
  roughFloor: 0x7001,
  roughLamp: 0x7002,
  roughStone: 0x7003,
  floorNormal: 0xf10a,
  metalNormal: 0x3e7b,
  stoneNormal: 0x570e,
};

export type DetailTier = 'low' | 'medium' | 'high';
const DETAIL_SIZE: Record<Exclude<DetailTier, 'low'>, number> = { medium: 256, high: 512 };
const NORMAL_SCALE = 0.6;
const NORMAL_STRENGTH = 2;

/**
 * Assigns the env map to each material. Explicit maps ignore scene.environmentIntensity in r170,
 * so the intensity is set per material; clearing the map restores the default of 1.
 */
export function setLabEnv(materials: Iterable<MeshStandardMaterial>, texture: Texture | null): void {
  for (const material of materials) {
    material.envMap = texture;
    material.envMapIntensity = texture ? LIGHTING.env : 1;
    material.needsUpdate = true;
  }
}

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
  const rand = mulberry32(SEED.floorMap);
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
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.04})`;
      ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
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
  const rand = mulberry32(SEED.metalMap);
  return paint(128, 128, (ctx) => {
    ctx.fillStyle = '#646d7c';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 7; i++) {
      const x = rand() * 128;
      const y = rand() * 128;
      const radius = 22 + rand() * 26;
      const shade = 92 + Math.floor(rand() * 18);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${shade},${shade + 3},${shade + 8},0.35)`);
      gradient.addColorStop(1, 'rgba(100,109,124,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 160; i++) {
      const shade = 96 + Math.floor(rand() * 24);
      ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},0.16)`;
      ctx.fillRect(rand() * 128, rand() * 128, 1.5, 1.5);
    }
  });
}

function roughness(base: number, seed: number): CanvasTexture {
  const rand = mulberry32(seed);
  const texture = paint(64, 64, (ctx) => {
    const value = Math.floor(base * 255);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 30; i++) {
      const v = Math.max(0, Math.min(255, value + (rand() * 40 - 20)));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rand() * 64, rand() * 64, 3, 3);
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
  /** Low: no normal maps. Medium: 256 px. High: 512 px. Textures are built on first use and cached per size. */
  applyDetail(tier: DetailTier): void;
}

function normalTexture(heights: Float32Array, size: number, anisotropy: number): DataTexture {
  const texture = new DataTexture(heightToNormal(heights, size, size, NORMAL_STRENGTH), size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
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

/** Base colours for the procedural floor and wall, taken from the lighting config. */
export function labBaseColors(): { floor: number; wall: number } {
  return { floor: LIGHTING.floorTint, wall: LIGHTING.wallTint };
}

export function createLabMaterials(): LabMaterials {
  const base = labBaseColors();
  const floorTex = floorMap();
  const wallTex = wallMap();
  const metal = metalMap();
  const floor = new MeshStandardMaterial({
    map: floorTex,
    roughnessMap: roughness(0.72, SEED.roughFloor),
    color: base.floor,
    metalness: 0.45,
    roughness: 0.72,
  });
  const wall = new MeshStandardMaterial({
    map: wallTex,
    color: base.wall,
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
    roughnessMap: roughness(0.28, SEED.roughLamp),
    color: 0xffffff,
    metalness: 0.82,
    roughness: 0.28,
  });
  const stone = new MeshStandardMaterial({
    map: metal,
    roughnessMap: roughness(0.48, SEED.roughStone),
    color: 0x6d7888,
    metalness: 0.4,
    roughness: 0.48,
  });
  const node = new MeshStandardMaterial({ color: 0x8ee9ff, emissive: 0x39d7ff, emissiveIntensity: 1.1, roughness: 0.3 });
  const nodeHot = new MeshStandardMaterial({ color: 0xffd2a1, emissive: 0xffb15a, emissiveIntensity: 1.5, roughness: 0.3 });
  const all = [floor, wall, trim, lamp, stone, node, nodeHot];
  let anisotropy = 4;
  const normals = new Map<string, DataTexture>();
  const normalFor = (kind: 'floor' | 'metal' | 'stone', size: number): DataTexture => {
    const key = `${kind}:${size}`;
    let texture = normals.get(key);
    if (!texture) {
      const heights =
        kind === 'floor'
          ? floorHeights(size, SEED.floorNormal)
          : kind === 'metal'
            ? metalHeights(size, SEED.metalNormal)
            : stoneHeights(size, SEED.stoneNormal);
      texture = normalTexture(heights, size, anisotropy);
      normals.set(key, texture);
    }
    texture.anisotropy = anisotropy;
    return texture;
  };
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
      setLabEnv(all, texture);
    },
    setAnisotropy(max) {
      const value = Math.min(8, Math.max(1, max));
      anisotropy = value;
      const seen = new Set<Texture>();
      for (const material of all) {
        for (const tex of [material.map, material.roughnessMap]) {
          if (!tex || seen.has(tex)) continue;
          seen.add(tex);
          tex.anisotropy = value;
        }
      }
      for (const tex of normals.values()) tex.anisotropy = value;
    },
    applyDetail(tier) {
      const size = tier === 'low' ? 0 : DETAIL_SIZE[tier];
      const targets: [MeshStandardMaterial, 'floor' | 'metal' | 'stone'][] = [
        [floor, 'floor'],
        [lamp, 'metal'],
        [stone, 'stone'],
      ];
      for (const [material, kind] of targets) {
        const next = size ? normalFor(kind, size) : null;
        if (next && material.map) next.repeat.copy(material.map.repeat);
        const presenceChanged = (material.normalMap === null) !== (next === null);
        material.normalMap = next;
        material.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
        // Adding or removing a map recompiles the shader; swapping one size for another does not.
        if (presenceChanged) material.needsUpdate = true;
      }
    },
  };
}

export function buildEnvMap(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const envScene = buildLabEnvScene();
  const texture = pmrem.fromScene(envScene, 0.03).texture;
  envScene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  });
  pmrem.dispose();
  return texture;
}
