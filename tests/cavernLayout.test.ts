import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import type { PlatformConfig } from '../src/levels/LevelData';
import { CAMERA_DISTANCE } from '../src/player/CameraRig';
import {
  BEAM_Y,
  CAMERA_BAND,
  CAMERA_REACH,
  GANTRY_PAUSE,
  GANTRY_SPEED,
  RAIL_OFFSET,
  RAIL_Y,
  chainSites,
  corridor,
  exposedRims,
  gantryX,
  levelBounds,
  placeStructures,
  railLine,
  railPlacements,
  sunShadowFrame,
  swayAngle,
  towerSites,
  trolleyRange,
  type Placement,
} from '../src/world/CavernLayout';
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
/** Rail columns are 'tower' pillars too; the lamp towers top out at y = 1, the rail columns at RAIL_Y. */
const isRailPiece = (p: Placement) => p.top >= RAIL_Y;
const slab = (x: number, z: number, w = 4, d = 4, y = -0.25, h = 0.5): PlatformConfig => ({ position: [x, y, z], size: [w, h, d] });
const total = (rims: ReturnType<typeof exposedRims>) => rims.reduce((sum, r) => sum + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0);

describe('CavernLayout', () => {
  it('keeps the camera band wider than the camera reach', () => {
    expect(CAMERA_REACH).toBe(CAMERA_DISTANCE);
    expect(CAMERA_BAND).toBeGreaterThan(CAMERA_DISTANCE);
  });

  it('emits a single cross beam at the midpoint of a slab narrower than 0.3 m between its beam lines', () => {
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    // Depth 1.3 less the 0.6 m insets leaves 0.1 m between z0 and z1.
    const beams = placeStructures(bounds, [slab(0, 0, 4, 1.3)], 'high', 1).filter((p) => p.role === 'support' && p.piece === 'SHF_Structure_Beam');
    expect(beams).toHaveLength(1);
    expect(beams[0].position[2]).toBeCloseTo(0, 9);
  });

  it('still emits two cross beams on a normal slab', () => {
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    expect(placeStructures(bounds, [slab(0, 0)], 'high', 1).filter((p) => p.role === 'support' && p.piece === 'SHF_Structure_Beam')).toHaveLength(2);
  });

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
              expect(Math.abs(p.position[2] - midZ)).toBeGreaterThanOrEqual(halfDepth + CAMERA_BAND);
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

      it('no support runs through another platform, and every support tops at or below the floor', () => {
        for (const p of placeStructures(bounds, slabs, 'high', 3).filter((q) => q.role === 'support')) {
          expect(p.top).toBeLessThanOrEqual(0);
          const halfX = p.piece === 'SHF_Pillar_A' ? 0.4 : p.scale[0];
          const halfZ = p.piece === 'SHF_Pillar_A' ? 0.4 : 0.11;
          for (const o of slabs) {
            const overlaps =
              p.position[0] + halfX > o.position[0] - o.size[0] / 2 + 1e-6 &&
              p.position[0] - halfX < o.position[0] + o.size[0] / 2 - 1e-6 &&
              p.position[2] + halfZ > o.position[2] - o.size[2] / 2 + 1e-6 &&
              p.position[2] - halfZ < o.position[2] + o.size[2] / 2 - 1e-6;
            // The slab it hangs from has its bottom at or above the top; any platform reaching below it is a pierce.
            if (overlaps) expect(o.position[1] - o.size[1] / 2).toBeGreaterThanOrEqual(p.top - 1e-9);
          }
        }
      });

      it('every floor-level slab gets at least 4 supports on high', () => {
        const out = placeStructures(bounds, slabs, 'high', 3).filter((p) => p.role === 'support' && p.piece === 'SHF_Pillar_A');
        for (const s of slabsOf(slabs)) {
          if (s.position[1] - s.size[1] / 2 > 0) continue;
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

      const mediumTowers = () => placeStructures(bounds, slabs, 'medium', 9).filter((p) => p.role === 'tower' && p.piece === 'SHF_Pillar_A' && !isRailPiece(p));

      it('medium keeps at least 2 towers per side when the level spans more than 30 m in X', () => {
        if (bounds.maxX - bounds.minX <= 30) return;
        const towers = mediumTowers();
        expect(towers.filter((p) => p.position[2] > midZ).length).toBeGreaterThanOrEqual(2);
        expect(towers.filter((p) => p.position[2] < midZ).length).toBeGreaterThanOrEqual(2);
      });

      it('medium towers cover both halves of the level X range', () => {
        const midX = (bounds.minX + bounds.maxX) / 2;
        const xs = mediumTowers().map((p) => p.position[0]);
        expect(xs.some((x) => x < midX)).toBe(true);
        expect(xs.some((x) => x > midX)).toBe(true);
      });

      it('low places nothing', () => {
        expect(placeStructures(bounds, slabs, 'low', 9)).toEqual([]);
      });
    });
  }

  it('towers rise from the abyss to y = +1 under a lamp', () => {
    const bounds = { minX: -10, maxX: 10, minZ: -3, maxZ: 3 };
    const out: Placement[] = placeStructures(bounds, [], 'high', 1);
    const pillars = out.filter((p) => p.piece === 'SHF_Pillar_A' && !isRailPiece(p));
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

  it('gives raised slabs no supports', () => {
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    expect(placeStructures(bounds, [slab(0, 0, 4, 4, 3)], 'high', 1).filter((p) => p.role === 'support')).toEqual([]);
  });

  it('drops only the support pieces that would pierce another platform', () => {
    const bounds = { minX: -4, maxX: 4, minZ: -2, maxZ: 2 };
    // A block reaching below the slab, overlapping its middle: the middle pillars are cut, the corner ones stay.
    const block: PlatformConfig = { position: [0, -1, 0], size: [2, 3, 4] };
    const out = placeStructures(bounds, [slab(0, 0, 8, 4), block], 'high', 1).filter((p) => p.role === 'support');
    const pillars = out.filter((p) => p.piece === 'SHF_Pillar_A');
    expect(pillars.length).toBeGreaterThan(0);
    expect(pillars.length).toBe(4);
    for (const p of pillars) expect(Math.abs(p.position[0]) - 0.4).toBeGreaterThanOrEqual(1 - 1e-6);
    // The cross beams run through the block too and are dropped.
    expect(out.filter((p) => p.piece === 'SHF_Structure_Beam')).toEqual([]);
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

describe('towerSites', () => {
  const bounds = { minX: -20, maxX: 20, minZ: -4, maxZ: 6 };
  const { midZ, halfDepth } = corridor(bounds);

  it('is deterministic and empty on low', () => {
    expect(towerSites(bounds, 'high')).toEqual(towerSites(bounds, 'high'));
    expect(towerSites(bounds, 'medium')).toEqual(towerSites(bounds, 'medium'));
    expect(towerSites(bounds, 'low')).toEqual([]);
  });

  it('puts every site halfDepth + 9 from the corridor centre, on the side it names', () => {
    for (const detail of ['medium', 'high'] as const) {
      const sites = towerSites(bounds, detail);
      expect(sites.length).toBeGreaterThan(0);
      for (const s of sites) {
        expect(Math.abs(s.z - midZ)).toBeCloseTo(halfDepth + 9, 9);
        expect(Math.sign(s.z - midZ)).toBe(s.side);
      }
    }
  });

  it('matches the tower pillars placeStructures emits', () => {
    for (const detail of ['medium', 'high'] as const) {
      const pillars = placeStructures(bounds, [], detail, 1).filter((p) => p.role === 'tower' && p.piece === 'SHF_Pillar_A' && !isRailPiece(p));
      expect(pillars.map((p) => [p.position[0], p.position[2]])).toEqual(towerSites(bounds, detail).map((s) => [s.x, s.z]));
    }
  });

  it('exports the link beam height', () => {
    expect(BEAM_Y).toBe(0.6);
  });
});

describe('gantry rail and chains', () => {
  const SEEDS_1_4 = [1, 2, 3, 4];

  for (const level of LEVELS) {
    const bounds = levelBounds(level.platforms);
    const { midZ, halfDepth } = corridor(bounds);
    const edge = halfDepth + CAMERA_BAND;

    describe(`level ${level.id}`, () => {
      it('railLine is null on low and sits at the +Z offset on medium and high', () => {
        expect(railLine(bounds, 'low')).toBeNull();
        for (const detail of ['medium', 'high'] as const) {
          const rail = railLine(bounds, detail);
          expect(rail).not.toBeNull();
          expect(rail!.z).toBeCloseTo(midZ + halfDepth + RAIL_OFFSET, 9);
          expect(rail!.y).toBe(RAIL_Y);
          expect(rail!.x1).toBeGreaterThan(rail!.x0);
        }
        expect(railLine(bounds, 'medium')).toEqual(railLine(bounds, 'high'));
      });

      it('rail placements stay outside the camera band and span x0..x1', () => {
        for (const detail of ['medium', 'high'] as const) {
          const rail = railLine(bounds, detail)!;
          const spacing = detail === 'medium' ? 24 : 12;
          const out = railPlacements(rail, spacing);
          const columns = out.filter((p) => p.role === 'tower');
          const beams = out.filter((p) => p.role === 'link');
          expect(columns.length).toBeGreaterThanOrEqual(2);
          expect(beams).toHaveLength(columns.length - 1);
          expect(columns[0].position[0]).toBeCloseTo(rail.x0, 9);
          expect(columns[columns.length - 1].position[0]).toBeCloseTo(rail.x1, 9);
          for (const p of out) expect(Math.abs(p.position[2] - midZ)).toBeGreaterThanOrEqual(edge);
          for (const c of columns) {
            expect(c.position[1]).toBe(ABYSS_Y);
            expect(c.top).toBeCloseTo(RAIL_Y, 9);
            expect(c.scale[1]).toBeCloseTo((RAIL_Y - ABYSS_Y) / 3.08, 9);
          }
          for (const b of beams) {
            expect(b.position[1]).toBe(RAIL_Y);
            expect(b.top).toBeCloseTo(RAIL_Y + 0.2, 9);
          }
          for (let i = 1; i < columns.length; i++) {
            expect(columns[i].position[0] - columns[i - 1].position[0]).toBeLessThanOrEqual(spacing + 1e-9);
          }
        }
      });

      it('placeStructures includes the rail, and every non-support piece stays outside the band', () => {
        for (const seed of SEEDS_1_4) {
          for (const detail of ['medium', 'high'] as const) {
            const out = placeStructures(bounds, level.platforms, detail, seed);
            expect(out.filter(isRailPiece).length).toBeGreaterThan(0);
            for (const p of out) {
              if (p.role === 'support') continue;
              expect(Math.abs(p.position[2] - midZ)).toBeGreaterThanOrEqual(edge);
            }
          }
        }
        expect(placeStructures(bounds, level.platforms, 'low', 1).filter(isRailPiece)).toEqual([]);
      });

      it('rail columns stay clear of the trolley line z = rail.z', () => {
        for (const detail of ['medium', 'high'] as const) {
          const rail = railLine(bounds, detail)!;
          const columns = placeStructures(bounds, level.platforms, detail, 1).filter((p) => isRailPiece(p) && p.piece === 'SHF_Pillar_A');
          expect(columns.length).toBeGreaterThanOrEqual(2);
          for (const c of columns) {
            // Footprint half-width 0.28 (rotationY is 0): its nearest face to the trolley line.
            expect(Math.abs(c.position[2] - rail.z) - 0.28).toBeGreaterThanOrEqual(0.25);
            expect(c.position[2]).toBeCloseTo(rail.z + 0.6, 9);
          }
          for (const b of placeStructures(bounds, level.platforms, detail, 1).filter((p) => isRailPiece(p) && p.piece === 'SHF_Structure_Beam')) {
            expect(b.position[2]).toBeCloseTo(rail.z, 9);
          }
        }
      });

      it('rail-hung chains keep 1 m in x from every rail column and every +Z tower', () => {
        for (const seed of [0, 1, 2, 3, 4, 7, 12345]) {
          for (const detail of ['medium', 'high'] as const) {
            const rail = railLine(bounds, detail)!;
            const obstacles = [
              ...placeStructures(bounds, level.platforms, detail, seed).filter((p) => isRailPiece(p) && p.piece === 'SHF_Pillar_A').map((p) => p.position[0]),
              ...towerSites(bounds, detail).filter((t) => t.side === 1).map((t) => t.x),
            ];
            const onRail = chainSites(bounds, detail, seed).filter((c) => c.pivotY === RAIL_Y);
            expect(onRail.length).toBeGreaterThan(0);
            for (const c of onRail) {
              expect(c.x).toBeGreaterThanOrEqual(rail.x0);
              expect(c.x).toBeLessThanOrEqual(rail.x1);
              for (const o of obstacles) expect(Math.abs(c.x - o)).toBeGreaterThanOrEqual(1);
            }
          }
        }
      });

      it('every chain swing envelope stays outside the camera band', () => {
        for (const seed of SEEDS_1_4) {
          for (const detail of ['medium', 'high'] as const) {
            for (const c of chainSites(bounds, detail, seed)) {
              const reach = c.length * Math.sin(c.amp) + 0.3;
              const near = Math.abs(c.z - midZ) - reach;
              expect(near).toBeGreaterThanOrEqual(edge);
            }
          }
        }
      });

      it('chains hang inside the rail x range', () => {
        for (const detail of ['medium', 'high'] as const) {
          const rail = railLine(bounds, detail)!;
          for (const c of chainSites(bounds, detail, 1)) {
            expect(c.x).toBeGreaterThanOrEqual(rail.x0);
            expect(c.x).toBeLessThanOrEqual(rail.x1);
          }
        }
      });
    });
  }

  it('rail columns are placed every 12 m including both ends, the last gap being shorter', () => {
    const rail = { x0: 0, x1: 30, z: 20, y: RAIL_Y };
    const xs = railPlacements(rail).filter((p) => p.role === 'tower').map((p) => p.position[0]);
    expect(xs).toEqual([0, 12, 24, 30]);
    const beams = railPlacements(rail).filter((p) => p.role === 'link');
    expect(beams.map((b) => b.position[0])).toEqual([6, 18, 27]);
    expect(beams.map((b) => b.scale[0])).toEqual([6, 6, 3]);
    expect(railPlacements({ x0: 0, x1: 24, z: 20, y: RAIL_Y }).filter((p) => p.role === 'tower').map((p) => p.position[0])).toEqual([0, 12, 24]);
  });

  it('trolleyRange is the forward half of the rail', () => {
    expect(trolleyRange({ x0: -5, x1: 25, z: 0, y: RAIL_Y })).toEqual({ x0: 10, x1: 25 });
    expect(trolleyRange({ x0: 0, x1: 30, z: 0, y: RAIL_Y })).toEqual({ x0: 15, x1: 30 });
  });

  describe('gantryX', () => {
    const rail = { x0: -5, x1: 25, z: 0, y: RAIL_Y };
    const range = trolleyRange(rail);
    const T = (range.x1 - range.x0) / GANTRY_SPEED;
    const P = 2 * (T + GANTRY_PAUSE);

    it('starts at the trolley range start, ends the first leg at its end and returns', () => {
      expect(gantryX(0, rail)).toBe(range.x0);
      expect(gantryX(T, rail)).toBeCloseTo(range.x1, 9);
      expect(gantryX(T + GANTRY_PAUSE + T, rail)).toBeCloseTo(range.x0, 9);
      expect(gantryX(P, rail)).toBeCloseTo(range.x0, 9);
      expect(gantryX(P + 1, rail)).toBeCloseTo(gantryX(1, rail), 9);
    });

    it('stays in the forward half of the rail and wraps negative time', () => {
      for (let t = -P; t <= 3 * P; t += 0.37) {
        const x = gantryX(t, rail);
        expect(x).toBeGreaterThanOrEqual(range.x0 - 1e-9);
        expect(x).toBeLessThanOrEqual(range.x1 + 1e-9);
        expect(x).toBeGreaterThanOrEqual((rail.x0 + rail.x1) / 2 - 1e-9);
      }
    });

    it('is continuous, moving at most GANTRY_SPEED * dt per step over three periods', () => {
      let prev = gantryX(0, rail);
      for (let i = 1; i * 0.01 <= 3 * P; i++) {
        const x = gantryX(i * 0.01, rail);
        expect(Math.abs(x - prev)).toBeLessThanOrEqual(GANTRY_SPEED * 0.01 + 1e-6);
        prev = x;
      }
    });

    it('holds exactly at each end for GANTRY_PAUSE', () => {
      for (let k = 0; k <= 10; k++) {
        const dt = (GANTRY_PAUSE * k) / 10;
        expect(gantryX(T + dt - (k === 10 ? 1e-9 : 0), rail)).toBeCloseTo(range.x1, 6);
        expect(gantryX(2 * T + GANTRY_PAUSE + dt - (k === 10 ? 1e-9 : 0), rail)).toBeCloseTo(range.x0, 6);
      }
      expect(gantryX(T + 0.5, rail)).toBe(range.x1);
      expect(gantryX(2 * T + GANTRY_PAUSE + 0.5, rail)).toBe(range.x0);
    });
  });

  it('swayAngle stays within +-amp and follows amp * sin(2 pi t / period + phase)', () => {
    for (let t = 0; t < 60; t += 0.13) {
      expect(Math.abs(swayAngle(t, 1.2, 0.07, 6))).toBeLessThanOrEqual(0.07 + 1e-12);
    }
    expect(swayAngle(0, Math.PI / 2, 0.08, 5)).toBeCloseTo(0.08, 9);
    expect(swayAngle(1.5, 0.4, 0.06, 6)).toBeCloseTo(0.06 * Math.sin((2 * Math.PI * 1.5) / 6 + 0.4), 12);
  });

  describe('chainSites', () => {
    const bounds = { minX: -20, maxX: 20, minZ: -4, maxZ: 6 };
    const { midZ, halfDepth } = corridor(bounds);

    it('is empty on low, 6 on medium and 10 on high', () => {
      expect(chainSites(bounds, 'low', 1)).toEqual([]);
      expect(chainSites(bounds, 'medium', 1)).toHaveLength(6);
      expect(chainSites(bounds, 'high', 1)).toHaveLength(10);
    });

    it('is deterministic per seed and varies between seeds', () => {
      expect(chainSites(bounds, 'high', 3)).toEqual(chainSites(bounds, 'high', 3));
      expect(chainSites(bounds, 'high', 3)).not.toEqual(chainSites(bounds, 'high', 4));
    });

    it('hangs half from the rail and half from the -Z ceiling, with parameters in range', () => {
      const rail = railLine(bounds, 'high')!;
      const sites = chainSites(bounds, 'high', 2);
      const onRail = sites.filter((c) => c.pivotY === RAIL_Y);
      const ceiling = sites.filter((c) => c.pivotY === 14);
      expect(onRail).toHaveLength(5);
      expect(ceiling).toHaveLength(5);
      for (const c of onRail) expect(c.z).toBeCloseTo(rail.z, 9);
      for (const c of ceiling) expect(c.z).toBeCloseTo(midZ - (halfDepth + 12), 9);
      for (const c of sites) {
        expect(c.length).toBeGreaterThanOrEqual(4);
        expect(c.length).toBeLessThanOrEqual(7);
        expect(c.amp).toBeGreaterThanOrEqual(0.05);
        expect(c.amp).toBeLessThanOrEqual(0.09);
        expect(c.period).toBeGreaterThanOrEqual(5);
        expect(c.period).toBeLessThanOrEqual(8);
        expect(c.phase).toBeGreaterThanOrEqual(0);
        expect(c.phase).toBeLessThanOrEqual(2 * Math.PI);
      }
    });
  });
});

describe('sunShadowFrame', () => {
  it('keeps short levels on the original frame', () => {
    expect(sunShadowFrame({ minX: -10, maxX: 10, minZ: 0, maxZ: 0 })).toEqual({ centreX: 0, halfX: 40 });
    expect(sunShadowFrame(levelBounds(LEVELS[0].platforms))).toEqual({ centreX: 0, halfX: 40 });
  });

  it('re-centres a level that does not fit the origin frame', () => {
    const frame = sunShadowFrame({ minX: -12, maxX: 62, minZ: 0, maxZ: 0 });
    expect(frame.centreX).toBe(25);
    expect(frame.halfX).toBeGreaterThanOrEqual(41);
  });

  it('falls back to the original frame with no platforms', () => {
    expect(sunShadowFrame(levelBounds([]))).toEqual({ centreX: 0, halfX: 40 });
  });

  it('widens beyond 40 for very long levels', () => {
    expect(sunShadowFrame({ minX: 0, maxX: 200, minZ: 0, maxZ: 0 })).toEqual({ centreX: 100, halfX: 104 });
  });

  for (const level of LEVELS) {
    it(`covers all of level ${level.id}`, () => {
      const { minX, maxX } = levelBounds(level.platforms);
      const { centreX, halfX } = sunShadowFrame(levelBounds(level.platforms));
      expect(minX).toBeGreaterThanOrEqual(centreX - halfX);
      expect(maxX).toBeLessThanOrEqual(centreX + halfX);
      expect(halfX).toBeGreaterThanOrEqual(40);
    });
  }
});
