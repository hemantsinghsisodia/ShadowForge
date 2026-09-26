import { describe, expect, it } from 'vitest';
import { initialAppliedQuality, profileFor } from '../src/settings/Settings';

describe('quality profiles', () => {
  it('gives a phone on HIGH every effect, including bloom', () => {
    const profile = profileFor('high', true);
    expect(profile.bloom).toBe(true);
    expect(profile.bloomScale).toBe(1);
    expect(profile.envMap).toBe(true);
    expect(profile.beams).toBe(true);
    expect(profile.dust).toBeGreaterThan(0);
    expect(profile.postFx).toBe(true);
    expect(profile.playerLight).toBe(true);
    expect(profile.dressingDetail).toBe('high');
    expect(profile.dprCap).toBe(1.5);
  });

  it('starts AUTO on HIGH for phones and desktops', () => {
    expect(initialAppliedQuality('auto', true)).toBe('high');
    expect(initialAppliedQuality('auto', false)).toBe('high');
  });

  it('keeps LOW free of the expensive effects', () => {
    const profile = profileFor('low', true);
    expect(profile.bloom).toBe(false);
    expect(profile.envMap).toBe(false);
    expect(profile.beams).toBe(false);
    expect(profile.postFx).toBe(false);
    expect(profile.dust).toBe(0);
    expect(profile.dressingDetail).toBe('low');
  });

  it('uses half-resolution bloom for phones on MEDIUM', () => {
    expect(profileFor('medium', true).bloomScale).toBe(0.5);
    expect(profileFor('medium', false).bloomScale).toBe(1);
    expect(profileFor('medium', true).bloom).toBe(true);
  });
});
