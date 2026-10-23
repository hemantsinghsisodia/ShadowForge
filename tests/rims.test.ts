import { BoxGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import type { PlatformConfig } from '../src/levels/LevelData';
import { exposedRims, type Rim } from '../src/world/CavernLayout';
import { bakeByMaterial } from '../src/world/ForgeCavern';
import type { KitPart } from '../src/world/EnvKit';
import { FORGE_KIT, type ForgeKit } from '../src/world/ForgeKit';
import { buildForgeRims, rimPlacements, rimTrimColor, RIM_LIFT } from '../src/world/LabDressing';

const UP = new Vector3(0, 1, 0);
const BOX_VERTS = new BoxGeometry(1, 1, 1).getAttribute('position').count;
const slab = (x: number, z: number, w = 4, d = 4, y = -0.25, h = 0.5): PlatformConfig => ({ position: [x, y, z], size: [w, h, d] });

/** Floor_Edge as authored: body X -1..1, Y -0.5..0, Z -0.12..0.14; the trim plate and amber stripe sit on the -Z face. */
function edgeBody(): BoxGeometry {
  return new BoxGeometry(2, 0.5, 0.26).translate(0, -0.25, 0.01);
}

function fakeKit(): Pick<ForgeKit, 'prototype'> & { dark: MeshStandardMaterial; amber: MeshStandardMaterial } {
  const dark = new MeshStandardMaterial({ name: 'SHF_MAT_DarkMetal' });
  const amber = new MeshStandardMaterial({ name: 'SHF_MAT_WarningAmber', emissive: 0x112233, emissiveIntensity: 3 });
  return {
    dark,
    amber,
    prototype(name): KitPart[] | null {
      if (name !== FORGE_KIT.edge) return null;
      return [
        { geometry: edgeBody(), material: dark },
        { geometry: new BoxGeometry(1.5, 0.035, 0.008).translate(0, -0.08, -0.128), material: amber },
      ];
    },
  };
}

const matrixOf = (p: ReturnType<typeof rimPlacements>[number]) =>
  new Matrix4().compose(new Vector3(...p.position), new Quaternion().setFromAxisAngle(UP, p.rotationY), new Vector3(...p.scale));

describe('rimPlacements', () => {
  const zRim: Rim = { x0: 2, z0: 5, x1: 8, z1: 5, y: 0, thick: 0.5, outward: [0, 1] };
  const xRim: Rim = { x0: -3, z0: 1, x1: -3, z1: 5, y: 0.3, thick: 1, outward: [-1, 0] };

  it('places Floor_Edge, scaling X to half the length and Y to the slab height', () => {
    const [z, x] = rimPlacements([zRim, xRim]);
    expect(z.piece).toBe(FORGE_KIT.edge);
    expect(z.scale).toEqual([3, 1, 1]);
    expect(x.scale[0]).toBeCloseTo(2);
    expect(x.scale[1]).toBeCloseTo(2);
    expect(x.scale[2]).toBe(1);
    expect(z.role).toBe('rim');
  });

  it('turns the lip trim face (local -Z) toward outward, for Z-facing and X-facing rims', () => {
    for (const rim of [zRim, xRim, { ...zRim, outward: [0, -1] as [number, number] }, { ...xRim, outward: [1, 0] as [number, number] }]) {
      const [p] = rimPlacements([rim]);
      const face = new Vector3(0, 0, -1).applyAxisAngle(UP, p.rotationY);
      expect(face.x).toBeCloseTo(rim.outward[0]);
      expect(face.z).toBeCloseTo(rim.outward[1]);
    }
  });

  it('centres on the rim midpoint, sunk to the slab top plus the z-fight lift, inset along -outward', () => {
    const [z, x] = rimPlacements([zRim, xRim]);
    expect(z.position[0]).toBeCloseTo(5);
    expect(z.position[1]).toBeCloseTo(0 + RIM_LIFT);
    expect(z.position[2]).toBeCloseTo(5 - 0.1);
    expect(x.position[0]).toBeCloseTo(-3 + 0.1);
    expect(x.position[1]).toBeCloseTo(0.3 + RIM_LIFT);
    expect(x.position[2]).toBeCloseTo(3);
  });

  it('puts the outer body face 0.02 m beyond the slab side', () => {
    for (const rim of [zRim, xRim, { ...zRim, outward: [0, -1] as [number, number] }, { ...xRim, outward: [1, 0] as [number, number] }]) {
      const [p] = rimPlacements([rim]);
      const outer = new Vector3(0, -0.25, -0.12).applyMatrix4(matrixOf(p));
      const side = new Vector3(rim.x0, 0, rim.z0);
      const beyond = (outer.x - side.x) * rim.outward[0] + (outer.z - side.z) * rim.outward[1];
      expect(beyond).toBeCloseTo(0.02);
    }
  });

  it('bakes a lip whose extent runs from 0.02 m outside the side to 0.24 m inside, over the full slab height', () => {
    const kit = fakeKit();
    const rim: Rim = { x0: -2, z0: 3, x1: 2, z1: 3, y: 0, thick: 0.5, outward: [0, 1] };
    const meshes = bakeByMaterial(rimPlacements([rim]), kit);
    const dark = meshes.find((m) => m.material === kit.dark)!;
    dark.geometry.computeBoundingBox();
    const box = dark.geometry.boundingBox!;
    expect(box.max.z).toBeCloseTo(3.02);
    expect(box.min.z).toBeCloseTo(3 - 0.24);
    expect(box.min.x).toBeCloseTo(-2);
    expect(box.max.x).toBeCloseTo(2);
    expect(box.max.y).toBeCloseTo(RIM_LIFT);
    expect(box.min.y).toBeCloseTo(-0.5 + RIM_LIFT);
  });

  it('yields one placement per exposed rim segment', () => {
    for (const platforms of [[slab(0, 0)], [slab(0, 0), slab(10, 0)], [slab(0, 0), slab(4, 0)]]) {
      expect(rimPlacements(exposedRims(platforms))).toHaveLength(exposedRims(platforms).length);
    }
    expect(rimPlacements([])).toEqual([]);
  });
});

describe('rimTrimColor', () => {
  it('differs between accents', () => {
    expect(rimTrimColor(new Color(0x5ce1ff)).getHex()).not.toBe(rimTrimColor(new Color(0xff4a8d)).getHex());
  });

  it('stays warm for a cyan accent', () => {
    const c = rimTrimColor(new Color(0x5ce1ff));
    expect(c.r).toBeGreaterThan(c.b);
  });

  it('is the amber itself for an amber accent', () => {
    expect(rimTrimColor(new Color(0xd98a1c)).getHex()).toBe(0xd98a1c);
  });
});

describe('buildForgeRims', () => {
  const accent = new Color(0x5ce1ff);

  it('returns null without floorable slabs or without the edge prototype', () => {
    expect(buildForgeRims(fakeKit() as ForgeKit, [], accent)).toBeNull();
    expect(buildForgeRims(fakeKit() as ForgeKit, [slab(0, 0, 4, 4, 3, 3)], accent)).toBeNull();
    expect(buildForgeRims({ prototype: () => null } as unknown as ForgeKit, [slab(0, 0)], accent)).toBeNull();
  });

  it('bakes one mesh per material with every rim segment merged', () => {
    const kit = fakeKit();
    const platforms = [slab(0, 0), slab(10, 0)];
    const group = buildForgeRims(kit as ForgeKit, platforms, accent)!;
    const meshes = group.children as Mesh[];
    expect(meshes).toHaveLength(2);
    const rims = exposedRims(platforms);
    expect(rims).toHaveLength(8);
    for (const mesh of meshes) expect(mesh.geometry.getAttribute('position').count).toBe(BOX_VERTS * rims.length);
  });

  it('clones the amber material per level and tints only that clone', () => {
    const kit = fakeKit();
    const before = { emissive: kit.amber.emissive.getHex(), intensity: kit.amber.emissiveIntensity };
    const group = buildForgeRims(kit as ForgeKit, [slab(0, 0)], accent)!;
    const meshes = group.children as Mesh[];
    const trim = meshes.find((m) => (m.material as MeshStandardMaterial).name === 'SHF_MAT_WarningAmber')!;
    const material = trim.material as MeshStandardMaterial;
    expect(material).not.toBe(kit.amber);
    expect(material.emissive.getHex()).toBe(rimTrimColor(accent).getHex());
    expect(material.emissiveIntensity).toBeCloseTo(0.8);
    expect(kit.amber.emissive.getHex()).toBe(before.emissive);
    expect(kit.amber.emissiveIntensity).toBe(before.intensity);
    const other = buildForgeRims(kit as ForgeKit, [slab(0, 0)], new Color(0xff4a8d))!;
    const otherTrim = (other.children as Mesh[]).find((m) => (m.material as MeshStandardMaterial).name === 'SHF_MAT_WarningAmber')!;
    expect((otherTrim.material as MeshStandardMaterial).emissive.getHex()).not.toBe(material.emissive.getHex());
    expect(otherTrim.material).not.toBe(material);
  });

  it('leaves the other materials to the kit and takes shadows only', () => {
    const kit = fakeKit();
    const group = buildForgeRims(kit as ForgeKit, [slab(0, 0)], accent)!;
    const meshes = group.children as Mesh[];
    expect(meshes.some((m) => m.material === kit.dark)).toBe(true);
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it('reports rim counts per level', () => {
    const rows: string[] = [];
    for (const level of LEVELS) {
      const rims = exposedRims(level.platforms);
      rows.push(`L${level.id}: ${rims.length} rims`);
      expect(rimPlacements(rims)).toHaveLength(rims.length);
      expect(buildForgeRims(fakeKit() as ForgeKit, level.platforms, accent) !== null).toBe(rims.length > 0);
    }
    console.log(rows.join('\n'));
  });
});
