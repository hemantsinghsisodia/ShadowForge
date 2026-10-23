import { describe, expect, it } from 'vitest';
import { floorHeights, heightToNormal, metalHeights, stoneHeights } from '../src/world/NormalMaps';

const SIZE = 32;

describe('heightToNormal', () => {
  it('encodes a flat field as (128, 128, 255, 255)', () => {
    const out = heightToNormal(new Float32Array(SIZE * SIZE).fill(0.5), SIZE, SIZE, 2);
    expect(out.length).toBe(SIZE * SIZE * 4);
    for (let i = 0; i < out.length; i += 4) {
      expect([out[i], out[i + 1], out[i + 2], out[i + 3]]).toEqual([128, 128, 255, 255]);
    }
  });

  it('tilts R away from 128 on an x-ramp and leaves G at 128', () => {
    const heights = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) heights[y * SIZE + x] = x / SIZE;
    const out = heightToNormal(heights, SIZE, SIZE, 2);
    const i = (8 * SIZE + 10) * 4;
    expect(out[i]).toBeLessThan(120);
    expect(out[i + 1]).toBe(128);
  });

  it('wraps at the edges: shifting the field by one column circularly shifts the normals identically', () => {
    const heights = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < heights.length; i++) heights[i] = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const shifted = new Float32Array(heights.length);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) shifted[y * SIZE + ((x + 1) % SIZE)] = heights[y * SIZE + x];
    }
    const a = heightToNormal(heights, SIZE, SIZE, 2);
    const b = heightToNormal(shifted, SIZE, SIZE, 2);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const from = (y * SIZE + x) * 4;
        const to = (y * SIZE + ((x + 1) % SIZE)) * 4;
        expect([b[to], b[to + 1], b[to + 2]]).toEqual([a[from], a[from + 1], a[from + 2]]);
      }
    }
  });

  it('gives a flat map for strength 0', () => {
    const heights = floorHeights(SIZE, 3);
    const out = heightToNormal(heights, SIZE, SIZE, 0);
    for (let i = 0; i < out.length; i += 4) expect([out[i], out[i + 1], out[i + 2]]).toEqual([128, 128, 255]);
  });
});

describe.each([
  ['floor', floorHeights],
  ['metal', metalHeights],
  ['stone', stoneHeights],
] as const)('%s heights', (_name, generate) => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(Array.from(generate(64, 7))).toEqual(Array.from(generate(64, 7)));
    expect(Array.from(generate(64, 7))).not.toEqual(Array.from(generate(64, 8)));
  });

  it('stays in [0, 1] and is not flat', () => {
    const h = generate(64, 11);
    expect(h.length).toBe(64 * 64);
    let min = 1;
    let max = 0;
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(0.05);
  });

  it('tiles: the step across the wrap seam is no larger than the largest interior step, on both axes', () => {
    const size = 64;
    const h = generate(size, 5);
    const stepMean = (axis: 'x' | 'y', from: number) => {
      const to = (from + 1) % size;
      let sum = 0;
      for (let k = 0; k < size; k++) {
        sum += axis === 'x' ? Math.abs(h[k * size + to] - h[k * size + from]) : Math.abs(h[to * size + k] - h[from * size + k]);
      }
      return sum / size;
    };
    for (const axis of ['x', 'y'] as const) {
      let interiorMax = 0;
      for (let i = 0; i < size - 1; i++) interiorMax = Math.max(interiorMax, stepMean(axis, i));
      expect(stepMean(axis, size - 1)).toBeLessThanOrEqual(interiorMax * 1.25 + 1e-6);
    }
  });
});
