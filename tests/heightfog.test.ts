import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { installHeightFog } from '../src/world/HeightFog';

const names = ['fog_pars_vertex', 'fog_pars_fragment', 'fog_vertex', 'fog_fragment'] as const;
const snapshot = () => names.map((name) => ShaderChunk[name]);

describe('height fog', () => {
  it('patches the fog chunks', () => {
    installHeightFog();
    expect(ShaderChunk.fog_pars_vertex).toContain('varying float vFogWorldY;');
    expect(ShaderChunk.fog_pars_fragment).toContain('varying float vFogWorldY;');
    expect(ShaderChunk.fog_vertex).toContain('vFogWorldY');
    expect(ShaderChunk.fog_fragment).toContain('fogColor * 0.18');
  });

  it('is idempotent', () => {
    installHeightFog();
    const before = snapshot();
    installHeightFog();
    expect(snapshot()).toEqual(before);
  });
});
