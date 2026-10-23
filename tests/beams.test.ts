import { Color } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BEAM_FRAG, createBeam, setBeamTime } from '../src/effects/LightBeams';

describe('beam shimmer', () => {
  const g = globalThis as { document?: unknown };
  const saved = g.document;
  beforeEach(() => {
    g.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop: () => undefined }),
          fillRect: () => undefined,
          fillStyle: '',
        }),
      }),
    };
  });
  afterEach(() => {
    g.document = saved;
  });

  it('declares a time uniform on the material', () => {
    const view = createBeam(new Color(0xffffff));
    expect(view.material.uniforms.time.value).toBe(0);
    expect(BEAM_FRAG).toContain('uniform float time;');
  });

  it('setBeamTime writes the uniform', () => {
    const view = createBeam(new Color(0xffffff));
    setBeamTime(view, 3.5);
    expect(view.material.uniforms.time.value).toBe(3.5);
  });

  it('beams stay unfogged', () => {
    const view = createBeam(new Color(0xffffff));
    expect(view.material.fog).toBe(false);
    expect(BEAM_FRAG).not.toContain('fog_fragment');
  });

  it('halo stays unfogged like the cone', () => {
    const view = createBeam(new Color(0xffffff));
    expect(view.halo.material.fog).toBe(false);
  });
});
