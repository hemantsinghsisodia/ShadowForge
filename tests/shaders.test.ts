import { describe, expect, it } from 'vitest';
import { FORGE_FRAG } from '../src/shadows/ForgeSurface';
import { OBSIDIAN_FRAG } from '../src/effects/Obsidian';
import { BEAM_FRAG } from '../src/effects/LightBeams';

const SHADERS: Array<[string, string]> = [
  ['FORGE_FRAG', FORGE_FRAG],
  ['OBSIDIAN_FRAG', OBSIDIAN_FRAG],
  ['BEAM_FRAG', BEAM_FRAG],
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
