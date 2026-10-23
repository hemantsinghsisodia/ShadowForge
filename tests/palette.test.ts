import { Color, SRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { CAVERN, FORGE, cavernFog, levelAtmosphere, mixSrgb, moltenPulse } from '../src/world/ForgePalette';

describe('forge palette', () => {
  it('keeps background and fog independent of the level accent', () => {
    const first = levelAtmosphere(1);
    for (let id = 1; id <= 10; id += 1) {
      const a = levelAtmosphere(id);
      expect(a.background).toBe(first.background);
      expect(a.fog).toBe(first.fog);
    }
  });

  it('thins the fog on the late levels', () => {
    expect(levelAtmosphere(1).density).toBeCloseTo(0.024, 6);
    expect(levelAtmosphere(8).density).toBeCloseTo(0.0144, 6);
  });

  it('has a dark warm haze, never teal', () => {
    const c = { r: 0, g: 0, b: 0 };
    new Color(FORGE.haze).getRGB(c, SRGBColorSpace);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.g).toBeGreaterThan(c.b);
    expect(c.r).toBeLessThan(0.25);
    expect(cavernFog().getHex()).toBe(FORGE.haze);
    expect(CAVERN.fogDensity).toBe(0.024);
  });

  it('mixes in sRGB space', () => {
    const hex = mixSrgb(0x000000, 0xffffff, 0.5).getHex();
    for (const shift of [16, 8, 0]) expect(Math.abs(((hex >> shift) & 255) - 0x80)).toBeLessThanOrEqual(1);
  });

  it('pulses smoothly inside [0.7, 1.0]', () => {
    let prev = moltenPulse(0);
    for (let t = 0; t <= 120; t += 0.01) {
      const v = moltenPulse(t);
      expect(v).toBeGreaterThanOrEqual(0.7);
      expect(v).toBeLessThanOrEqual(1.0);
      expect(Math.abs(v - prev)).toBeLessThan(0.01);
      prev = v;
    }
  });
});
