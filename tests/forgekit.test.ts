import { Color, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { setKitScale } from '../src/world/EnvKit';
import { FORGE_KIT, forgeKit, forgeRetint } from '../src/world/ForgeKit';
import { FORGE } from '../src/world/ForgePalette';

const named = (name: string) => new MeshStandardMaterial({ name, emissive: 0x3fd8ff, emissiveIntensity: 1 });

describe('forgeRetint', () => {
  it('turns the cyan emission molten', () => {
    const m = named('SHF_MAT_CyanEmission');
    forgeRetint(m);
    expect(m.emissive.getHex()).toBe(FORGE.glow);
  });

  it('keeps the cyan strips at 1.6, deliberately below the bloom knee', () => {
    const m = named('SHF_MAT_CyanEmission');
    forgeRetint(m);
    expect(m.emissiveIntensity).toBe(1.6);
  });

  it('turns the white emission warm at 3.2 so the lamp heads bloom', () => {
    const m = named('SHF_MAT_WhiteEmission');
    forgeRetint(m);
    expect(m.emissive.getHex()).toBe(0xffc890);
    expect(m.emissiveIntensity).toBe(3.2);
  });

  it('also matches the unprefixed material names', () => {
    const cyan = named('CyanEmission');
    const white = named('WhiteEmission');
    forgeRetint(cyan);
    forgeRetint(white);
    expect(cyan.emissive.getHex()).toBe(FORGE.glow);
    expect(white.emissive.getHex()).toBe(0xffc890);
  });

  it('leaves other materials unchanged', () => {
    for (const name of ['SHF_MAT_WarningAmber', 'SHF_MAT_Steel', 'Other', '']) {
      const m = named(name);
      forgeRetint(m);
      expect(m.emissive.getHex()).toBe(0x3fd8ff);
      expect(m.emissiveIntensity).toBe(1);
    }
  });

  it('keeps setKitScale working from baseColor', () => {
    const m = named('SHF_MAT_CyanEmission');
    m.userData.baseColor = 0x808080;
    forgeRetint(m);
    setKitScale([m], 0.5);
    expect(m.color.getHex()).toBe(new Color(0x808080).multiplyScalar(0.5).getHex());
    expect(m.emissive.getHex()).toBe(FORGE.glow);
  });
});

describe('FORGE_KIT', () => {
  it('names the five structure pieces', () => {
    expect(Object.values(FORGE_KIT).sort()).toEqual(
      ['SHF_Floor_Edge', 'SHF_Lamp_Industrial', 'SHF_Pillar_A', 'SHF_Structure_Beam', 'SHF_Structure_CableTray'].sort(),
    );
  });

  it('is not loaded until requested', () => {
    expect(forgeKit()).toBeNull();
  });
});
