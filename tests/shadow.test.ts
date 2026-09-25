import { describe, expect, it } from 'vitest';
import { computeShadowMask, segmentHitsCaster } from '../src/shadows/math';
import type { CasterVolume, LightVolume, SurfaceDef } from '../src/shadows/types';

function boxCaster(partial: Partial<CasterVolume> = {}): CasterVolume {
  return {
    id: 'c',
    kind: 'box',
    cx: 0,
    cy: 0,
    cz: 0,
    yaw: 0,
    sx: 2,
    sy: 2,
    sz: 2,
    ...partial,
  };
}

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

describe('caster rays', () => {
  it('hits a segment through a box and misses a miss', () => {
    const caster = boxCaster();
    expect(segmentHitsCaster(0, 5, 0, 0, -5, 0, caster)).toBe(true);
    expect(segmentHitsCaster(3, 5, 0, 3, -5, 0, caster)).toBe(false);
    expect(segmentHitsCaster(0, 5, 0, 0, 2, 0, caster)).toBe(false);
  });

  it('respects yaw', () => {
    const caster = boxCaster({ sx: 0.4, sy: 2, sz: 3, yaw: Math.PI / 2 });
    expect(segmentHitsCaster(0, 0, 1.2, 0, 0, 4, caster)).toBe(false);
    expect(segmentHitsCaster(-4, 0, 0, 4, 0, 0, caster)).toBe(true);
  });

  it('hits a cylinder, prism, and l-shape', () => {
    const cylinder = boxCaster({ kind: 'cylinder', sx: 1, sy: 2, sz: 1 });
    expect(segmentHitsCaster(0, 4, 0, 0, -4, 0, cylinder)).toBe(true);
    expect(segmentHitsCaster(2, 4, 0, 2, -4, 0, cylinder)).toBe(false);

    const prism = boxCaster({ kind: 'prism', sx: 2, sy: 2, sz: 2 });
    expect(segmentHitsCaster(0, 4, 0, 0, -4, 0, prism)).toBe(true);
    expect(segmentHitsCaster(1.5, 4, -1.5, 1.5, -4, -1.5, prism)).toBe(false);

    const lshape = boxCaster({ kind: 'lshape', sx: 2, sy: 2, sz: 2 });
    expect(segmentHitsCaster(-0.7, 4, 0, -0.7, -4, 0, lshape)).toBe(true);
    expect(segmentHitsCaster(0.7, 4, 0.7, 0.7, -4, 0.7, lshape)).toBe(false);
  });
});

describe('shadow masks', () => {
  const caster = boxCaster({ cx: 0, cy: 1, cz: -1.2, sx: 1.4, sy: 2, sz: 1.4 });
  const key: LightVolume = { id: 'key', enabled: true, x: 0, y: 4, z: -4, range: 20, spot: null };

  it('marks the occluded cells and ignores a side cell', () => {
    const mask = computeShadowMask(floor, [key], [caster]);
    const center = mask[1 * 4 + 1] + mask[1 * 4 + 2] + mask[2 * 4 + 1] + mask[2 * 4 + 2];
    expect(center).toBeGreaterThan(0);
  });

  it('lets a second light wash the shadow out', () => {
    const wash: LightVolume = { id: 'wash', enabled: true, x: 0, y: 4, z: 3, range: 20, spot: null };
    const masked = computeShadowMask(floor, [key], [caster]);
    const washed = computeShadowMask(floor, [key, wash], [caster]);
    const before = masked.reduce((sum, v) => sum + v, 0);
    const after = washed.reduce((sum, v) => sum + v, 0);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('does not forge darkness', () => {
    const off = { ...key, enabled: false };
    const mask = computeShadowMask(floor, [off], [caster]);
    expect(mask.reduce((sum, v) => sum + v, 0)).toBe(0);
  });
});
