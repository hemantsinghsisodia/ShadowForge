import { describe, expect, it } from 'vitest';
import { LEVELS, getLevel } from '../src/levels';
import { LAMP_SHADOW, pickShadowLamp } from '../src/world/LampShadow';

describe('pickShadowLamp', () => {
  it('picks the spotlight on level 6', () => {
    const level = getLevel(6);
    const spot = level.lights.find((l) => l.type === 'spotlight');
    expect(spot).toBeDefined();
    expect(pickShadowLamp(level)).toBe(spot!.id);
  });

  it('returns an existing lamp id on every level, or null when there are no lamps', () => {
    for (const level of LEVELS) {
      const id = pickShadowLamp(level);
      if (level.lights.length === 0) expect(id).toBeNull();
      else expect(level.lights.map((l) => l.id)).toContain(id);
    }
  });

  it('is deterministic', () => {
    for (const level of LEVELS) expect(pickShadowLamp(level)).toBe(pickShadowLamp(level));
  });

  it('picks the lamp nearest the first surface on XZ, ties to the earlier lamp', () => {
    const base = getLevel(1);
    const origin = base.surfaces[0].origin;
    const lamp = (id: string, dx: number, dy: number) => ({
      ...base.lights[0],
      id,
      type: 'fixed' as const,
      position: [origin[0] + dx, origin[1] + dy, origin[2]] as [number, number, number],
    });
    const config = { ...base, lights: [lamp('far', 5, 0), lamp('near', 1, 30), lamp('tie', -1, 0)] };
    expect(pickShadowLamp(config)).toBe('near');
    expect(pickShadowLamp({ ...base, lights: [] })).toBeNull();
  });

  it('exposes the shadow settings', () => {
    expect(LAMP_SHADOW).toEqual({ mapSize: 512, bias: -0.0005, normalBias: 0.02, radius: 2 });
  });
});
