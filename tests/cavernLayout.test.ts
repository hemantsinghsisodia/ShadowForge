import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import type { PlatformConfig } from '../src/levels/LevelData';
import { corridor, exposedRims, levelBounds, placeStructures, type Placement } from '../src/world/CavernLayout';
import { ABYSS_Y } from '../src/world/ForgePalette';

const SEEDS = [0, 1, 7, 12345];
/** Z half-extent of each piece's footprint at scale 1 (pieces run along X, or are pillars/lamps). */
const HALF_Z: Record<string, number> = {
  SHF_Pillar_A: 0.28,
  SHF_Lamp_Industrial: 0.17,
  SHF_Structure_Beam: 0.11,
  SHF_Structure_CableTray: 0.11,
  SHF_Floor_Edge: 0.14,
};
const slabsOf = (platforms: PlatformConfig[]) => platforms.filter((p) => p.size[1] <= 1.2 && p.size[0] >= 1.2 && p.size[2] >= 1.2);
const slab = (x: number, z: number, w = 4, d = 4, y = -0.25, h = 0.5): PlatformConfig => ({ position: [x, y, z], size: [w, h, d] });
const total = (rims: ReturnType<typeof exposedRims>) => rims.reduce((sum, r) => sum + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0);

describe('CavernLayout', () => {
  for (const level of LEVELS) {
    const bounds = levelBounds(level.platforms);
    const { midZ, halfDepth } = corridor(bounds);
    const slabs = level.platforms;

    describe(`level ${level.id}`, () => {
      it('non-support pieces stay outside the camera band', () => {
        for (const seed of SEEDS) {
          for (const detail of ['high', 'medium'] as const) {
            for (const p of placeStructures(bounds, slabs, detail, seed)) {
              if (p.role === 'support') continue;
              expect(Math.abs(p.position[2] - midZ)).toBeGreaterThanOrEqual(halfDepth + 7);
            }
          }
        }
      });

      it('supports stay under their slab and inside its footprint', () => {
        const floorable = slabsOf(slabs);
        const out = placeStructures(bounds, slabs, 'high', 3).filter((p) => p.role === 'support');
        expect(out.length).toBeGreaterThan(0);
        for (const p of out) {
          const halfX = p.piece === 'SHF_Pillar_A' ? 0.4 : p.scale[0];
          const halfZ = p.piece === 'SHF_Pillar_A' ? 0.4 : 0.11;
          const owner = floorable.find(
            (s) =>
              p.top <= s.position[1] - s.size[1] / 2 + 1e-9 &&
              p.position[0] - halfX >= s.position[0] - s.size[0] / 2 &&
              p.position[0] + halfX <= s.position[0] + s.size[0] / 2 &&
              p.position[2] - halfZ >= s.position[2] - s.size[2] / 2 &&
              p.position[2] + halfZ <= s.position[2] + s.size[2] / 2,
          );
          expect(owner).toBeDefined();
        }
      });

      it('every floor slab gets at least 4 supports on high', () => {
        const out = placeStructures(bounds, slabs, 'high', 3).filter((p) => p.role === 'support' && p.piece === 'SHF_Pillar_A');
        for (const s of slabsOf(slabs)) {
          if (s.position[1] - s.size[1] / 2 <= ABYSS_Y + 1) continue;
          const mine = out.filter(
            (p) =>
              Math.abs(p.position[0] - s.position[0]) < s.size[0] / 2 &&
              Math.abs(p.position[2] - s.position[2]) < s.size[2] / 2 &&
              p.top <= s.position[1] - s.size[1] / 2 + 1e-9,
          );
          expect(mine.length).toBeGreaterThanOrEqual(4);
        }
      });

      it('nothing crosses the corridor overhead', () => {
        const minZ = midZ - halfDepth;
        const maxZ = midZ + halfDepth;
        for (const p of placeStructures(bounds, slabs, 'high', 5)) {
          if (p.role === 'support') continue;
          const half = HALF_Z[p.piece] * Math.max(p.scale[2], 1);
          const z0 = p.position[2] - half;
          const z1 = p.position[2] + half;
          expect(z1 < minZ || z0 > maxZ).toBe(true);
        }
      });

      it('is deterministic per seed', () => {
        expect(placeStructures(bounds, slabs, 'high', 42)).toEqual(placeStructures(bounds, slabs, 'high', 42));
        expect(placeStructures(bounds, slabs, 'medium', 42)).toEqual(placeStructures(bounds, slabs, 'medium', 42));
      });

      it('medium places at most 60% of high, and keeps towers on both sides', () => {
        const high = placeStructures(bounds, slabs, 'high', 9);
        const medium = placeStructures(bounds, slabs, 'medium', 9);
        expect(high.length).toBeGreaterThan(0);
        expect(medium.length).toBeGreaterThan(0);
        expect(medium.length).toBeLessThanOrEqual(high.length * 0.6);
      });

      it('low places nothing', () => {
        expect(placeStructures(bounds, slabs, 'low', 9)).toEqual([]);
      });
    });
  }

  it('towers rise from the abyss to y = +1 under a lamp', () => {
    const bounds = { minX: -10, maxX: 10, minZ: -3, maxZ: 3 };
    const out: Placement[] = placeStructures(bounds, [], 'high', 1);
    const pillars = out.filter((p) => p.piece === 'SHF_Pillar_A');
    expect(pillars.length).toBeGreaterThan(0);
    for (const p of pillars) {
      expect(p.position[1]).toBe(ABYSS_Y);
      expect(p.top).toBeCloseTo(1, 9);
      expect(p.scale[1]).toBeCloseTo((1 - ABYSS_Y) / 3.08, 9);
    }
    for (const lamp of out.filter((p) => p.piece === 'SHF_Lamp_Industrial')) expect(lamp.top).toBeCloseTo(2.78, 9);
  });

  it('puts support pillars and cross beams under a slab, topping exactly at its bottom', () => {
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    const under = placeStructures(bounds, [slab(0, 0)], 'high', 1).filter((p) => p.role === 'support');
    const pillars = under.filter((p) => p.piece === 'SHF_Pillar_A');
    expect(pillars.length).toBe(4);
    for (const p of pillars) {
      expect(p.position[1]).toBe(ABYSS_Y);
      expect(p.scale[1]).toBeCloseTo((-0.5 - ABYSS_Y) / 3.08, 9);
      expect(p.top).toBeCloseTo(-0.5, 9);
    }
    const beams = under.filter((p) => p.piece === 'SHF_Structure_Beam');
    expect(beams.length).toBe(2);
    for (const b of beams) {
      expect(b.position[1]).toBeCloseTo(-0.9, 9);
      expect(b.top).toBeCloseTo(-0.7, 9);
      expect(b.scale[0]).toBeCloseTo(1.4, 9);
    }
  });

  it('medium keeps corner supports only', () => {
    const bounds = { minX: -8, maxX: 8, minZ: -2, maxZ: 2 };
    const under = placeStructures(bounds, [slab(0, 0, 16, 4)], 'medium', 1).filter((p) => p.role === 'support');
    expect(under.length).toBe(4);
  });

  it('gives raised slabs supports too, topping at their bottom', () => {
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    const raised = placeStructures(bounds, [slab(0, 0, 4, 4, 3)], 'high', 1).filter((p) => p.role === 'support' && p.piece === 'SHF_Pillar_A');
    expect(raised.length).toBe(4);
    for (const p of raised) expect(p.top).toBeCloseTo(2.75, 9);
  });

  it('adds intermediate pillars along edges longer than 6 m', () => {
    const bounds = { minX: -8, maxX: 8, minZ: -2, maxZ: 2 };
    const out = placeStructures(bounds, [slab(0, 0, 16, 4)], 'high', 1);
    const under = out.filter((p) => p.role === 'support' && p.piece === 'SHF_Pillar_A');
    const xs = [...new Set(under.map((p) => +p.position[0].toFixed(3)))].sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(2);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('exposedRims of two abutting 4x4 slabs totals 24 m (their 4 m seam is hidden)', () => {
    expect(total(exposedRims([slab(0, 0), slab(4, 0)]))).toBeCloseTo(24, 6);
  });

  it('exposedRims splits a partial overlap', () => {
    // Second slab is offset 2 m in Z: the shared seam is 2 m, so 32 - 2 * 2 = 28 m remain.
    expect(total(exposedRims([slab(0, 0), slab(4, 2)]))).toBeCloseTo(28, 6);
  });

  it('exposedRims keeps the seam when the tops differ', () => {
    expect(total(exposedRims([slab(0, 0), slab(4, 0, 4, 4, 0.75)]))).toBeCloseTo(32, 6);
  });

  it('exposedRims of a lone 4x4 slab totals 16 m', () => {
    const rims = exposedRims([slab(0, 0)]);
    expect(total(rims)).toBeCloseTo(16, 6);
    for (const r of rims) {
      expect(r.y).toBeCloseTo(0, 9);
      expect(r.thick).toBeCloseTo(0.5, 9);
      expect(Math.hypot(r.outward[0], r.outward[1])).toBeCloseTo(1, 9);
    }
  });

  it('exposedRims ignores slabs that are not floor-like', () => {
    expect(exposedRims([slab(0, 0, 4, 4, 1, 2)])).toEqual([]);
  });
});
