import { MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHTING } from '../src/world/Lighting';
import { labBaseColors, setLabEnv } from '../src/world/Materials';

describe('lab base colours', () => {
  it('uses LIGHTING floor and wall tints, not white', () => {
    const colors = labBaseColors();
    expect(colors.floor).toBe(LIGHTING.floorTint);
    expect(colors.wall).toBe(LIGHTING.wallTint);
    expect(colors.floor).not.toBe(0xffffff);
    expect(colors.wall).not.toBe(0xffffff);
  });
});

describe('lab material environment', () => {
  const make = () => [new MeshStandardMaterial(), new MeshStandardMaterial({ envMapIntensity: 3 })];

  it('applies LIGHTING.env to each material when a map is assigned', () => {
    const materials = make();
    const texture = new Texture();
    setLabEnv(materials, texture);
    for (const m of materials) {
      expect(m.envMap).toBe(texture);
      expect(m.envMapIntensity).toBe(LIGHTING.env);
    }
  });

  it('restores envMapIntensity 1 when the map is cleared', () => {
    const materials = make();
    setLabEnv(materials, new Texture());
    setLabEnv(materials, null);
    for (const m of materials) {
      expect(m.envMap).toBeNull();
      expect(m.envMapIntensity).toBe(1);
    }
  });
});
