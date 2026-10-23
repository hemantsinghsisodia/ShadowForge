import { describe, expect, it } from 'vitest';
import { initialAppliedQuality, nextTier, profileFor } from '../src/settings/Settings';

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
    expect(profile.msaa).toBe(4);
    expect(profile.cavern).toBe('high');
  });

  it('starts AUTO on MEDIUM for phones and HIGH for desktops', () => {
    expect(initialAppliedQuality('auto', true)).toBe('medium');
    expect(initialAppliedQuality('auto', false)).toBe('high');
  });

  it('tunes bloom per tier', () => {
    const m = profileFor('medium', false), h = profileFor('high', false);
    expect([m.bloomStrength, m.bloomRadius, m.bloomThreshold]).toEqual([0.4, 0.35, 1.2]);
    expect([h.bloomStrength, h.bloomRadius, h.bloomThreshold]).toEqual([0.5, 0.4, 1.2]);
    expect(h.chromatic).toBe(0.0012);
    expect(m.chromatic).toBe(0);
    expect(profileFor('low', true).exposure).toBe(1.05);
  });

  it('keeps LOW free of the expensive effects', () => {
    const profile = profileFor('low', true);
    expect(profile.bloom).toBe(false);
    expect(profile.envMap).toBe(false);
    expect(profile.beams).toBe(false);
    expect(profile.postFx).toBe(false);
    expect(profile.dust).toBe(0);
    expect(profile.dressingDetail).toBe('low');
    expect(profile.cavern).toBe('low');
  });

  it('low has no embers', () => expect(profileFor('low', false).embers).toBe(0));
  it('medium phone embers ≤ 150', () => expect(profileFor('medium', true).embers).toBeLessThanOrEqual(150));
  it('high embers 400', () => expect(profileFor('high', false).embers).toBe(400));

  it('uses half-resolution bloom for phones on MEDIUM', () => {
    expect(profileFor('medium', true).bloomScale).toBe(0.5);
    expect(profileFor('medium', false).bloomScale).toBe(1);
    expect(profileFor('medium', true).bloom).toBe(true);
    expect(profileFor('medium', false).cavern).toBe('medium');
  });
});

describe('forge light gate', () => {
  it('is on for high and desktop medium, off for low and phone medium', () => {
    expect(profileFor('high', false).forgeLight).toBe(true);
    expect(profileFor('high', true).forgeLight).toBe(true);
    expect(profileFor('medium', false).forgeLight).toBe(true);
    expect(profileFor('medium', true).forgeLight).toBe(false);
    expect(profileFor('low', false).forgeLight).toBe(false);
    expect(profileFor('low', true).forgeLight).toBe(false);
  });
});

describe('lamp shadows gate', () => {
  it('is on for high only, coarse or fine', () => {
    expect(profileFor('high', false).lampShadows).toBe(true);
    expect(profileFor('high', true).lampShadows).toBe(true);
    expect(profileFor('medium', false).lampShadows).toBe(false);
    expect(profileFor('medium', true).lampShadows).toBe(false);
    expect(profileFor('low', false).lampShadows).toBe(false);
    expect(profileFor('low', true).lampShadows).toBe(false);
  });
});

describe('nextTier', () => {
  it('drops a tier when the newest window is under 42 fps', () =>
    expect(nextTier([40], 'high', 'auto', false)).toBe('medium'));
  it('steps up after three windows at 57+ fps', () =>
    expect(nextTier([58, 60, 59], 'medium', 'auto', false)).toBe('high'));
  it('needs three good windows in a row', () =>
    expect(nextTier([58, 50, 59], 'medium', 'auto', false)).toBeNull());
  it('never steps up after a drop this session', () =>
    expect(nextTier([60, 60, 60], 'medium', 'auto', true)).toBeNull());
  it('does nothing in manual mode', () =>
    expect(nextTier([10], 'high', 'high', false)).toBeNull());
  it('stays put at the ends', () => {
    expect(nextTier([10], 'low', 'auto', false)).toBeNull();
    expect(nextTier([60, 60, 60], 'high', 'auto', false)).toBeNull();
  });
});
