import { BoxGeometry, Color, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { LevelConfig, PlatformConfig } from '../levels/LevelData';
import { instanceKit, KIT, type EnvKit, type KitName } from './EnvKit';
import type { LabMaterials } from './Materials';

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Kenney floor tiles are 4 x 4 m and sit on y = 0. TILE_DEPTH keeps a 0.5 m slab at scale 1. */
const TILE = 4;
const TILE_DEPTH = 0.5;

/** Floor-edge dressing: a glowing pit under the room and pillars along the sides. */
export function buildDressing(
  bounds: RoomBounds,
  detail: 'low' | 'high',
  mats: LabMaterials,
  accent: Color,
  kit: EnvKit | null = null,
  level: LevelConfig | null = null,
): Group {
  const root = new Group();
  const { minX, maxX, minZ, maxZ } = bounds;
  if (!Number.isFinite(minX)) return root;
  const width = Math.max(8, maxX - minX);
  const depth = Math.max(6, maxZ - minZ);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  const abyss = new Mesh(
    new BoxGeometry(width + 24, 0.4, depth + 16),
    new MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.15) }),
  );
  abyss.position.set(midX, -7.2, midZ);
  root.add(abyss);

  if (detail === 'high') {
    const kitPillar = kit?.merged(KIT.pillar) ?? null;
    const spots: [number, number][] = [];
    for (let x = minX + 4; x < maxX; x += 10) {
      // The Kenney column is 1.56 m across, so its centre sits on the rim. The thin fallback stays inset.
      for (const z of kitPillar ? [minZ, maxZ] : [minZ + 0.6, maxZ - 0.6]) {
        spots.push([x, z]);
        // Each pillar owns its materials: LevelWorld.fadeOccluders fades them one pillar at a time.
        const pillar = kitPillar
          ? new Mesh(kitPillar.geometry, kitPillar.materials.map((material) => material.clone()))
          : new Mesh(new CylinderGeometry(0.22, 0.28, 6.2, 8), mats.stone.clone());
        pillar.position.set(x, kitPillar ? 0 : 3.1, z);
        pillar.castShadow = true;
        pillar.userData.pillar = true;
        root.add(pillar);
      }
    }
    if (kit && level) {
      const props = buildKitProps(kit, level, spots);
      if (props) root.add(props);
    }
  }
  return root;
}

/** Slabs thin enough to read as floor get kit tiles; tall blocks keep their procedural box. */
export function kitFloorable(platform: PlatformConfig): boolean {
  const [w, h, d] = platform.size;
  return h <= 1.2 && w >= 1.2 && d >= 1.2;
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

function rectOf(platform: PlatformConfig): Rect {
  const [x, y, z] = platform.position;
  const [w, h, d] = platform.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h / 2 };
}

const UP = new Vector3(0, 1, 0);

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(sx, sy, sz));
}

/**
 * Kit floor visuals over the level's platforms. Collision and shadows keep using config.platforms;
 * tiles cover each slab exactly and never cross a gap.
 * Returns the indices of the platforms it covered, so their procedural boxes can be hidden.
 */
export function buildKitFloor(kit: EnvKit, platforms: PlatformConfig[]): { group: Group; covered: number[] } | null {
  if (!kit.prototype(KIT.tileA) || !kit.prototype(KIT.tileB)) return null;
  const covered = platforms.flatMap((platform, i) => (kitFloorable(platform) ? [i] : []));
  if (covered.length === 0) return null;
  const rects = covered.map((i) => rectOf(platforms[i]));
  const tilesA: Matrix4[] = [];
  const tilesB: Matrix4[] = [];

  rects.forEach((r, n) => {
    const sy = (r.top - (platforms[covered[n]].position[1] - platforms[covered[n]].size[1] / 2)) / TILE_DEPTH;
    const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / TILE - 0.01));
    const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / TILE - 0.01));
    const tw = (r.maxX - r.minX) / nx;
    const td = (r.maxZ - r.minZ) / nz;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const matrix = place(r.minX + tw * (ix + 0.5), r.top, r.minZ + td * (iz + 0.5), 0, tw / TILE, sy, td / TILE);
        ((ix * 3 + iz * 5 + n) % 7 === 3 ? tilesB : tilesA).push(matrix);
      }
    }
  });

  const group = new Group();
  group.name = 'EnvKitFloor';
  for (const [name, list] of [
    [KIT.tileA, tilesA],
    [KIT.tileB, tilesB],
  ] as const) {
    const mesh = instanceKit(kit, name, list);
    if (mesh) group.add(mesh);
  }
  return { group, covered };
}

/** Where gameplay happens: nothing decorative may stand within these circles. */
function keepClear(level: LevelConfig, pillars: [number, number][]): { x: number; z: number; r: number }[] {
  const zones: { x: number; z: number; r: number }[] = [];
  const add = (p: readonly number[] | undefined, r: number) => {
    if (p) zones.push({ x: p[0], z: p[2], r });
  };
  add(level.playerStart.position, 2);
  add(level.exit.position, level.exit.radius + 1.2);
  for (const c of level.consoles) add(c.position, 1.5);
  for (const light of level.lights) {
    add(light.position, 1.6);
    add(light.interactAt, 1.4);
    for (const state of light.states) add(state.position, 1.6);
  }
  for (const caster of level.casters) {
    const r = 1 + Math.hypot(caster.size[0], caster.size[2]) / 2;
    add(caster.position, r);
    add(caster.interactAt, 1.4);
    for (const state of caster.states) add(state.position, r);
  }
  for (const surface of level.surfaces) add(surface.origin, Math.hypot(surface.sizeU, surface.sizeV) / 2 + 0.6);
  for (const [x, z] of pillars) zones.push({ x, z, r: 1.1 });
  return zones;
}

/** The corner post turns toward the slab centre. Cables keep the authored yaw. */
const CORNER_PROPS: { name: KitName; faces: boolean }[] = [
  { name: KIT.corner, faces: true },
  { name: KIT.cables, faces: false },
];

/**
 * Sparse, non-colliding kit props on the outer band of each floor slab: a corner post or
 * cable bundle per clear corner, cables along two rims, and a cable bundle inside a gap edge.
 */
function buildKitProps(kit: EnvKit, level: LevelConfig, pillars: [number, number][]): Group | null {
  const zones = keepClear(level, pillars);
  const free = (x: number, z: number, pad = 0) => zones.every((zone) => Math.hypot(zone.x - x, zone.z - z) > zone.r + pad);
  const slabs = level.platforms.filter(kitFloorable).map(rectOf);
  const bucket = new Map<KitName, Matrix4[]>();
  const put = (name: KitName, matrix: Matrix4) => {
    if (!bucket.has(name)) bucket.set(name, []);
    bucket.get(name)!.push(matrix);
  };
  const faceYaw = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
  const inset = 1.2;

  slabs.forEach((r, n) => {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    if (w * d < 16) return;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const corners: [number, number][] = [
      [r.minX + inset, r.minZ + inset],
      [r.maxX - inset, r.minZ + inset],
      [r.maxX - inset, r.maxZ - inset],
      [r.minX + inset, r.maxZ - inset],
    ];
    corners.forEach(([x, z], k) => {
      if (!free(x, z)) return;
      const prop = CORNER_PROPS[(n * 4 + k) % CORNER_PROPS.length];
      put(prop.name, place(x, r.top, z, prop.faces ? faceYaw(x, z, cx, cz) : 0));
    });

    if (w >= 4 && free(cx, r.minZ + inset, 0.4)) put(KIT.cables, place(cx, r.top, r.minZ + inset));
    if (d >= 4 && free(r.minX + inset, cz, 0.4)) put(KIT.cables, place(r.minX + inset, r.top, cz, Math.PI / 2));

    for (const other of slabs) {
      if (other === r || Math.abs(other.top - r.top) > 1 || other.maxZ < r.minZ || other.minZ > r.maxZ) continue;
      const z = Math.max(r.minZ, other.minZ) / 2 + Math.min(r.maxZ, other.maxZ) / 2;
      const gapEast = other.minX - r.maxX;
      const gapWest = r.minX - other.maxX;
      if (gapEast > 0.2 && gapEast < 8 && free(r.maxX - inset, z, 0.4)) put(KIT.cables, place(r.maxX - inset, r.top, z));
      if (gapWest > 0.2 && gapWest < 8 && free(r.minX + inset, z, 0.4)) put(KIT.cables, place(r.minX + inset, r.top, z));
    }
  });

  const group = new Group();
  group.name = 'EnvKitProps';
  for (const [name, list] of bucket) {
    const mesh = instanceKit(kit, name, list);
    if (mesh) group.add(mesh);
  }
  return group.children.length ? group : null;
}
