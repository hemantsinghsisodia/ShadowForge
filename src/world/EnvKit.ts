import {
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Group,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * SHADOWFORGE modular environment kit (public/models/environment/SHADOWFORGE_EnvKit.glb).
 *
 * Every prototype sits at the origin with an identity transform, 1 unit = 1 m:
 * floor tiles and edges have their top at y = 0 and extend down to y = -0.5,
 * props and lights stand on y = 0, the wall console hangs from its back plate.
 *
 * Orientation: the Blender kit faces +Y, which the glTF Y-up export turns into -Z.
 * So at rotation.y = 0 a directional prototype (terminal screen, wall console,
 * vertical light strip, floor-edge warning stripe) faces -Z, and facing a world
 * direction (dx, dz) needs rotation.y = atan2(-dx, -dz).
 */
export const KIT = {
  tileA: 'SHF_Floor_Tile_A',
  tileB: 'SHF_Floor_Tile_B',
  edge: 'SHF_Floor_Edge',
  platform: 'SHF_Floor_Platform_A',
  pillar: 'SHF_Pillar_A',
  maintenanceBox: 'SHF_Prop_MaintenanceBox',
  cableTray: 'SHF_Structure_CableTray',
  trimWarning: 'SHF_Trim_Warning',
  beam: 'SHF_Structure_Beam',
  terminal: 'SHF_Prop_Terminal',
  wallConsole: 'SHF_Prop_WallConsole',
  energyContainer: 'SHF_Prop_EnergyContainer',
  cableJunction: 'SHF_Prop_CableJunction',
  powerUnit: 'SHF_Prop_FloorPowerUnit',
  lamp: 'SHF_Lamp_Industrial',
  strip: 'SHF_Light_Strip_A',
  stripVertical: 'SHF_Light_Strip_Vertical_A',
} as const;

export type KitName = (typeof KIT)[keyof typeof KIT];

export interface KitPart {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

export interface EnvKit {
  prototype(name: KitName): KitPart[] | null;
  /** One geometry with a group per material, for meshes that need their own material copies. */
  merged(name: KitName): { geometry: BufferGeometry; materials: MeshStandardMaterial[] } | null;
  /** Kit geometry and materials live for the whole session and must not be disposed with a level. */
  owns(resource: BufferGeometry | Material): boolean;
}

const URL = `${import.meta.env.BASE_URL}models/environment/SHADOWFORGE_EnvKit.glb`;
let pending: Promise<EnvKit | null> | null = null;
let ready: EnvKit | null = null;

/** Loads the kit once; later calls share the same promise. Resolves null if the file is missing or unreadable. */
export function loadEnvKit(): Promise<EnvKit | null> {
  pending ??= fetchKit().then((kit) => (ready = kit));
  return pending;
}

/** The kit if it has already finished loading. */
export function envKit(): EnvKit | null {
  return ready;
}

/** One InstancedMesh per material of the prototype, all sharing the same instance matrices. */
export function instanceKit(kit: EnvKit, name: KitName, matrices: Matrix4[], shadows = true): Group | null {
  const parts = kit.prototype(name);
  if (!parts || matrices.length === 0) return null;
  const group = new Group();
  group.name = name;
  for (const part of parts) {
    const mesh = new InstancedMesh(part.geometry, part.material, matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

async function fetchKit(): Promise<EnvKit | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(URL);
    gltf.scene.updateMatrixWorld(true);
    const materials = new Map<Material, MeshStandardMaterial>();
    const owned = new Set<BufferGeometry | Material>();
    const prototypes = new Map<string, KitPart[]>();
    for (const name of Object.values(KIT)) {
      const node = gltf.scene.getObjectByName(name);
      if (!node) {
        console.warn(`[EnvKit] prototype ${name} missing from ${URL}`);
        continue;
      }
      const inverse = node.matrixWorld.clone().invert();
      const parts: KitPart[] = [];
      node.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        const geometry = mesh.geometry.clone();
        const local = inverse.clone().multiply(mesh.matrixWorld);
        if (!local.equals(new Matrix4())) geometry.applyMatrix4(local);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const material = standardOf(mesh.material as Material, materials);
        owned.add(geometry).add(material);
        parts.push({ geometry, material });
      });
      prototypes.set(name, parts);
    }
    const mergedCache = new Map<string, { geometry: BufferGeometry; materials: MeshStandardMaterial[] } | null>();
    return {
      prototype: (name) => prototypes.get(name) ?? null,
      merged: (name) => {
        if (!mergedCache.has(name)) {
          const parts = prototypes.get(name);
          const geometry = parts ? mergeGeometries(parts.map((part) => part.geometry), true) : null;
          if (geometry) owned.add(geometry);
          mergedCache.set(name, parts && geometry ? { geometry, materials: parts.map((part) => part.material) } : null);
        }
        return mergedCache.get(name) ?? null;
      },
      owns: (resource) => owned.has(resource),
    };
  } catch (error) {
    console.error(`[EnvKit] could not load ${URL}; keeping procedural environment visuals.`, error);
    return null;
  }
}

/** The exporter tags materials with KHR_materials_specular, which makes GLTFLoader build heavier physical materials. */
function standardOf(source: Material, cache: Map<Material, MeshStandardMaterial>): MeshStandardMaterial {
  const hit = cache.get(source);
  if (hit) return hit;
  const src = source as MeshStandardMaterial;
  const material = new MeshStandardMaterial({
    name: src.name,
    color: src.color,
    metalness: src.metalness,
    roughness: src.roughness,
    emissive: src.emissive,
    emissiveIntensity: src.emissiveIntensity,
  });
  source.dispose();
  cache.set(source, material);
  return material;
}
