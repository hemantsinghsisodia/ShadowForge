import { describe, expect, it } from 'vitest';
import { FORGE_FRAG } from '../src/shadows/ForgeSurface';
import { OBSIDIAN_FRAG } from '../src/effects/Obsidian';
import { BEAM_FRAG } from '../src/effects/LightBeams';
import { EMBER_FRAG, EMBER_VERT } from '../src/effects/Embers';
import { PARTICLE_FRAG } from '../src/effects/ParticleManager';
import { DOME_FRAG, MOLTEN_FRAG } from '../src/world/CavernShaders';

const SHADERS: Array<[string, string]> = [
  ['FORGE_FRAG', FORGE_FRAG],
  ['OBSIDIAN_FRAG', OBSIDIAN_FRAG],
  ['BEAM_FRAG', BEAM_FRAG],
  ['DOME_FRAG', DOME_FRAG],
  ['MOLTEN_FRAG', MOLTEN_FRAG],
];

describe.each(SHADERS)('%s', (_name, frag) => {
  it('tone-maps and converts colour space so the Low tier matches composer tiers', () => {
    expect(frag).toContain('#include <tonemapping_fragment>');
    expect(frag).toContain('#include <colorspace_fragment>');
  });

  it('places the includes after the final gl_FragColor assignment', () => {
    const last = frag.lastIndexOf('gl_FragColor');
    expect(last).toBeGreaterThan(-1);
    expect(frag.lastIndexOf('#include <tonemapping_fragment>')).toBeGreaterThan(last);
    expect(frag.lastIndexOf('#include <colorspace_fragment>')).toBeGreaterThan(last);
  });
});

describe('emissive shader strengths use the specified HDR boosts', () => {
  it('forge surface solid edge is boosted', () => {
    expect(FORGE_FRAG).toContain('sedge * 3.2');
  });

  it('obsidian rim is boosted', () => {
    expect(OBSIDIAN_FRAG).toContain('fres * 1.8');
  });
});

describe('molten abyss shader', () => {
  it('boosts the cracks into HDR', () => {
    expect(MOLTEN_FRAG).toContain('crack * uCrackHdr');
  });

  it('hashes without sin', () => {
    expect(MOLTEN_FRAG).toContain('.1031');
  });

  it('runs on its own long clock', () => {
    expect(MOLTEN_FRAG).toContain('uniform float uAbyssTime;');
    expect(MOLTEN_FRAG).toContain('uFlow * uAbyssTime');
    expect(MOLTEN_FRAG).not.toMatch(/uTime/);
    expect(DOME_FRAG).not.toMatch(/uTime/);
  });
});

describe('smoothstep edges', () => {
  it('never reverses numeric-literal edges in any shader', () => {
    const call = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
    const all = [...SHADERS, ['EMBER_VERT', EMBER_VERT], ['EMBER_FRAG', EMBER_FRAG], ['PARTICLE_FRAG', PARTICLE_FRAG]];
    for (const [, frag] of all) {
      for (const m of frag.matchAll(call)) expect(Number(m[1])).toBeLessThan(Number(m[2]));
    }
  });
});
