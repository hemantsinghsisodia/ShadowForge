import { describe, expect, it } from 'vitest';
import { FORGE_FRAG, FORGE_VERT } from '../src/shadows/ForgeSurface';
import { OBSIDIAN_FRAG, OBSIDIAN_VERT, createObsidianMaterial } from '../src/effects/Obsidian';
import { BEAM_FRAG } from '../src/effects/LightBeams';
import { EMBER_FRAG, EMBER_VERT } from '../src/effects/Embers';
import { SPARK_FRAG, SPARK_VERT } from '../src/effects/Sparks';
import { PARTICLE_FRAG } from '../src/effects/ParticleManager';
import { DOME_FRAG, MOLTEN_FRAG, ROCK_FRAG, ROCK_VERT } from '../src/world/CavernShaders';

const SHADERS: Array<[string, string]> = [
  ['FORGE_FRAG', FORGE_FRAG],
  ['OBSIDIAN_FRAG', OBSIDIAN_FRAG],
  ['BEAM_FRAG', BEAM_FRAG],
  ['DOME_FRAG', DOME_FRAG],
  ['MOLTEN_FRAG', MOLTEN_FRAG],
  ['ROCK_FRAG', ROCK_FRAG],
  ['SPARK_FRAG', SPARK_FRAG],
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

  it('obsidian leading edge and collapse heat are boosted', () => {
    expect(OBSIDIAN_FRAG).toContain('smoothstep(0.75, 1.0, vK) * (1.0 - rise) * 3.0 + hot * 2.5');
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

describe('FORGE_FRAG charge', () => {
  it('declares the charge uniform and applies the brightness and scan-speed terms', () => {
    expect(FORGE_FRAG).toContain('uniform float charge');
    expect(FORGE_FRAG).toContain('(1.0 + 1.5 * charge)');
    expect(FORGE_FRAG).toContain('uniform float scan');
    expect(FORGE_FRAG).toContain('sin(cell.y * 3.1 - scan)');
  });
});

describe('beam shimmer shader', () => {
  it('drifts a value noise along the cone and scales alpha by the shimmer', () => {
    expect(BEAM_FRAG).toContain('uniform float time;');
    expect(BEAM_FRAG).toContain('strength * 0.34');
    expect(BEAM_FRAG).toContain('mix(0.75, 1.15,');
    expect(BEAM_FRAG).not.toContain('0.28');
  });
});

describe.each([
  ['OBSIDIAN', OBSIDIAN_VERT, OBSIDIAN_FRAG],
  ['FORGE', FORGE_VERT, FORGE_FRAG],
])('%s fog', (_name, vert, frag) => {
  it('includes the four fog chunks', () => {
    expect(vert).toContain('#include <fog_pars_vertex>');
    expect(vert).toContain('#include <fog_vertex>');
    expect(frag).toContain('#include <fog_pars_fragment>');
    expect(frag).toContain('#include <fog_fragment>');
  });

  it('computes mvPosition before fog_vertex', () => {
    expect(vert.indexOf('vec4 mvPosition')).toBeGreaterThan(-1);
    expect(vert.indexOf('#include <fog_vertex>')).toBeGreaterThan(vert.indexOf('vec4 mvPosition'));
    expect(vert.indexOf('#include <fog_pars_vertex>')).toBeLessThan(vert.indexOf('void main'));
  });

  it('fogs after gl_FragColor and before tonemapping', () => {
    const fog = frag.indexOf('#include <fog_fragment>');
    expect(fog).toBeGreaterThan(frag.lastIndexOf('gl_FragColor'));
    expect(fog).toBeLessThan(frag.indexOf('#include <tonemapping_fragment>'));
    expect(frag.indexOf('#include <fog_pars_fragment>')).toBeLessThan(frag.indexOf('void main'));
  });
});

describe('fog on the material', () => {
  it('obsidian takes fog and carries the fog uniforms', () => {
    const material = createObsidianMaterial(1);
    expect(material.fog).toBe(true);
    for (const key of ['fogColor', 'fogDensity', 'fogNear', 'fogFar']) expect(material.uniforms[key]).toBeDefined();
    expect(material.uniforms.rise.value).toBe(1);
  });
});

describe('smoothstep edges', () => {
  it('never reverses numeric-literal edges in any shader', () => {
    const call = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
    const all = [...SHADERS, ['OBSIDIAN_VERT', OBSIDIAN_VERT], ['EMBER_VERT', EMBER_VERT], ['EMBER_FRAG', EMBER_FRAG], ['SPARK_VERT', SPARK_VERT], ['PARTICLE_FRAG', PARTICLE_FRAG]];
    for (const [, frag] of all) {
      for (const m of frag.matchAll(call)) expect(Number(m[1])).toBeLessThan(Number(m[2]));
    }
  });
});
