import { describe, expect, it } from 'vitest';
import { FORGE_FRAG } from '../src/shadows/ForgeSurface';
import { OBSIDIAN_FRAG } from '../src/effects/Obsidian';
import { BEAM_FRAG } from '../src/effects/LightBeams';
import { EMBER_FRAG, EMBER_VERT } from '../src/effects/Embers';
import { PARTICLE_FRAG } from '../src/effects/ParticleManager';
import { DOME_FRAG, MOLTEN_FRAG, ROCK_FRAG, ROCK_VERT } from '../src/world/CavernShaders';

const SHADERS: Array<[string, string]> = [
  ['FORGE_FRAG', FORGE_FRAG],
  ['OBSIDIAN_FRAG', OBSIDIAN_FRAG],
  ['BEAM_FRAG', BEAM_FRAG],
  ['DOME_FRAG', DOME_FRAG],
  ['MOLTEN_FRAG', MOLTEN_FRAG],
  ['ROCK_FRAG', ROCK_FRAG],
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

describe('rock wall shader', () => {
  it('drops the dome rock banding', () => {
    expect(DOME_FRAG).not.toContain('ROCK');
  });

  it('is unlit, glows near the abyss and fades to haze with the abyss distance fade', () => {
    expect(ROCK_FRAG).toContain('exp(-(vWorld.y + 9.0) * 0.16)');
    expect(ROCK_FRAG).toContain('mix(0.3, 1.5, smoothstep(0.25, 0.75, vRock))');
    expect(ROCK_FRAG).toContain('smoothstep(2.0, 18.0, vWorld.y)');
    expect(ROCK_FRAG).toContain('smoothstep(25.0, 70.0, distance(cameraPosition, vWorld))');
    expect(ROCK_FRAG).not.toMatch(/uTime/);
  });

  it('shades by the world normal so up-facing ledges catch the glow', () => {
    expect(ROCK_VERT).toContain('vNormal = normalize(mat3(modelMatrix) * normal)');
    expect(ROCK_FRAG).toContain('varying vec3 vNormal');
    expect(ROCK_FRAG).toContain('(0.6 + 0.8 * (0.5 + 0.5 * vNormal.y))');
    expect(ROCK_FRAG).toContain('(0.7 + 0.6 * vRock)');
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
