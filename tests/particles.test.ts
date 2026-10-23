import { describe, expect, it } from 'vitest';
import { PARTICLE_VERT, PARTICLE_FRAG, KIND_INTENSITY, DUST_INTENSITY } from '../src/effects/ParticleManager';

describe('particle shaders', () => {
  it('declares its own colour attribute instead of the built-in one', () => {
    expect(PARTICLE_VERT).toMatch(/attribute vec3 aColor;/);
    expect(PARTICLE_VERT).not.toMatch(/=\s*color\s*;/);
  });

  it('caps point size and scales by pixel ratio', () => {
    expect(PARTICLE_VERT).toMatch(/uniform float uScale;/);
    expect(PARTICLE_VERT).toMatch(/min\(64\.0,/);
  });

  it('tone-maps so the Low tier matches composer tiers', () => {
    expect(PARTICLE_FRAG).toMatch(/#include <tonemapping_fragment>/);
    expect(PARTICLE_FRAG).toMatch(/#include <colorspace_fragment>/);
  });

  it('pushes burst kinds above the bloom threshold and keeps dust below', () => {
    expect(KIND_INTENSITY).toEqual({ spark: 3.0, shard: 2.5, ember: 2.0 });
    expect(DUST_INTENSITY).toBe(0.6);
  });
});
