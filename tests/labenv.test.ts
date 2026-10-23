import { describe, expect, it } from 'vitest';
import { ENV_INTENSITY, LAB_ENV_PANELS, buildLabEnvScene, hemiIntensity } from '../src/world/LabEnvironment';

describe('lab environment', () => {
  it('balances fill light against the env map', () => {
    expect(hemiIntensity(true)).toBe(0.9);
    expect(hemiIntensity(false)).toBe(1.6);
    expect(ENV_INTENSITY).toBe(0.65);
  });

  it('has cool side strips and one warm key matching the sun', () => {
    expect(LAB_ENV_PANELS.filter((p) => p.color === 0x9fdcff)).toHaveLength(4);
    const key = LAB_ENV_PANELS.filter((p) => p.color === 0xffc890);
    expect(key).toHaveLength(1);
    expect(key[0].position[0]).toBeLessThan(0);
    expect(key[0].position[1]).toBeGreaterThan(0);
  });

  it('builds a scene without a renderer', () => {
    expect(buildLabEnvScene().children.length).toBeGreaterThanOrEqual(6);
  });
});
