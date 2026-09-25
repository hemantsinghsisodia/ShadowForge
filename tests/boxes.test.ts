import { describe, expect, it } from 'vitest';
import { greedyRects, maskToBoxes } from '../src/shadows/math';
import type { SurfaceDef } from '../src/shadows/types';

const floor: SurfaceDef = {
  id: 'floor',
  origin: { x: 0, y: 0, z: 0 },
  axisU: { x: 1, y: 0, z: 0 },
  axisV: { x: 0, y: 0, z: 1 },
  sizeU: 2,
  sizeV: 2,
  cell: 0.5,
  cols: 4,
  rows: 4,
  kind: 'floor',
  rise: 0,
  unstable: false,
  decayTime: 10,
};

describe('greedy boxes', () => {
  it('merges a solid rectangle into one box', () => {
    const mask = new Uint8Array(16).fill(1);
    expect(greedyRects(mask, 4, 4)).toEqual([{ c: 0, r: 0, w: 4, h: 4 }]);
    const boxes = maskToBoxes(floor, mask);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].maxY).toBeCloseTo(0);
    expect(boxes[0].minX).toBeCloseTo(-1);
    expect(boxes[0].maxX).toBeCloseTo(1);
  });

  it('keeps two islands apart', () => {
    const mask = new Uint8Array(16);
    mask[0] = 1;
    mask[15] = 1;
    expect(greedyRects(mask, 4, 4)).toHaveLength(2);
  });

  it('builds a climbable wall extrusion', () => {
    const wall: SurfaceDef = {
      ...floor,
      kind: 'wall',
      origin: { x: 0, y: 1, z: 0 },
      axisU: { x: 0, y: 0, z: 1 },
      axisV: { x: 0, y: 1, z: 0 },
      sizeU: 2,
      sizeV: 2,
    };
    const mask = new Uint8Array(16).fill(1);
    const boxes = maskToBoxes(wall, mask);
    expect(boxes[0].climbable).toBe(true);
    expect(boxes[0].nx).toBeCloseTo(-1);
    expect(boxes[0].minX).toBeLessThan(0);
  });
});
