import { describe, expect, it } from 'vitest';
import { LAB_ENV_PANELS, buildLabEnvScene } from '../src/world/LabEnvironment';
import { LIGHTING, hemiIntensity } from '../src/world/Lighting';

describe('lab environment', () => {
  it('balances fill light against the env map', () => {
    expect(hemiIntensity(true)).toBe(LIGHTING.hemiEnv);
    expect(hemiIntensity(false)).toBe(LIGHTING.hemiNoEnv);
    expect(LIGHTING.env).toBe(0.25);
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
