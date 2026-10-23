import { Color, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { setKitScale } from '../src/world/EnvKit';
import { LIGHTING, hemiIntensity } from '../src/world/Lighting';

describe('lighting config', () => {
  it('has the moody starting values', () => {
    expect(LIGHTING.sun).toBe(0.55);
    expect(LIGHTING.sunColor).toBe(0xc8d6ee);
    expect(LIGHTING.hemiEnv).toBe(0.15);
    expect(LIGHTING.hemiNoEnv).toBe(0.4);
    expect(LIGHTING.env).toBe(0.25);
    expect(LIGHTING.floorTint).toBe(0x4d5664);
    expect(LIGHTING.wallTint).toBe(0x434b58);
    expect(LIGHTING.kitScale).toBe(0.28);
  });

  it('picks the hemisphere fill by env map availability', () => {
    expect(hemiIntensity(true)).toBe(LIGHTING.hemiEnv);
    expect(hemiIntensity(false)).toBe(LIGHTING.hemiNoEnv);
  });

  it('keeps LIGHTING mutable for live tuning', () => {
    expect(Object.isFrozen(LIGHTING)).toBe(false);
  });
});

describe('setKitScale', () => {
  it('scales the colour from the stored base colour', () => {
    const base = new Color(0xc0a080);
    const material = new MeshStandardMaterial();
    material.userData.baseColor = base.getHex();
    setKitScale([material], 0.5);
    expect(material.color.r).toBeCloseTo(base.r * 0.5, 5);
    expect(material.color.g).toBeCloseTo(base.g * 0.5, 5);
    expect(material.color.b).toBeCloseTo(base.b * 0.5, 5);
    setKitScale([material], 1);
    expect(material.color.getHex()).toBe(base.getHex());
  });

  it('survives Material.clone, which JSON-copies userData', () => {
    const base = new Color(0x80c0ff);
    const material = new MeshStandardMaterial();
    material.userData.baseColor = base.getHex();
    const clone = material.clone();
    setKitScale([clone], 0.5);
    expect(clone.color.r).toBeCloseTo(base.r * 0.5, 5);
  });

  it('ignores materials without a base colour', () => {
    const material = new MeshStandardMaterial({ color: 0x336699 });
    setKitScale([material], 0.1);
    expect(material.color.getHex()).toBe(0x336699);
  });
});
