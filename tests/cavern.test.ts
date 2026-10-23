import { Mesh, PlaneGeometry, Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CAVERN } from '../src/world/ForgePalette';
import { ABYSS_Y, ForgeCavern, MENU_BOUNDS } from '../src/world/ForgeCavern';

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

  it('keeps rock banding off the low tier', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('low', 0);
    const low = ((cavern.dome.children[0] as Mesh).material as ShaderMaterial).defines ?? {};
    expect(low.ROCK).toBeUndefined();
    cavern.setDetail('medium', 200);
    const medium = ((cavern.dome.children[0] as Mesh).material as ShaderMaterial).defines ?? {};
    expect(medium.ROCK).toBe(1);
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
