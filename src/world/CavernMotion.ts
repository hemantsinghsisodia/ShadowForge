import {
  BoxGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAIL_Y, gantryX, swayAngle, type ChainSite, type Rail } from './CavernLayout';
import type { ForgeKit } from './ForgeKit';

const LINK_PITCH = 0.14;
const LINK_RADIUS = 0.09;
const LINK_TUBE = 0.025;
const HOOK_RADIUS = 0.25;
const HOOK_TUBE = 0.04;
/** The trolley chain hangs this far below the rail. */
const TROLLEY_DROP = 3;
const CARRIAGE_SIZE: [number, number, number] = [0.8, 0.5, 0.8];
const CARRIAGE_LIFT = 0.25;
/** The shared chain geometry is built at this length; instances scale in Y by length / CHAIN_BASE_LENGTH. */
const CHAIN_BASE_LENGTH = 6;
/**
 * The primary swing is about the X axis, so it moves the tip in Z. The cross sway is about the Z axis, so it moves the tip in X;
 * it is a quarter of the primary amplitude, offset in phase so the tip traces a loose ellipse.
 */
const CROSS_SWAY = 0.25;
const CROSS_PHASE = 1.3;
/** The trolley chain's own gentle sway: amplitude (rad), period (s), phase. */
const TROLLEY_SWAY = { amp: 0.04, period: 6, phase: 0.7 } as const;

// Module scratch: update() writes every matrix through these and allocates nothing.
const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler(0, 0, 0, 'XYZ');
const position = new Vector3();
const scale = new Vector3();
const offset = new Vector3();
const ONE = new Vector3(1, 1, 1);

/**
 * A chain hanging down from y = 0 to y = -length: ceil(length / 0.14) merged torus links at roughly a 0.14 m pitch, each
 * turned 90 degrees from the last so neighbours interlock. The merged links are then fitted in Y so the first link's top is
 * exactly y = 0 and the last link's bottom exactly y = -length (a few percent of link squash). CavernMotion builds one at
 * CHAIN_BASE_LENGTH (6) and scales each instance by length / 6 in Y, which keeps its end on the hook that follows it (at -length)
 * while limiting the stretch of the links for the 3-7 m chains.
 */
export function chainLinkGeometry(length: number): BufferGeometry {
  const count = Math.max(1, Math.ceil(length / LINK_PITCH));
  const links: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const link = new TorusGeometry(LINK_RADIUS, LINK_TUBE, 3, 6);
    if (i % 2 === 1) link.rotateY(Math.PI / 2);
    link.translate(0, -(i + 0.5) * LINK_PITCH, 0);
    links.push(link);
  }
  const merged = mergeGeometries(links);
  for (const link of links) link.dispose();
  if (!merged) throw new Error('CavernMotion: chain links failed to merge');
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox!;
  merged.translate(0, -max.y, 0);
  merged.scale(1, length / (max.y - min.y), 1);
  merged.computeBoundingBox();
  return merged;
}

/** An open three-quarter ring, its eye at the top (y = 0) so it hangs from a chain end; the throat opens up and to +X. */
export function hookGeometry(): BufferGeometry {
  const hook = new TorusGeometry(HOOK_RADIUS, HOOK_TUBE, 4, 10, Math.PI * 1.5);
  hook.rotateZ(Math.PI / 2);
  hook.translate(0, -HOOK_RADIUS, 0);
  return hook;
}

/** Sets an instance (or any) matrix to T(pivot) * R(euler) * S(1, length / CHAIN_BASE_LENGTH, 1). */
function composeChain(target: Matrix4, pivotX: number, pivotY: number, pivotZ: number, quat: Quaternion, length: number): void {
  target.compose(position.set(pivotX, pivotY, pivotZ), quat, scale.set(1, length / CHAIN_BASE_LENGTH, 1));
}

/**
 * The cavern's moving parts: swaying chains hung from the gantry rail and the ceiling, a hook on each chain end, and a trolley
 * (carriage, chain and hook) riding the rail. Pure layout comes from CavernLayout; this class only builds meshes and writes
 * instance matrices. Kit materials are borrowed; only geometries and fallback materials made here are disposed.
 */
export class CavernMotion {
  /** World space; ForgeCavern adds it to its own group. */
  readonly group = new Group();
  private rail: Rail | null = null;
  private sites: ChainSite[] = [];
  private chains: InstancedMesh | null = null;
  private hooks: InstancedMesh | null = null;
  private trolleyChain: InstancedMesh | null = null;
  private trolleyHook: InstancedMesh | null = null;
  private carriage: Mesh | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly ownedMaterials: MeshStandardMaterial[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'cavern-motion';
  }

  /** The chain and hook meshes the `chains` layer switch controls. */
  get chainObjects(): Object3D[] {
    return [this.chains, this.hooks].filter((object): object is InstancedMesh => object !== null);
  }

  /** The trolley meshes the `gantry` layer switch controls. */
  get gantryObjects(): Object3D[] {
    return [this.carriage, this.trolleyChain, this.trolleyHook].filter((object): object is Mesh | InstancedMesh => object !== null);
  }

  /** Replaces whatever was built. A null rail builds nothing (low detail, or a level with no towers). */
  build(rail: Rail | null, sites: ChainSite[], kit: Pick<ForgeKit, 'allMaterials'> | null): void {
    this.clear();
    if (!rail) return;
    this.rail = rail;
    this.sites = sites;

    const kitMaterial = (name: string) => kit?.allMaterials?.().find((material) => material.name === `SHF_MAT_${name}`);
    const material = (name: string, fallback: number) => {
      const found = kitMaterial(name);
      if (found) return found;
      const own = new MeshStandardMaterial({ name: `forge-${name}`, color: fallback, roughness: 0.7, metalness: 0.6 });
      this.ownedMaterials.push(own);
      return own;
    };
    const graphite = material('Graphite', 0x2a2a2e);
    const steel = material('Steel', 0x8a8f96);
    // The carriage reads against the dark in the kit's amber; without it, the dark metal.
    const carriageMaterial = kitMaterial('WarningAmber') ?? material('DarkMetal', 0x1c1c20);

    const chainGeometry = chainLinkGeometry(CHAIN_BASE_LENGTH);
    const hook = hookGeometry();
    // The carriage is intentionally a plain box: SHF_Prop_MaintenanceBox is not in FORGE_KIT, which stays the five structure pieces.
    const carriageGeometry = new BoxGeometry(...CARRIAGE_SIZE);
    this.geometries.push(chainGeometry, hook, carriageGeometry);

    this.chains = this.instanced('chains', chainGeometry, graphite, sites.length);
    this.hooks = this.instanced('hooks', hook, steel, sites.length);
    this.trolleyChain = this.instanced('trolley-chain', chainGeometry, graphite, 1);
    this.trolleyHook = this.instanced('trolley-hook', hook, steel, 1);
    this.carriage = new Mesh(carriageGeometry, carriageMaterial);
    this.carriage.name = 'carriage';
    this.carriage.castShadow = false;
    this.carriage.receiveShadow = false;
    this.group.add(this.chains, this.hooks, this.trolleyChain, this.trolleyHook, this.carriage);
    this.update(this.time);
  }

  /** Writes every swaying matrix for `time`. No allocation: scratch objects only. */
  update(time: number): void {
    this.time = time;
    const { rail, chains, hooks, trolleyChain, trolleyHook, carriage } = this;
    if (!rail || !chains || !hooks || !trolleyChain || !trolleyHook || !carriage) return;
    const sites = this.sites;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      this.writeSwing(chains, hooks, i, s.x, s.pivotY, s.z, s.length, swayAngle(time, s.phase, s.amp, s.period), swayAngle(time, s.phase + CROSS_PHASE, s.amp * CROSS_SWAY, s.period));
    }
    const x = gantryX(time, rail);
    this.writeSwing(
      trolleyChain,
      trolleyHook,
      0,
      x,
      RAIL_Y,
      rail.z,
      TROLLEY_DROP,
      swayAngle(time, TROLLEY_SWAY.phase, TROLLEY_SWAY.amp, TROLLEY_SWAY.period),
      swayAngle(time, TROLLEY_SWAY.phase + CROSS_PHASE, TROLLEY_SWAY.amp * CROSS_SWAY, TROLLEY_SWAY.period),
    );
    carriage.position.set(x, RAIL_Y + CARRIAGE_LIFT, rail.z);
    chains.instanceMatrix.needsUpdate = true;
    hooks.instanceMatrix.needsUpdate = true;
    trolleyChain.instanceMatrix.needsUpdate = true;
    trolleyHook.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
  }

  /** One chain instance T(pivot) R(sway) S(1, length / 6, 1) and its hook T(pivot) R(sway) T(0, -length, 0). */
  private writeSwing(chains: InstancedMesh, hooks: InstancedMesh, i: number, x: number, y: number, z: number, length: number, swayX: number, swayZ: number): void {
    quaternion.setFromEuler(euler.set(swayX, 0, swayZ));
    composeChain(matrix, x, y, z, quaternion, length);
    chains.setMatrixAt(i, matrix);
    offset.set(0, -length, 0).applyQuaternion(quaternion);
    matrix.compose(position.set(x, y, z).add(offset), quaternion, ONE);
    hooks.setMatrixAt(i, matrix);
  }

  private instanced(name: string, geometry: BufferGeometry, material: MeshStandardMaterial, count: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Bounding spheres do not follow instance motion.
    mesh.frustumCulled = false;
    return mesh;
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as InstancedMesh).dispose?.();
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.geometries.length = 0;
    this.ownedMaterials.length = 0;
    this.rail = null;
    this.sites = [];
    this.chains = this.hooks = this.trolleyChain = this.trolleyHook = null;
    this.carriage = null;
  }
}
