import { describe, expect, it, vi } from 'vitest';
import { AdditiveBlending, Points, ShaderMaterial } from 'three';
import { LEVELS } from '../src/levels';
import { SPARK_FRAG, SPARK_VERT, Sparks, seedSparks, sparkState, type SparkSeed } from '../src/effects/Sparks';
import {
  CAMERA_BAND,
  GANTRY_PAUSE,
  GANTRY_SPEED,
  RAIL_Y,
  corridor,
  gantryX,
  levelBounds,
  railLine,
  type Rail,
} from '../src/world/CavernLayout';
import { ABYSS_Y, ForgeCavern } from '../src/world/ForgeCavern';
import { CAVERN } from '../src/world/ForgePalette';

const BOUNDS = { minX: 0, maxX: 24, minZ: -10, maxZ: 6 };
const RAIL: Rail = railLine(BOUNDS, 'high')!;
const SEED: SparkSeed = { phase: 0, speed: 1, vx: 0.2, vz: 0.1, size: 1.5 };

function sparkPoints(cavern: ForgeCavern): Points | undefined {
  return cavern.group.children.find((child) => child.name === 'sparks') as Points | undefined;
}

describe('seedSparks', () => {
  it('is deterministic for the same seed and differs for another', () => {
    expect(seedSparks(100, 99)).toEqual(seedSparks(100, 99));
    expect(seedSparks(100, 99)).not.toEqual(seedSparks(100, 7));
  });

  it('returns nothing for a zero or negative count', () => {
    expect(seedSparks(0, 99)).toEqual([]);
    expect(seedSparks(-3, 99)).toEqual([]);
  });

  it('draws speeds as multiples of 1/600 giving lives of 0.9-1.4 s, with bounded drift', () => {
    for (const s of seedSparks(500, 99)) {
      expect(Math.abs(s.speed * 600 - Math.round(s.speed * 600))).toBeLessThan(1e-9);
      expect(1 / s.speed).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(1 / s.speed).toBeLessThanOrEqual(1.4 + 1e-9);
      expect(Math.abs(s.vx)).toBeLessThanOrEqual(0.4);
      expect(Math.abs(s.vz)).toBeLessThanOrEqual(0.3);
      expect(s.vz).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(1);
    }
  });

  it('points vz away from the corridor on either side', () => {
    expect(seedSparks(200, 99, -1).every((s) => s.vz <= 0)).toBe(true);
    expect(seedSparks(200, 99, 1).every((s) => s.vz >= 0)).toBe(true);
  });
});

describe('sparkState', () => {
  it('starts at the trolley hook and has no alpha at birth or death', () => {
    const s = { ...SEED, phase: 0, speed: 0.8 };
    // life = fract(t * speed + phase) = 0 when t * speed is an integer.
    const birth = sparkState(s, 5, RAIL);
    expect(birth.alpha).toBe(0);
    expect(birth.x).toBeCloseTo(gantryX(5, RAIL), 9);
    expect(birth.y).toBeCloseTo(RAIL_Y - 3.2, 9);
    expect(birth.z).toBeCloseTo(RAIL.z, 9);
    const death = sparkState(s, 5 + 1 / s.speed - 1e-9, RAIL);
    expect(death.alpha).toBeCloseTo(0, 6);
  });

  it('follows the trolley as it was at the moment of birth', () => {
    const s = { ...SEED, phase: 0, speed: 1 };
    // Born at t = 10, observed 0.5 s later.
    const st = sparkState(s, 10.5, RAIL);
    expect(st.x).toBeCloseTo(gantryX(10, RAIL) + s.vx * 0.5, 9);
    expect(st.z).toBeCloseTo(RAIL.z + s.vz * 0.5, 9);
    expect(st.y).toBeCloseTo(RAIL_Y - 3.2 - 0.5 * 9 * 0.25, 9);
  });

  it('falls monotonically with age', () => {
    const s = { ...SEED, speed: 0.8 };
    let prev = Infinity;
    for (let life = 0; life < 1; life += 0.05) {
      const y = sparkState(s, 5 + life / s.speed, RAIL).y;
      expect(y).toBeLessThan(prev);
      prev = y;
    }
  });

  it('peaks mid-life', () => {
    const mid = sparkState(SEED, 5.3, RAIL).alpha;
    expect(mid).toBeCloseTo(1, 6);
    expect(mid).toBeGreaterThan(sparkState(SEED, 5.02, RAIL).alpha);
    expect(mid).toBeGreaterThan(sparkState(SEED, 5.9, RAIL).alpha);
  });

  it('has no pop across the 600 s life clock wrap, even though the trolley period does not divide 600', () => {
    const period = 2 * ((RAIL.x1 - RAIL.x0) / GANTRY_SPEED + GANTRY_PAUSE);
    expect(600 % period).toBeGreaterThan(1e-3);
    const dt = 1e-3;
    for (const s of seedSparks(300, 99)) {
      // Before the wrap the life clock reads 600 - dt; after it, 0 (600 % 600) while the absolute clock keeps counting.
      const before = sparkState(s, 600 - dt, RAIL, 600 - dt);
      const after = sparkState(s, 600 % 600 + dt, RAIL, 600 + dt);
      if (before.alpha < 0.01 || after.alpha < 0.01) continue;
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.05);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.05);
      expect(Math.abs(after.z - before.z)).toBeLessThan(0.05);
    }
  });

  it('would pop at the wrap if the origin used the wrapped clock', () => {
    // Documents why the origin takes the absolute clock: it is the only thing that keeps the trolley path continuous.
    const popped = seedSparks(300, 99).some((s) => {
      const before = sparkState(s, 600 - 1e-3, RAIL, 600 - 1e-3);
      const wrongAfter = sparkState(s, 1e-3, RAIL, 1e-3);
      return before.alpha > 0.5 && wrongAfter.alpha > 0.5 && Math.abs(wrongAfter.x - before.x) > 0.5;
    });
    expect(popped).toBe(true);
  });

  it('stays out of the camera band and above the abyss on every level', () => {
    for (const level of LEVELS) {
      const bounds = levelBounds(level.platforms);
      const rail = railLine(bounds, 'high');
      if (!rail) continue;
      const { midZ, halfDepth } = corridor(bounds);
      const side = Math.sign(rail.z - midZ) || 1;
      for (const s of seedSparks(60, 99, side as 1 | -1)) {
        let nearest = Infinity;
        let lowest = Infinity;
        for (let t = 0; t < 300; t += 0.37) {
          const st = sparkState(s, t % 600, rail, t);
          nearest = Math.min(nearest, Math.abs(st.z - midZ));
          if (st.alpha > 0) lowest = Math.min(lowest, st.y);
        }
        expect(nearest).toBeGreaterThanOrEqual(halfDepth + CAMERA_BAND);
        expect(lowest).toBeGreaterThan(ABYSS_Y);
        // The lowest point of a life is its end: still above the abyss, where alpha is already zero.
        expect(RAIL_Y - 3.2 - 0.5 * 9 * (1 / s.speed) ** 2).toBeGreaterThan(ABYSS_Y);
      }
    }
  });
});

describe('Sparks', () => {
  const seeds = seedSparks(40, 99);

  it('packs one vertex per seed with the seed fields as attributes', () => {
    const sparks = new Sparks(seeds, RAIL);
    const geometry = sparks.points.geometry;
    expect(geometry.getAttribute('position').count).toBe(40);
    expect(geometry.getAttribute('aSeed').itemSize).toBe(4);
    expect(geometry.getAttribute('aSeed').getX(3)).toBeCloseTo(seeds[3].phase, 5);
    expect(geometry.getAttribute('aSeed').getY(3)).toBeCloseTo(seeds[3].speed, 5);
    expect(geometry.getAttribute('aSeed').getZ(3)).toBeCloseTo(seeds[3].vx, 5);
    expect(geometry.getAttribute('aSeed').getW(3)).toBeCloseTo(seeds[3].vz, 5);
    expect(geometry.getAttribute('aSize').getX(3)).toBeCloseTo(seeds[3].size, 5);
    sparks.dispose();
  });

  it('is additive, unfogged, depth-write free and never culled', () => {
    const sparks = new Sparks(seeds, RAIL);
    const material = sparks.points.material as ShaderMaterial;
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(sparks.points.frustumCulled).toBe(false);
    expect(sparks.points.name).toBe('sparks');
    sparks.dispose();
  });

  it('feeds the rail and gantry constants as uniforms', () => {
    const sparks = new Sparks(seeds, RAIL);
    const u = (sparks.points.material as ShaderMaterial).uniforms;
    expect(u.uRailX0.value).toBe(RAIL.x0);
    expect(u.uRailX1.value).toBe(RAIL.x1);
    expect(u.uRailZ.value).toBe(RAIL.z);
    expect(u.uRailY.value).toBe(RAIL.y);
    expect(u.uSpeed.value).toBe(GANTRY_SPEED);
    expect(u.uPause.value).toBe(GANTRY_PAUSE);
    sparks.dispose();
  });

  it('wraps the life clock at 600 and the origin clock at 86400, and scales points by the pixel ratio', () => {
    const sparks = new Sparks(seeds, RAIL);
    const u = (sparks.points.material as ShaderMaterial).uniforms;
    sparks.setTime(700);
    expect(u.uTime.value).toBeCloseTo(100);
    expect(u.uTimeAbs.value).toBeCloseTo(700);
    sparks.setTime(86400 + 5);
    expect(u.uTimeAbs.value).toBeCloseTo(5);
    sparks.setPixelRatio(2);
    expect(u.uScale.value).toBe(2);
    sparks.dispose();
  });

  it('disposes its geometry and material', () => {
    const sparks = new Sparks(seeds, RAIL);
    const geometry = vi.spyOn(sparks.points.geometry, 'dispose');
    const material = vi.spyOn(sparks.points.material as ShaderMaterial, 'dispose');
    sparks.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('keeps the shader maths in step with sparkState', () => {
    for (const snippet of [
      'fract(uTime * aSeed.y + aSeed.x)',
      'life / aSeed.y',
      'uTimeAbs - age',
      'mod(t, period)',
      'float period = 2.0 * (travel + uPause)',
      'gantryX(birth)',
      'uRailY - 3.2',
      'aSeed.z * age',
      'aSeed.w * age',
      '0.5 * 9.0 * age * age',
      'smoothstep(0.0, 0.05, life)',
      'smoothstep(0.6, 1.0, life)',
      '2.4',
      'min(8.0 * uScale,',
    ]) {
      expect(SPARK_VERT + SPARK_FRAG).toContain(snippet);
    }
  });
});

describe('ForgeCavern sparks', () => {
  it('builds no points on the low tier, where there is no rail', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('low', 0);
    expect(sparkPoints(cavern)).toBeUndefined();
    cavern.setDetail('low', 400);
    expect(sparkPoints(cavern)).toBeUndefined();
  });

  it('builds embers / 4 sparks on high and round(embers / 4) on medium', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    expect(sparkPoints(cavern)!.geometry.getAttribute('position').count).toBe(100);
    cavern.setDetail('medium', 200);
    expect(sparkPoints(cavern)!.geometry.getAttribute('position').count).toBe(50);
    cavern.setDetail('medium', 122);
    expect(sparkPoints(cavern)!.geometry.getAttribute('position').count).toBe(31);
  });

  it('builds nothing at an ember budget of zero and disposes the old points', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    const points = sparkPoints(cavern)!;
    const geometry = vi.spyOn(points.geometry, 'dispose');
    cavern.setDetail('high', 0);
    expect(sparkPoints(cavern)).toBeUndefined();
    expect(geometry).toHaveBeenCalledOnce();
  });

  it('keeps the same points for an unchanged key and rebuilds on count, detail or bounds', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    const first = sparkPoints(cavern);
    cavern.setDetail('high', 400);
    expect(sparkPoints(cavern)).toBe(first);
    cavern.setDetail('high', 200);
    const second = sparkPoints(cavern);
    expect(second).not.toBe(first);
    cavern.mount({ ...BOUNDS, maxX: 40 });
    expect(sparkPoints(cavern)).not.toBe(second);
  });

  it('puts the rail of the mounted bounds into the uniforms', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    const rail = railLine(BOUNDS, 'high')!;
    const u = (sparkPoints(cavern)!.material as ShaderMaterial).uniforms;
    expect(u.uRailX0.value).toBe(rail.x0);
    expect(u.uRailX1.value).toBe(rail.x1);
    expect(u.uRailZ.value).toBe(rail.z);
  });

  it('drives time and pixel ratio, including into rebuilt sparks', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    cavern.setPixelRatio(1.5);
    cavern.update(700);
    cavern.setDetail('high', 300);
    const u = (sparkPoints(cavern)!.material as ShaderMaterial).uniforms;
    expect(u.uTime.value).toBeCloseTo(100);
    expect(u.uTimeAbs.value).toBeCloseTo(700);
    expect(u.uScale.value).toBe(1.5);
  });

  it('hides the sparks when CAVERN.sparks is off, including after a rebuild', () => {
    const cavern = new ForgeCavern();
    cavern.mount(BOUNDS);
    cavern.setDetail('high', 400);
    try {
      cavern.tune({ sparks: false });
      expect(sparkPoints(cavern)!.visible).toBe(false);
      cavern.setDetail('high', 300);
      expect(sparkPoints(cavern)!.visible).toBe(false);
      cavern.tune({ sparks: true });
      expect(sparkPoints(cavern)!.visible).toBe(true);
    } finally {
      CAVERN.sparks = true;
    }
  });
});
