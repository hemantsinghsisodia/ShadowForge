import { describe, expect, it } from 'vitest';
import { CharacterBody } from '../src/physics/CharacterBody';
import type { SolidBox } from '../src/shadows/types';

const floor: SolidBox = {
  minX: -6, maxX: 6, minY: -0.5, maxY: 0, minZ: -6, maxZ: 6,
  climbable: false, nx: 0, ny: 1, nz: 0,
};

function settle(body: CharacterBody, boxes: SolidBox[]) {
  for (let i = 0; i < 40; i++) body.step(1 / 60, 0, 0, false, boxes);
}

describe('character body', () => {
  it('lands on a floor and stays there', () => {
    const body = new CharacterBody();
    body.y = 1;
    settle(body, [floor]);
    expect(body.grounded).toBe(true);
    expect(body.y).toBeCloseTo(0, 1);
  });

  it('is stopped by a tall wall', () => {
    const wall: SolidBox = {
      minX: 1, maxX: 1.5, minY: 0, maxY: 3, minZ: -2, maxZ: 2,
      climbable: false, nx: 0, ny: 1, nz: 0,
    };
    const body = new CharacterBody();
    settle(body, [floor, wall]);
    for (let i = 0; i < 120; i++) body.step(1 / 60, 1, 0, false, [floor, wall]);
    expect(body.x).toBeLessThan(1);
    expect(body.y).toBeGreaterThan(-0.2);
  });

  it('steps up a low lip', () => {
    const lip: SolidBox = {
      minX: 0.8, maxX: 4, minY: -0.5, maxY: 0.3, minZ: -2, maxZ: 2,
      climbable: false, nx: 0, ny: 1, nz: 0,
    };
    const body = new CharacterBody();
    settle(body, [floor, lip]);
    let climbed = false;
    for (let i = 0; i < 45; i++) {
      body.step(1 / 60, 1, 0, false, [floor, lip]);
      if (body.x > 1.5 && body.y > 0.2) climbed = true;
    }
    expect(climbed).toBe(true);
  });

  it('jumps', () => {
    const body = new CharacterBody();
    settle(body, [floor]);
    body.step(1 / 60, 0, 0, true, [floor]);
    for (let i = 0; i < 12; i++) body.step(1 / 60, 0, 0, false, [floor]);
    expect(body.y).toBeGreaterThan(0.45);
    expect(body.grounded).toBe(false);
  });

  it('climbs a shadow wall onto the ledge', () => {
    const ground: SolidBox = {
      minX: -4, maxX: 1.05, minY: -0.5, maxY: 0, minZ: -3, maxZ: 3,
      climbable: false, nx: 0, ny: 1, nz: 0,
    };
    const climb: SolidBox = {
      minX: 1, maxX: 1.5, minY: 0, maxY: 2.5, minZ: -1, maxZ: 1,
      climbable: true, nx: -1, ny: 0, nz: 0,
    };
    const ledge: SolidBox = {
      minX: 1.35, maxX: 6, minY: 2.05, maxY: 2.5, minZ: -2, maxZ: 2,
      climbable: false, nx: 0, ny: 1, nz: 0,
    };
    const body = new CharacterBody();
    const boxes = [ground, climb, ledge];
    settle(body, boxes);
    let reached = false;
    for (let i = 0; i < 100; i++) {
      body.step(1 / 60, 1, 0, false, boxes);
      if (body.y > 2.2 && body.x > 1.5 && body.x < 5) reached = true;
    }
    expect(reached).toBe(true);
  });
});
