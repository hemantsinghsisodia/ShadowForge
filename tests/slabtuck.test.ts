import { describe, expect, it } from 'vitest';
import { tuckUnderTile } from '../src/world/LabDressing';

describe('tuckUnderTile', () => {
  it('shrinks a slab by 0.01 and drops it 0.005 so its top sits under the kit tile', () => {
    expect(tuckUnderTile(0.5)).toEqual({ scaleY: 0.98, offsetY: -0.005 });
  });

  it('keeps the slab bottom in place', () => {
    const h = 1.6;
    const { scaleY, offsetY } = tuckUnderTile(h);
    expect(offsetY - (h * scaleY) / 2).toBeCloseTo(-h / 2, 10);
    expect(offsetY + (h * scaleY) / 2).toBeCloseTo(h / 2 - 0.01, 10);
  });
});
