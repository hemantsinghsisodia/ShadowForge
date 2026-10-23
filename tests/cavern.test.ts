import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';
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
    expect(material.uniforms.uTime.value).toBeCloseTo(100);
    expect(material.uniforms.uPulse.value).toBeGreaterThan(0.7);
  });
});
