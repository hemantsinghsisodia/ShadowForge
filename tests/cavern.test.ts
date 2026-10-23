import { BoxGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../src/levels';
import type { PlatformConfig } from '../src/levels/LevelData';
import { corridor, levelBounds, placeStructures, type Placement } from '../src/world/CavernLayout';
import type { KitPart } from '../src/world/EnvKit';
import { ABYSS_Y, ForgeCavern, MENU_BOUNDS, bakeByMaterial, rockCard } from '../src/world/ForgeCavern';
import { FORGE_KIT, type ForgeKit } from '../src/world/ForgeKit';
import { CAVERN } from '../src/world/ForgePalette';

type FakeKit = Pick<ForgeKit, 'prototype'>;
const BOX_VERTS = new BoxGeometry(1, 1, 1).getAttribute('position').count;

/** Pillars carry two materials, every other piece one, so a bake yields two meshes. */
function fakeKit(): FakeKit & { metal: MeshStandardMaterial; glow: MeshStandardMaterial } {
  const metal = new MeshStandardMaterial({ name: 'SHF_MAT_Metal' });
  const glow = new MeshStandardMaterial({ name: 'SHF_MAT_CyanEmission' });
  return {
    metal,
    glow,
    prototype(name): KitPart[] | null {
      if (name === FORGE_KIT.pillar) {
        return [
          { geometry: new BoxGeometry(1, 3, 1), material: metal },
          { geometry: new BoxGeometry(0.2, 3, 0.2), material: glow },
        ];
      }
      return [{ geometry: new BoxGeometry(1, 0.2, 0.2), material: metal }];
    },
  };
}

const place = (piece: Placement['piece'], x = 0): Placement => ({ piece, position: [x, -2, 0], rotationY: 0.5, scale: [1, 1, 1], top: 0, role: 'support' });
const slab = (x: number, z: number): PlatformConfig => ({ position: [x, -0.25, z], size: [6, 0.5, 6] });
const structureMeshes = (cavern: ForgeCavern) => cavern.group.children.filter((c) => c.name === 'structures') as Mesh[];
const BOUNDS = { minX: 0, maxX: 20, minZ: -5, maxZ: 5 };
const SLABS = [slab(4, 0), slab(14, 0)];

function abyss(cavern: ForgeCavern): Mesh {
  const mesh = cavern.group.children.find((child) => child.name === 'abyss');
  if (!mesh) throw new Error('no abyss');
  return mesh as Mesh;
}

describe('ForgeCavern', () => {
  it('is constructible without a renderer', () => {
    const cavern = new ForgeCavern();
    expect(cavern.group.parent).toBeNull();
    expect(cavern.dome.children.length).toBeGreaterThan(0);
  });

  it('picks octaves by tier', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('low', 0);
    expect((abyss(cavern).material as ShaderMaterial).defines?.OCTAVES).toBe(1);
    cavern.setDetail('high', 400);
    expect((abyss(cavern).material as ShaderMaterial).defines?.OCTAVES).toBe(3);
  });

  it('does not rebuild when the detail is unchanged', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('medium', 200);
    const material = abyss(cavern).material;
    const geometry = (cavern.dome.children[0] as Mesh).geometry;
    cavern.setDetail('medium', 200);
    expect(abyss(cavern).material).toBe(material);
    expect((cavern.dome.children[0] as Mesh).geometry).toBe(geometry);
  });

  it('has no rock banding define on any dome tier', () => {
    const cavern = new ForgeCavern();
    for (const detail of ['low', 'medium', 'high'] as const) {
      cavern.setDetail(detail, 0);
      const defines = ((cavern.dome.children[0] as Mesh).material as ShaderMaterial).defines ?? {};
      expect(defines.ROCK).toBeUndefined();
    }
  });

  it('centres the abyss on the bounds, at the abyss depth', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    cavern.mount({ minX: 0, maxX: 20, minZ: -10, maxZ: 6 });
    const mesh = abyss(cavern);
    expect(mesh.position.x).toBeCloseTo(10);
    expect(mesh.position.z).toBeCloseTo(-2);
    expect(mesh.position.y).toBe(ABYSS_Y);
    const params = (mesh.geometry as PlaneGeometry).parameters;
    expect(params.width).toBe(140);
    expect(params.height).toBe(116);
    cavern.mount(MENU_BOUNDS);
    expect(abyss(cavern).position.x).toBeCloseTo(0);
    expect(abyss(cavern).position.z).toBeCloseTo(0);
  });

  it('survives a detail change after mounting', () => {
    const cavern = new ForgeCavern();
    cavern.mount({ minX: 0, maxX: 20, minZ: 0, maxZ: 10 });
    cavern.setDetail('high', 400);
    expect(abyss(cavern).position.x).toBeCloseTo(10);
  });

  it('follows the camera with the dome only', () => {
    const cavern = new ForgeCavern();
    cavern.follow({ x: 3, y: 4, z: 5 } as never);
    expect(cavern.dome.position.toArray()).toEqual([3, 4, 5]);
    expect(cavern.group.position.toArray()).toEqual([0, 0, 0]);
  });

  it('tunes uniforms from finite numbers only', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    const material = abyss(cavern).material as ShaderMaterial;
    const before = CAVERN.crackHdr;
    try {
      const out = cavern.tune({ crackHdr: 1 });
      expect(material.uniforms.uCrackHdr.value).toBe(1);
      expect(out.crackHdr).toBe(1);
      cavern.tune({ crackHdr: NaN });
      expect(material.uniforms.uCrackHdr.value).toBe(1);
      expect(CAVERN.crackHdr).toBe(1);
      cavern.tune({ embers: false });
      expect(CAVERN.embers).toBe(false);
      cavern.tune({ embers: 3 as never });
      expect(CAVERN.embers).toBe(false);
    } finally {
      CAVERN.crackHdr = before;
      CAVERN.embers = true;
    }
  });

  it('feeds time and pulse uniforms', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('low', 0);
    cavern.update(700);
    const material = abyss(cavern).material as ShaderMaterial;
    expect(material.uniforms.uAbyssTime.value).toBeCloseTo(700);
    expect(material.uniforms.uPulse.value).toBeGreaterThan(0.7);
    cavern.update(6100);
    expect(material.uniforms.uAbyssTime.value).toBeCloseTo(100);
  });

  it('wraps the abyss clock at 6000 and the embers at 600', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 50);
    cavern.update(6700);
    const material = abyss(cavern).material as ShaderMaterial;
    expect(material.uniforms.uAbyssTime.value).toBeCloseTo(700);
    const points = cavern.group.children.find((child) => child instanceof Points) as Points;
    const emberMaterial = points.material as ShaderMaterial;
    expect(emberMaterial.uniforms.uTime.value).toBeCloseTo(100);
  });

  it('draws the abyss after the opaque scene and the dome before it', () => {
    const cavern = new ForgeCavern();
    expect(abyss(cavern).renderOrder).toBe(1);
    expect((cavern.dome.children[0] as Mesh).renderOrder).toBe(-1);
  });

  it('does nothing on a repeat mount with equal arguments', () => {
    const cavern = new ForgeCavern();
    const bounds = { minX: 0, maxX: 20, minZ: 0, maxZ: 10 };
    const slabs = [{ position: [1, 0, 2] as [number, number, number], size: [4, 1, 4] as [number, number, number] }];
    cavern.mount(bounds, slabs, 3);
    expect(cavern.mounted.seed).toBe(3);
    expect(cavern.mounted.slabs).toBe(slabs);
    const geometry = abyss(cavern).geometry;
    cavern.mount({ ...bounds }, [{ position: [1, 0, 2], size: [4, 1, 4] }], 3);
    expect(abyss(cavern).geometry).toBe(geometry);
    cavern.mount(bounds, slabs, 4);
    expect(abyss(cavern).geometry).not.toBe(geometry);
    const second = abyss(cavern).geometry;
    cavern.mount(bounds, [], 4);
    expect(abyss(cavern).geometry).not.toBe(second);
  });

  it('builds on the first mount, so a fresh cavern is already menu-sized', () => {
    const cavern = new ForgeCavern();
    expect((abyss(cavern).geometry as PlaneGeometry).parameters.width).toBe(MENU_BOUNDS.maxX - MENU_BOUNDS.minX + 120);
    const geometry = abyss(cavern).geometry;
    cavern.mount(MENU_BOUNDS, [], 0);
    expect(abyss(cavern).geometry).toBe(geometry);
  });

  it('tunes structures and walls as booleans only', () => {
    const cavern = new ForgeCavern();
    try {
      expect(CAVERN.structures).toBe(true);
      expect(CAVERN.walls).toBe(true);
      const out = cavern.tune({ structures: false, walls: false });
      expect(out.structures).toBe(false);
      expect(out.walls).toBe(false);
      cavern.tune({ structures: true });
      cavern.tune({ structures: 3 as never });
      expect(CAVERN.structures).toBe(true);
      expect(CAVERN.walls).toBe(false);
    } finally {
      CAVERN.structures = true;
      CAVERN.walls = true;
    }
  });
});

describe('bakeByMaterial', () => {
  it('returns one mesh per distinct material', () => {
    const kit = fakeKit();
    const meshes = bakeByMaterial([place(FORGE_KIT.pillar), place(FORGE_KIT.beam, 2), place(FORGE_KIT.pillar, 4)], kit);
    expect(meshes).toHaveLength(2);
    expect(new Set(meshes.map((m) => m.material))).toEqual(new Set([kit.metal, kit.glow]));
  });

  it('merges the vertices of every placement', () => {
    const kit = fakeKit();
    const meshes = bakeByMaterial([place(FORGE_KIT.pillar), place(FORGE_KIT.beam, 2), place(FORGE_KIT.pillar, 4)], kit);
    const count = (material: unknown) => meshes.find((m) => m.material === material)!.geometry.getAttribute('position').count;
    expect(count(kit.metal)).toBe(BOX_VERTS * 3);
    expect(count(kit.glow)).toBe(BOX_VERTS * 2);
  });

  it('applies the placement transform to the clones and leaves the kit geometry alone', () => {
    const kit = fakeKit();
    const [mesh] = bakeByMaterial([{ ...place(FORGE_KIT.beam, 10), scale: [2, 2, 2] }], kit);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(-2 - 0.2);
    expect(box.max.y).toBeCloseTo(-2 + 0.2);
    const source = kit.prototype(FORGE_KIT.beam)![0].geometry;
    expect(source.getAttribute('position').getX(0)).toBeLessThan(1);
  });

  it('skips placements whose prototype is missing', () => {
    const kit: FakeKit = { prototype: () => null };
    expect(bakeByMaterial([place(FORGE_KIT.lamp)], kit)).toEqual([]);
    expect(bakeByMaterial([], kit)).toEqual([]);
  });

  it('merges geometries whose attribute sets differ', () => {
    const shared = new MeshStandardMaterial();
    const kit: FakeKit = {
      prototype(name) {
        const geometry = new BoxGeometry(1, 1, 1);
        if (name === FORGE_KIT.beam) geometry.deleteAttribute('uv');
        return [{ geometry, material: shared }];
      },
    };
    const meshes = bakeByMaterial([place(FORGE_KIT.beam), place(FORGE_KIT.tray, 1)], kit);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometry.getAttribute('position').count).toBe(BOX_VERTS * 2);
  });

  it('builds shadow-free meshes that keep frustum culling', () => {
    const [mesh] = bakeByMaterial([place(FORGE_KIT.beam)], fakeKit());
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(true);
  });
});

describe('ForgeCavern structures', () => {
  const ready = (detail: 'medium' | 'high' = 'high') => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS, SLABS, 3);
    cavern.setDetail(detail, 0);
    return cavern;
  };

  it('has no meshes without a kit', () => {
    const cavern = ready();
    expect(structureMeshes(cavern)).toHaveLength(0);
    cavern.setKit(null);
    expect(structureMeshes(cavern)).toHaveLength(0);
  });

  it('bakes one mesh per material once a kit arrives', () => {
    const cavern = ready();
    cavern.setKit(fakeKit() as ForgeKit);
    expect(structureMeshes(cavern)).toHaveLength(2);
    const placements = placeStructures(BOUNDS, SLABS, 'high', 3);
    const total = structureMeshes(cavern).reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0);
    expect(total).toBeGreaterThanOrEqual(placements.length * BOX_VERTS);
  });

  it('builds nothing on the low tier', () => {
    const cavern = ready();
    cavern.setKit(fakeKit() as ForgeKit);
    cavern.setDetail('low', 0);
    expect(structureMeshes(cavern)).toHaveLength(0);
  });

  it('does not rebuild when the key is unchanged', () => {
    const cavern = ready();
    cavern.setKit(fakeKit() as ForgeKit);
    const before = structureMeshes(cavern);
    expect(before.length).toBeGreaterThan(0);
    cavern.setDetail('high', 0);
    cavern.mount({ ...BOUNDS }, SLABS.map((s) => ({ ...s })), 3);
    cavern.setKit(fakeKit() as ForgeKit);
    const after = structureMeshes(cavern);
    expect(after).toHaveLength(before.length);
    after.forEach((mesh, i) => expect(mesh).toBe(before[i]));
  });

  it('rebuilds on a detail change and disposes only the old merged geometry', () => {
    const cavern = ready();
    const kit = fakeKit();
    cavern.setKit(kit as ForgeKit);
    const old = structureMeshes(cavern);
    const geometrySpies = old.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const materialSpies = [vi.spyOn(kit.metal, 'dispose'), vi.spyOn(kit.glow, 'dispose')];
    cavern.setDetail('medium', 0);
    geometrySpies.forEach((spy) => expect(spy).toHaveBeenCalled());
    materialSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    const next = structureMeshes(cavern);
    expect(next.length).toBeGreaterThan(0);
    next.forEach((mesh) => expect(old).not.toContain(mesh));
    old.forEach((mesh) => expect(mesh.parent).toBeNull());
  });

  it('rebuilds when the mount or the kit changes', () => {
    const cavern = ready();
    cavern.setKit(fakeKit() as ForgeKit);
    const first = structureMeshes(cavern)[0];
    cavern.mount(BOUNDS, SLABS, 4);
    const second = structureMeshes(cavern)[0];
    expect(second).not.toBe(first);
    cavern.setKit(null);
    expect(structureMeshes(cavern)).toHaveLength(0);
  });

  it('hides the meshes with tune({ structures: false }) and keeps that across rebuilds', () => {
    const cavern = ready();
    cavern.setKit(fakeKit() as ForgeKit);
    try {
      cavern.tune({ structures: false });
      expect(structureMeshes(cavern).every((m) => !m.visible)).toBe(true);
      cavern.setDetail('medium', 0);
      expect(structureMeshes(cavern).length).toBeGreaterThan(0);
      expect(structureMeshes(cavern).every((m) => !m.visible)).toBe(true);
      cavern.tune({ structures: true });
      expect(structureMeshes(cavern).every((m) => m.visible)).toBe(true);
    } finally {
      CAVERN.structures = true;
    }
  });

  it('reports draw calls per tier for levels 1 and 10', () => {
    const rows: string[] = [];
    for (const id of [1, 10]) {
      const level = LEVELS.find((l) => l.id === id)!;
      for (const detail of ['low', 'medium', 'high'] as const) {
        const cavern = new ForgeCavern();
        cavern.mount(levelBounds(level.platforms), level.platforms, level.id);
        cavern.setDetail(detail, 0);
        cavern.setKit(fakeKit() as ForgeKit);
        const meshes = structureMeshes(cavern);
        const verts = meshes.reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0);
        rows.push(`L${id} ${detail}: ${meshes.length} draws, ${verts} verts, ${placeStructures(levelBounds(level.platforms), level.platforms, detail, level.id).length} placements`);
        expect(meshes.length).toBeLessThanOrEqual(2);
      }
    }
    console.log(rows.join('\n'));
  });
});

describe('rockCard', () => {
  const rock = (geometry: ReturnType<typeof rockCard>) => Array.from(geometry.getAttribute('aRock').array as ArrayLike<number>);

  it('is deterministic per seed and differs between seeds', () => {
    const a = rockCard(100, 24, 6, 5);
    const b = rockCard(100, 24, 6, 5);
    const c = rockCard(100, 24, 6, 6);
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    expect(rock(a)).toEqual(rock(b));
    expect(rock(a)).not.toEqual(rock(c));
  });

  it('keeps aRock in [0, 1] and varies it', () => {
    const values = rock(rockCard(200, 96, 12, 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.2);
  });

  it('has one vertex per lattice point and spans y -20..20 over the requested length', () => {
    const geometry = rockCard(150, 48, 8, 2);
    expect(geometry.getAttribute('position').count).toBe(49 * 9);
    expect(geometry.getAttribute('aRock').count).toBe(49 * 9);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(-75);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(75);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-20);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(20);
  });

  it('stretches aRock across the range: max - min >= 0.6 over one card', () => {
    const values = rock(rockCard(200, 96, 12, 1));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(0.6);
  });

  it('displaces along +Z by aRock * 10 and carries normals', () => {
    const geometry = rockCard(100, 24, 6, 3);
    const position = geometry.getAttribute('position');
    const values = rock(geometry);
    for (let i = 0; i < position.count; i++) expect(position.getZ(i)).toBeCloseTo(values[i] * 10, 5);
    expect(geometry.getAttribute('normal').count).toBe(position.count);
  });
});

describe('ForgeCavern walls', () => {
  const wallMeshes = (cavern: ForgeCavern) => cavern.group.children.filter((c) => c.name === 'walls') as Mesh[];
  const verts = (cavern: ForgeCavern) => wallMeshes(cavern).reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0);
  const ready = (detail: 'low' | 'medium' | 'high') => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS, SLABS, 3);
    cavern.setDetail(detail, 0);
    return cavern;
  };

  it('builds 2 cards on low and medium and 4 on high', () => {
    expect(wallMeshes(ready('low'))).toHaveLength(2);
    expect(wallMeshes(ready('medium'))).toHaveLength(2);
    expect(wallMeshes(ready('high'))).toHaveLength(4);
  });

  it('uses 48x8 segments on low and 96x16 otherwise', () => {
    expect(verts(ready('low'))).toBe(2 * 49 * 9);
    expect(verts(ready('medium'))).toBe(2 * 97 * 17);
    expect(verts(ready('high'))).toBe(4 * 97 * 17);
    console.log(`wall verts: low ${2 * 49 * 9}, medium ${2 * 97 * 17}, high ${4 * 97 * 17}`);
  });

  it('places the cards either side of the corridor, facing it', () => {
    const cavern = ready('medium');
    const { midZ, halfDepth } = corridor(BOUNDS);
    const meshes = wallMeshes(cavern);
    const near = meshes.find((m) => m.position.z > midZ)!;
    const far = meshes.find((m) => m.position.z < midZ)!;
    expect(near.position.z).toBeCloseTo(midZ + halfDepth + 28);
    expect(far.position.z).toBeCloseTo(midZ - halfDepth - 28);
    expect(near.rotation.y).toBeCloseTo(Math.PI);
    expect(far.rotation.y).toBeCloseTo(0);
    for (const m of meshes) {
      expect(m.position.x).toBeCloseTo(10);
      expect(m.position.y).toBe(6);
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox!.max.x - m.geometry.boundingBox!.min.x).toBeCloseTo(20 + 120);
    }
  });

  it('points each card +Z axis toward the corridor, and keeps the nearest surface >= 18 m from its edge', () => {
    const { midZ, halfDepth } = corridor(BOUNDS);
    for (const detail of ['medium', 'high'] as const) {
      for (const m of wallMeshes(ready(detail))) {
        m.updateMatrixWorld(true);
        const axis = new Vector3(0, 0, 1).transformDirection(m.matrixWorld);
        expect(Math.sign(axis.z)).toBe(Math.sign(midZ - m.position.z));
        expect(Math.abs(axis.z)).toBeCloseTo(1, 9);
        expect(Math.abs(m.position.z - midZ) - halfDepth - 10).toBeGreaterThanOrEqual(18);
      }
    }
  });

  it('adds a darker outer pair on high', () => {
    const cavern = ready('high');
    const { midZ, halfDepth } = corridor(BOUNDS);
    const outer = wallMeshes(cavern).filter((m) => Math.abs(m.position.z - midZ) > halfDepth + 34);
    const inner = wallMeshes(cavern).filter((m) => Math.abs(m.position.z - midZ) < halfDepth + 34);
    expect(outer).toHaveLength(2);
    expect(inner).toHaveLength(2);
    for (const m of outer) {
      expect(Math.abs(m.position.z - midZ)).toBeCloseTo(halfDepth + 40);
      expect((m.material as ShaderMaterial).uniforms.uDark.value).toBeCloseTo(0.6);
    }
    for (const m of inner) expect((m.material as ShaderMaterial).uniforms.uDark.value).toBe(1);
  });

  it('is unlit, shadow-free and fog-free, sharing the cavern uniforms', () => {
    const cavern = ready('medium');
    const abyssMaterial = abyss(cavern).material as ShaderMaterial;
    for (const m of wallMeshes(cavern)) {
      const material = m.material as ShaderMaterial;
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
      expect(material.fog).toBe(false);
      expect(material.uniforms.uPulse).toBe(abyssMaterial.uniforms.uPulse);
      expect(material.uniforms.uGlow).toBe(abyssMaterial.uniforms.uGlow);
    }
  });

  it('does not rebuild on an equal key, and rebuilds and disposes on a change', () => {
    const cavern = ready('high');
    const before = wallMeshes(cavern);
    cavern.setDetail('high', 0);
    cavern.mount({ ...BOUNDS }, SLABS.map((s) => ({ ...s })), 3);
    wallMeshes(cavern).forEach((m, i) => expect(m).toBe(before[i]));
    const spies = before.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const materialSpies = before.map((m) => vi.spyOn(m.material as ShaderMaterial, 'dispose'));
    cavern.mount(BOUNDS, SLABS, 4);
    spies.forEach((spy) => expect(spy).toHaveBeenCalled());
    materialSpies.forEach((spy) => expect(spy).toHaveBeenCalled());
    before.forEach((m) => expect(m.parent).toBeNull());
    expect(wallMeshes(cavern)).toHaveLength(4);
    cavern.setDetail('low', 0);
    expect(wallMeshes(cavern)).toHaveLength(2);
  });

  it('hides the walls with tune({ walls: false }) and keeps that across rebuilds', () => {
    const cavern = ready('medium');
    try {
      cavern.tune({ walls: false });
      expect(wallMeshes(cavern).every((m) => !m.visible)).toBe(true);
      cavern.setDetail('high', 0);
      expect(wallMeshes(cavern).length).toBeGreaterThan(0);
      expect(wallMeshes(cavern).every((m) => !m.visible)).toBe(true);
      cavern.tune({ walls: true });
      expect(wallMeshes(cavern).every((m) => m.visible)).toBe(true);
    } finally {
      CAVERN.walls = true;
    }
  });
});
