import {
  BackSide,
  BufferAttribute,
  Color,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random';
import { Embers, seedEmbers } from '../effects/Embers';
import { DOME_FRAG, DOME_VERT, MOLTEN_FRAG, MOLTEN_VERT, ROCK_FRAG, ROCK_VERT } from './CavernShaders';
import type { PlatformConfig } from '../levels/LevelData';
import { chainSites, corridor, placeStructures, railLine, type Placement } from './CavernLayout';
import { CavernMotion } from './CavernMotion';
import type { ForgeKit } from './ForgeKit';
import { ABYSS_Y, CAVERN, FORGE, moltenPulse } from './ForgePalette';

export type CavernDetail = 'low' | 'medium' | 'high';
export interface CavernBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const MENU_BOUNDS: CavernBounds = { minX: -4.5, maxX: 4.5, minZ: -3, maxZ: 3 };
export { ABYSS_Y };

const DOME_RADIUS = 150;
const EMBER_SEED = 1337;
const NUMERIC_KEYS = ['crackHdr', 'glow', 'flow', 'fogDensity'] as const;
const BOOLEAN_KEYS = ['embers', 'structures', 'walls', 'chains', 'gantry', 'sparks'] as const;
type BooleanKey = (typeof BOOLEAN_KEYS)[number];
/** The abyss noise scrolls slowly, so it wraps far later than the embers (which stay on 600). */
const ABYSS_PERIOD = 6000;

const UP = new Vector3(0, 1, 0);

const WALL_HEIGHT = 40;
const WALL_CENTRE_Y = 6;
const WALL_DISPLACE = 10;
/** Offset of the wall pair from the corridor edge. */
const WALL_NEAR = 28;

/** Deterministic lattice value in [0, 1) for an integer cell, hashed through mulberry32. */
function lattice(ix: number, iy: number, seed: number): number {
  return mulberry32((Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0)();
}

/** Smooth bilinear value noise in [0, 1). */
function vnoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = lattice(ix, iy, seed) * (1 - ux) + lattice(ix + 1, iy, seed) * ux;
  const bottom = lattice(ix, iy + 1, seed) * (1 - ux) + lattice(ix + 1, iy + 1, seed) * ux;
  return top * (1 - uy) + bottom * uy;
}

/** Two octaves of ridged value noise (1 - |2n - 1| per octave), normalised to [0, 1]. */
function fbm2(x: number, y: number, seed: number): number {
  const ridge = (n: number) => 1 - Math.abs(2 * n - 1);
  return (ridge(vnoise2(x, y, seed)) + 0.5 * ridge(vnoise2(x * 2.03, y * 2.03, seed + 1))) / 1.5;
}

/**
 * A far rock wall: a plane facing +Z (local XY, 40 tall, centred), displaced along +Z by aRock * WALL_DISPLACE on the CPU. The
 * ridged fbm, contrast-stretched around 0.5, is the aRock attribute so the shader can vary the rock tone. Deterministic per seed.
 */
export function rockCard(length: number, segX: number, segY: number, seed: number): BufferGeometry {
  const geometry = new PlaneGeometry(length, WALL_HEIGHT, segX, segY);
  const position = geometry.getAttribute('position');
  const rock = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const n = fbm2(position.getX(i) * 0.14, position.getY(i) * 0.2, seed);
    const r = Math.min(1, Math.max(0, (n - 0.5) * 2.2 + 0.5));
    rock[i] = r;
    position.setZ(i, r * WALL_DISPLACE);
  }
  geometry.setAttribute('aRock', new BufferAttribute(rock, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Bakes placements into one merged Mesh per distinct kit material (so one draw call each). Kit geometry is
 * cloned and transformed, never modified; placements whose piece the kit lacks are skipped. Attributes that
 * not every geometry of a material carries are dropped before merging (the forge kit needs only position and
 * normal), and mixed indexed/non-indexed geometries are flattened, so mergeGeometries cannot fail on them.
 * The meshes own their merged geometry; the materials stay the kit's.
 */
export function bakeByMaterial(placements: Placement[], kit: Pick<ForgeKit, 'prototype'>): Mesh[] {
  const groups = new Map<Material, BufferGeometry[]>();
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  for (const placement of placements) {
    const parts = kit.prototype(placement.piece);
    if (!parts) continue;
    matrix.compose(position.fromArray(placement.position), quaternion.setFromAxisAngle(UP, placement.rotationY), scale.fromArray(placement.scale));
    for (const part of parts) {
      const clones = groups.get(part.material) ?? [];
      clones.push(part.geometry.clone().applyMatrix4(matrix));
      groups.set(part.material, clones);
    }
  }
  const meshes: Mesh[] = [];
  for (const [material, clones] of groups) {
    const shared = Object.keys(clones[0].attributes).filter((name) => clones.every((geometry) => geometry.hasAttribute(name)));
    const mixed = clones.some((geometry) => geometry.index) && clones.some((geometry) => !geometry.index);
    const prepared = clones.map((geometry) => {
      for (const name of Object.keys(geometry.attributes)) if (!shared.includes(name)) geometry.deleteAttribute(name);
      if (!mixed || !geometry.index) return geometry;
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      return flat;
    });
    const merged = mergeGeometries(prepared);
    for (const geometry of prepared) geometry.dispose();
    if (!merged) {
      console.warn('[ForgeCavern] mergeGeometries failed for a kit material; its structures are skipped.');
      continue;
    }
    const mesh = new Mesh(merged, material);
    mesh.name = 'structures';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    meshes.push(mesh);
  }
  return meshes;
}

/** The forge cavern around the level: a dome that rides the camera and a molten abyss under the floor. */
export class ForgeCavern {
  /** World space: the abyss (and later embers and structures). */
  readonly group = new Group();
  /** Follows the camera. */
  readonly dome = new Group();
  private detail: CavernDetail;
  private bounds: CavernBounds = MENU_BOUNDS;
  private slabs: PlatformConfig[] = [];
  private seed = 0;
  private mountKey: string | null = null;
  private readonly domeMesh: Mesh;
  private readonly abyssMesh: Mesh;
  private embers: Embers | null = null;
  private emberCount = 0;
  private emberBounds: CavernBounds | null = null;
  private time = 0;
  private pixelRatio = 1;
  private kit: ForgeKit | null = null;
  private structures: Mesh[] = [];
  private structureKey: string | null = null;
  private walls: Mesh[] = [];
  private wallKey: string | null = null;
  private readonly motion = new CavernMotion();
  private motionKey: string | null = null;
  /** The objects each boolean layer switch controls. A new layer adds one line; tune and every rebuild apply it. */
  private readonly visibility: Record<BooleanKey, () => Object3D[]> = {
    embers: () => (this.embers ? [this.embers.points] : []),
    structures: () => this.structures,
    walls: () => this.walls,
    chains: () => this.motion.chainObjects,
    gantry: () => this.motion.gantryObjects,
    sparks: () => [],
  };
  // Shared by every material the tiers build, so time, pulse and tuning survive a rebuild.
  private readonly uniforms = {
    uAbyssTime: { value: 0 },
    uPulse: { value: 1 },
    uFlow: { value: CAVERN.flow },
    uGlow: { value: CAVERN.glow },
    uCrackHdr: { value: CAVERN.crackHdr },
    uCrust: { value: new Color(FORGE.crust) },
    uGlowCol: { value: new Color(FORGE.glow) },
    uCrackCol: { value: new Color(FORGE.crack) },
    uHaze: { value: new Color(FORGE.haze) },
    uTop: { value: new Color(FORGE.top) },
  };

  constructor() {
    this.group.name = 'cavern';
    this.dome.name = 'cavern-dome';
    this.detail = 'medium';

    this.domeMesh = new Mesh(this.domeGeometry(this.detail), this.domeMaterial());
    this.domeMesh.frustumCulled = false;
    this.domeMesh.renderOrder = -1;
    this.dome.add(this.domeMesh);

    this.abyssMesh = new Mesh(new PlaneGeometry(1, 1), this.abyssMaterial(this.detail));
    this.abyssMesh.name = 'abyss';
    this.abyssMesh.renderOrder = 1;
    this.group.add(this.abyssMesh);
    this.group.add(this.motion.group);
    this.mount(this.bounds);
  }

  /** Rebuilds the tier-dependent resources only when the detail changes. */
  setDetail(detail: CavernDetail, embers: number): void {
    this.emberCount = Math.max(0, Math.floor(embers));
    this.syncEmbers();
    if (detail !== this.detail) {
      this.detail = detail;
      this.domeMesh.geometry.dispose();
      (this.domeMesh.material as ShaderMaterial).dispose();
      this.domeMesh.geometry = this.domeGeometry(detail);
      this.domeMesh.material = this.domeMaterial();
      (this.abyssMesh.material as ShaderMaterial).dispose();
      this.abyssMesh.material = this.abyssMaterial(detail);
    }
    this.syncStructures();
    this.syncMotion();
    this.syncWalls();
  }

  /** Hands over the forge kit (or null) the structures are baked from. */
  setKit(kit: ForgeKit | null): void {
    this.kit = kit;
    this.syncStructures();
    this.syncMotion();
  }

  /** Sizes and centres the abyss for a level, or for the menu. A repeat call with equal arguments does nothing. */
  mount(bounds: CavernBounds, slabs: PlatformConfig[] = [], seed = 0): void {
    const { minX, maxX, minZ, maxZ } = bounds;
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return;
    const key = JSON.stringify([minX, maxX, minZ, maxZ, seed, slabs.map((s) => [s.position, s.size])]);
    if (key === this.mountKey) return;
    this.mountKey = key;
    this.bounds = bounds;
    this.slabs = slabs;
    this.seed = seed;
    this.abyssMesh.geometry.dispose();
    const geometry = new PlaneGeometry(maxX - minX + 120, maxZ - minZ + 100);
    geometry.rotateX(-Math.PI / 2);
    this.abyssMesh.geometry = geometry;
    this.abyssMesh.position.set((minX + maxX) / 2, ABYSS_Y, (minZ + maxZ) / 2);
    this.syncEmbers();
    this.syncStructures();
    this.syncMotion();
    this.syncWalls();
  }

  /** What the cavern was last mounted for; structures read this. */
  get mounted(): { bounds: CavernBounds; slabs: PlatformConfig[]; seed: number } {
    return { bounds: this.bounds, slabs: this.slabs, seed: this.seed };
  }

  follow(camera: Vector3): void {
    this.dome.position.copy(camera);
  }

  setPixelRatio(dpr: number): void {
    this.pixelRatio = dpr;
    this.embers?.setPixelRatio(dpr);
  }

  update(time: number): void {
    this.time = time;
    this.embers?.setTime(time);
    this.uniforms.uAbyssTime.value = time % ABYSS_PERIOD;
    this.uniforms.uPulse.value = moltenPulse(time);
    this.motion.update(time);
  }

  /** Live tuning hook (__SF.cavern): merges finite numbers and booleans into CAVERN and pushes the uniforms. */
  tune(partial: Partial<typeof CAVERN>): typeof CAVERN {
    for (const key of NUMERIC_KEYS) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) CAVERN[key] = value;
    }
    for (const key of BOOLEAN_KEYS) {
      const value = partial[key];
      if (typeof value === 'boolean') CAVERN[key] = value;
    }
    this.applyVisibility();
    this.uniforms.uCrackHdr.value = CAVERN.crackHdr;
    this.uniforms.uGlow.value = CAVERN.glow;
    this.uniforms.uFlow.value = CAVERN.flow;
    return { ...CAVERN };
  }

  /** Pushes every boolean layer switch in CAVERN onto the objects it controls. */
  private applyVisibility(): void {
    for (const key of BOOLEAN_KEYS) for (const object of this.visibility[key]()) object.visible = CAVERN[key];
  }

  /** Rebuilds the embers only when the count or the bounds they were seeded for have changed. */
  private syncEmbers(): void {
    const b = this.bounds;
    const e = this.emberBounds;
    const same = e !== null && e.minX === b.minX && e.maxX === b.maxX && e.minZ === b.minZ && e.maxZ === b.maxZ;
    const built = this.embers ? this.embers.points.geometry.getAttribute('position').count : 0;
    if (same && built === this.emberCount) return;
    if (this.embers) {
      this.group.remove(this.embers.points);
      this.embers.dispose();
      this.embers = null;
    }
    this.emberBounds = { ...b };
    if (this.emberCount <= 0) return;
    this.embers = new Embers(seedEmbers(this.emberCount, b, EMBER_SEED));
    this.embers.setTime(this.time);
    this.embers.setPixelRatio(this.pixelRatio);
    this.group.add(this.embers.points);
    this.applyVisibility();
  }

  /** Rebakes the structures only when the detail, bounds, slabs, seed or kit presence have changed. */
  private syncStructures(): void {
    const key = [this.detail, JSON.stringify(this.bounds), JSON.stringify(this.slabs.map((s) => [s.position, s.size])), this.seed, this.kit ? 1 : 0].join('|');
    if (key === this.structureKey) return;
    for (const mesh of this.structures) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.structures = [];
    try {
      this.structures = this.kit ? bakeByMaterial(placeStructures(this.bounds, this.slabs, this.detail, this.seed), this.kit) : [];
    } catch (error) {
      // Leave the key unset so the next sync retries.
      console.error('ForgeCavern: structure bake failed; continuing without structures', error);
      return;
    }
    this.structureKey = key;
    for (const mesh of this.structures) this.group.add(mesh);
    this.applyVisibility();
  }

  /** Rebuilds the chains and gantry only when the detail, bounds, seed or kit presence have changed (slabs do not move them). */
  private syncMotion(): void {
    const key = [this.detail, JSON.stringify(this.bounds), this.seed, this.kit ? 1 : 0].join('|');
    if (key === this.motionKey) return;
    try {
      this.motion.build(railLine(this.bounds, this.detail), chainSites(this.bounds, this.detail, this.seed), this.kit);
    } catch (error) {
      // Leave the key unset so the next sync retries.
      console.error('ForgeCavern: chain build failed; continuing without chains', error);
      return;
    }
    this.motionKey = key;
    this.applyVisibility();
  }

  /** Rebuilds the rock walls only when the detail, bounds or seed have changed. */
  private syncWalls(): void {
    const key = [this.detail, JSON.stringify(this.bounds), this.seed].join('|');
    if (key === this.wallKey) return;
    this.wallKey = key;
    for (const mesh of this.walls) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
    this.walls = [];
    const { minX, maxX } = this.bounds;
    const { midZ, halfDepth } = corridor(this.bounds);
    const length = maxX - minX + 120;
    const [segX, segY] = this.detail === 'low' ? [48, 8] : [96, 16];
    for (const side of [1, -1]) {
      const mesh = new Mesh(
        rockCard(length, segX, segY, this.seed * 7 + (side > 0 ? 0 : 1)),
        new ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: ROCK_VERT,
          fragmentShader: ROCK_FRAG,
          fog: false,
        }),
      );
      mesh.name = 'walls';
      mesh.position.set((minX + maxX) / 2, WALL_CENTRE_Y, midZ + side * (halfDepth + WALL_NEAR));
      mesh.rotation.y = side > 0 ? Math.PI : 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.walls.push(mesh);
      this.group.add(mesh);
    }
    this.applyVisibility();
  }

  private domeGeometry(detail: CavernDetail): BufferGeometry {
    return detail === 'low' ? new SphereGeometry(DOME_RADIUS, 24, 12) : new SphereGeometry(DOME_RADIUS, 32, 16);
  }

  private domeMaterial(): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
  }

  private abyssMaterial(detail: CavernDetail): ShaderMaterial {
    const defines: Record<string, number> = { OCTAVES: detail === 'low' ? 1 : detail === 'medium' ? 2 : 3 };
    if (detail === 'high') defines.WARP = 1;
    return new ShaderMaterial({
      uniforms: this.uniforms,
      defines,
      vertexShader: MOLTEN_VERT,
      fragmentShader: MOLTEN_FRAG,
      fog: false,
    });
  }
}
