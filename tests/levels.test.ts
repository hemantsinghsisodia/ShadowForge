import { describe, expect, it } from 'vitest';
import { CharacterBody } from '../src/physics/CharacterBody';
import { maskToBoxes } from '../src/shadows/math';
import { LEVELS } from '../src/levels';
import {
  casterBoxes,
  describeMasks,
  findCoveringStates,
  manipulables,
  masksFor,
  missingRequired,
  reachedSurfaces,
  solutionStates,
  stateMap,
  staticBoxes,
} from '../src/levels/evaluate';
import type { LevelConfig } from '../src/levels/LevelData';
import type { SolidBox } from '../src/shadows/types';

function same(level: LevelConfig, a: Record<string, number>, b: Record<string, number>): boolean {
  return manipulables(level).every((knob) => (a[knob.id] ?? knob.initial) === (b[knob.id] ?? knob.initial));
}

describe('level solvability', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} ${level.name} has one covering solution`, () => {
      const solved = solutionStates(level);
      const missing = missingRequired(level, solved);
      expect(missing, `${missing.slice(0, 18).join(' ')}\n${describeMasks(level, solved)}`).toEqual([]);

      const changed = manipulables(level).some((knob) => (level.solution[knob.id] ?? knob.initial) !== knob.initial);
      if (changed) {
        expect(missingRequired(level, stateMap(level, false)).length).toBeGreaterThan(0);
      }

      const { hits, best } = findCoveringStates(level);
      expect(
        hits.length,
        `hits ${hits.map((hit) => JSON.stringify(hit.states)).join(' | ')}\nbest missing ${best.missing}\n${describeMasks(level, best.states)}`,
      ).toBe(1);
      expect(same(level, hits[0].states, solved)).toBe(true);
    });
  }

  it('level 10 lights do not reach another zone', () => {
    const level = LEVELS[9];
    const reach = reachedSurfaces(level, solutionStates(level));
    for (const light of level.lights) {
      const surfaces = reach[light.id] ?? [];
      for (const surfaceId of surfaces) {
        const surface = level.surfaces.find((entry) => entry.id === surfaceId);
        expect(surface?.zone, `${light.id} reaches ${surfaceId}`).toBe(light.zone);
      }
    }
  });
});

describe('level 1 bridge', () => {
  const level = LEVELS[0];

  function boxes(forged: boolean): SolidBox[] {
    const list = [...staticBoxes(level), ...casterBoxes(level, stateMap(level, true))];
    if (!forged) return list;
    const masks = masksFor(level, solutionStates(level));
    for (const found of masks.values()) list.push(...maskToBoxes(found.def, found.mask));
    return list;
  }

  function run(forged: boolean) {
    const body = new CharacterBody();
    body.x = level.playerStart.position[0];
    body.y = 0.2;
    body.z = level.playerStart.position[2];
    const world = boxes(forged);
    for (let i = 0; i < 460; i++) {
      let wishX = 1;
      let wishZ = 0;
      if (body.x < -4.05) wishZ = body.z < 1.7 ? 1 : 0;
      else if (Math.abs(body.z) > 0.15) {
        wishX = 0.35;
        wishZ = body.z > 0 ? -1 : 1;
      }
      body.step(1 / 60, wishX, wishZ, false, world);
      if (body.y < -2) break;
    }
    return body;
  }

  it('drops into the gap before the shadow is forged', () => {
    const body = run(false);
    expect(body.y).toBeLessThan(-1);
  });

  it('can be walked after the shadow is forged', () => {
    const body = run(true);
    expect(body.y).toBeGreaterThan(-0.5);
    expect(body.x).toBeGreaterThan(4);
  });
});
