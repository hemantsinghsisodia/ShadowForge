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
 * Kenney Modular Space Kit subset (public/models/environment/KenneyModularSpace.glb).
 * CC0. Pieces are already Y-up and 1 unit = 1 m, packed with their footprint centred
 * on XZ and their base on y = 0. Floor tiles are 4 x 4 m. Corridor and wall modules
 * from the pack are full rooms, so they are not included: they would close the gap
 * and block the camera.
 *
 * Yaw 0 keeps the authored facing. A piece that should look toward (dx, dz) uses
 * rotation.y = atan2(-dx, -dz).
 */
export const KIT = {
  tileA: 'template-floor',
  tileB: 'template-floor-detail',
  pillar: 'template-detail',
  cables: 'cables',
  corner: 'template-wall-corner',
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

const URL = `${import.meta.env.BASE_URL}models/environment/KenneyModularSpace.glb`;
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

/** Keeps the packed colormap. GLTFLoader may still build a physical material for extension flags. */
function standardOf(source: Material, cache: Map<Material, MeshStandardMaterial>): MeshStandardMaterial {
  const hit = cache.get(source);
  if (hit) return hit;
  const src = source as MeshStandardMaterial;
  const material = new MeshStandardMaterial({
    name: src.name,
    color: src.color,
    map: src.map,
    metalness: src.metalness,
    roughness: src.roughness,
    emissive: src.emissive,
    emissiveIntensity: src.emissiveIntensity,
    side: src.side,
  });
  source.dispose();
  cache.set(source, material);
  return material;
}
