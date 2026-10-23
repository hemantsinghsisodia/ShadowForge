import { describe, expect, it, vi } from 'vitest';
import { AdditiveBlending, Points, ShaderMaterial } from 'three';
import { EMBER_FRAG, EMBER_VERT, Embers, emberState, seedEmbers, type EmberSeed } from '../src/effects/Embers';
import { ABYSS_Y, ForgeCavern, MENU_BOUNDS, type CavernBounds } from '../src/world/ForgeCavern';
import { CAVERN } from '../src/world/ForgePalette';

const BOUNDS: CavernBounds = { minX: 0, maxX: 24, minZ: -10, maxZ: 6 };
const SEED: EmberSeed = { x: 2, z: 3, phase: 0, speed: 1, sway: 0.5, size: 1, rise: 14 };

function emberPoints(cavern: ForgeCavern): Points | undefined {
  return cavern.group.children.find((child) => child.name === 'embers') as Points | undefined;
}

describe('seedEmbers', () => {
  const midZ = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  const halfDepth = (BOUNDS.maxZ - BOUNDS.minZ) / 2;

  it('is deterministic for the same seed and differs for another', () => {
    expect(seedEmbers(200, BOUNDS, 1337)).toEqual(seedEmbers(200, BOUNDS, 1337));
    expect(seedEmbers(200, BOUNDS, 1337)).not.toEqual(seedEmbers(200, BOUNDS, 7));
  });

  it('returns nothing for a zero or negative count', () => {
    expect(seedEmbers(0, BOUNDS, 1337)).toEqual([]);
    expect(seedEmbers(-5, BOUNDS, 1337)).toEqual([]);
  });

  it('keeps every ember either in a side band or under the footprint below the floor', () => {
    const seeds = seedEmbers(400, BOUNDS, 1337);
    expect(seeds).toHaveLength(400);
    let side = 0;
    for (const s of seeds) {
      const off = Math.abs(s.z - midZ);
      expect(s.x).toBeGreaterThanOrEqual(BOUNDS.minX - 20);
      expect(s.x).toBeLessThanOrEqual(BOUNDS.maxX + 20);
      if (off >= halfDepth + 1.5 - 1e-9) {
        side++;
        expect(off).toBeLessThanOrEqual(halfDepth + 16 + 1e-9);
        expect(s.rise).toBe(14);
      } else {
        expect(off).toBeLessThan(halfDepth);
        expect(ABYSS_Y + s.rise).toBeLessThanOrEqual(-1);
      }
    }
    expect(side).toBe(320);
  });

  it('keeps footprint embers below the floor at every moment of their life', () => {
    for (const s of seedEmbers(400, BOUNDS, 1337)) {
      if (Math.abs(s.z - midZ) >= halfDepth) continue;
      for (let t = 0; t < 40; t += 0.37) {
        expect(emberState(s, t).y).toBeLessThanOrEqual(-1 + 1e-9);
      }
    }
  });
});

describe('emberState', () => {
  it('is periodic in 1 / speed', () => {
    const s = { ...SEED, phase: 0.3, speed: 0.08 };
    const a = emberState(s, 4.2);
    const b = emberState(s, 4.2 + 1 / s.speed);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.alpha).toBeCloseTo(a.alpha, 6);
  });

  it('fades in from nothing, peaks mid-life and is gone by the end', () => {
    expect(emberState(SEED, 0).alpha).toBe(0);
    expect(emberState(SEED, 1 - 1e-9).alpha).toBeCloseTo(0, 6);
    const mid = emberState(SEED, 0.4).alpha;
    expect(mid).toBeCloseTo(1, 6);
    expect(mid).toBeGreaterThan(emberState(SEED, 0.05).alpha);
    expect(mid).toBeGreaterThan(emberState(SEED, 0.9).alpha);
  });

  it('rises monotonically from the abyss', () => {
    expect(emberState(SEED, 0).y).toBe(ABYSS_Y);
    let prev = -Infinity;
    for (let life = 0; life < 1; life += 0.05) {
      const y = emberState(SEED, life).y;
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
    expect(emberState(SEED, 0.5).y).toBeCloseTo(ABYSS_Y + 7, 9);
  });

  it('sways in x around the spawn point only', () => {
    expect(emberState(SEED, 0.5).z).toBe(SEED.z);
    for (let life = 0; life < 1; life += 0.1) {
      expect(Math.abs(emberState(SEED, life).x - SEED.x)).toBeLessThanOrEqual(SEED.sway + 1e-9);
    }
  });
});

describe('Embers', () => {
  const seeds = seedEmbers(50, BOUNDS, 1337);

  it('packs one vertex per seed with the seed fields as attributes', () => {
    const embers = new Embers(seeds);
    const geometry = embers.points.geometry;
    expect(geometry.getAttribute('position').count).toBe(50);
    expect(geometry.getAttribute('aSeed').itemSize).toBe(4);
    expect(geometry.getAttribute('aRise').itemSize).toBe(1);
    expect(geometry.getAttribute('position').getX(3)).toBeCloseTo(seeds[3].x, 4);
    expect(geometry.getAttribute('position').getZ(3)).toBeCloseTo(seeds[3].z, 4);
    expect(geometry.getAttribute('aSeed').getW(3)).toBeCloseTo(seeds[3].size, 4);
    expect(geometry.getAttribute('aRise').getX(3)).toBe(seeds[3].rise);
    embers.dispose();
  });

  it('is additive, depth-tested, unfogged and never culled', () => {
    const embers = new Embers(seeds);
    const material = embers.points.material as ShaderMaterial;
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.fog).toBe(false);
    expect(embers.points.frustumCulled).toBe(false);
    embers.dispose();
  });

  it('wraps time at 600 and scales points by the pixel ratio', () => {
    const embers = new Embers(seeds);
    const uniforms = (embers.points.material as ShaderMaterial).uniforms;
    embers.setTime(700);
    expect(uniforms.uTime.value).toBeCloseTo(100);
    embers.setPixelRatio(2);
    expect(uniforms.uScale.value).toBe(2);
    embers.dispose();
  });

  it('disposes its geometry and material', () => {
    const embers = new Embers(seeds);
    const geometry = vi.spyOn(embers.points.geometry, 'dispose');
    const material = vi.spyOn(embers.points.material as ShaderMaterial, 'dispose');
    embers.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('keeps the shader maths in step with emberState', () => {
    for (const snippet of [
      'fract(uTime * aSeed.y + aSeed.x)',
      'life * 9.4 + aSeed.x * 40.0',
      'smoothstep(0.0, 0.12, life)',
      'smoothstep(0.65, 1.0, life)',
      '1.6',
    ]) {
      expect(EMBER_VERT + EMBER_FRAG).toContain(snippet);
    }
  });
});

describe('ForgeCavern embers', () => {
  it('builds no points at all on the low tier', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('low', 0);
    expect(emberPoints(cavern)).toBeUndefined();
  });

  it('builds the budgeted count and removes it again when the budget drops to zero', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    const points = emberPoints(cavern);
    expect(points).toBeDefined();
    expect(points!.geometry.getAttribute('position').count).toBe(400);
    const geometry = vi.spyOn(points!.geometry, 'dispose');
    cavern.setDetail('low', 0);
    expect(emberPoints(cavern)).toBeUndefined();
    expect(geometry).toHaveBeenCalledOnce();
  });

  it('rebuilds on a count change and keeps the same points otherwise', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('medium', 200);
    const first = emberPoints(cavern);
    cavern.setDetail('medium', 200);
    expect(emberPoints(cavern)).toBe(first);
    const geometry = vi.spyOn(first!.geometry, 'dispose');
    const material = vi.spyOn(first!.material as ShaderMaterial, 'dispose');
    cavern.setDetail('medium', 120);
    expect(emberPoints(cavern)).not.toBe(first);
    expect(emberPoints(cavern)!.geometry.getAttribute('position').count).toBe(120);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('re-seeds on a bounds change only', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('medium', 200);
    cavern.mount({ ...BOUNDS });
    const first = emberPoints(cavern);
    cavern.mount({ ...BOUNDS });
    expect(emberPoints(cavern)).toBe(first);
    cavern.mount(MENU_BOUNDS);
    expect(emberPoints(cavern)).not.toBe(first);
  });

  it('seeds deterministically for the same bounds and count', () => {
    const a = new ForgeCavern();
    const b = new ForgeCavern();
    for (const cavern of [a, b]) {
      cavern.mount(BOUNDS);
      cavern.setDetail('high', 400);
    }
    const pa = emberPoints(a)!.geometry.getAttribute('position').array;
    const pb = emberPoints(b)!.geometry.getAttribute('position').array;
    expect(Array.from(pa)).toEqual(Array.from(pb));
  });

  it('drives time and pixel ratio, including into rebuilt embers', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    cavern.setPixelRatio(1.5);
    cavern.update(700);
    cavern.setDetail('high', 300);
    const uniforms = (emberPoints(cavern)!.material as ShaderMaterial).uniforms;
    expect(uniforms.uTime.value).toBeCloseTo(100);
    expect(uniforms.uScale.value).toBe(1.5);
  });

  it('hides the embers when CAVERN.embers is off', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    try {
      cavern.tune({ embers: false });
      expect(emberPoints(cavern)!.visible).toBe(false);
      cavern.setDetail('high', 300);
      expect(emberPoints(cavern)!.visible).toBe(false);
      cavern.tune({ embers: true });
      expect(emberPoints(cavern)!.visible).toBe(true);
    } finally {
      CAVERN.embers = true;
    }
  });
});
