import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Scene } from 'three';
import { PARTICLE_VERT, PARTICLE_FRAG, KIND_INTENSITY, DUST_INTENSITY, DUST_ALPHA, ParticleManager } from '../src/effects/ParticleManager';

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

  it('uses the specified HDR intensities per burst kind and dust', () => {
    expect(KIND_INTENSITY).toEqual({ spark: 3.0, shard: 2.5, ember: 2.0 });
    expect(DUST_INTENSITY).toBe(0.6);
  });

  it('halves the rendered alpha of dust motes', () => {
    expect(DUST_ALPHA).toBe(0.5);
  });
});

describe('burstPoints budget', () => {
  const xs = (pm: ParticleManager): number[] => {
    const attr = (pm as unknown as { geometry: BufferGeometry }).geometry.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < attr.count; i++) if (attr.getY(i) > -900) out.push(attr.getX(i));
    return out;
  };
  const line = (n: number): Float32Array => {
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pts[i * 3] = i * 10;
    return pts;
  };

  it('strides across all points when the budget is smaller than the total', () => {
    const pm = new ParticleManager(new Scene(), 10);
    pm.burstPoints(line(40), 1, 0xffffff, 'spark');
    const got = xs(pm);
    expect(got.length).toBeLessThanOrEqual(10);
    expect(got.length).toBeGreaterThan(0);
    expect(got.some((x) => x < 100)).toBe(true);
    expect(got.some((x) => x > 300)).toBe(true);
  });

  it('never exceeds the budget with several particles per point', () => {
    const pm = new ParticleManager(new Scene(), 10);
    pm.burstPoints(line(40), 3, 0xffffff, 'spark');
    expect(xs(pm).length).toBeLessThanOrEqual(10);
  });

  it('accepts an intensity override like burst', () => {
    const pm = new ParticleManager(new Scene(), 4);
    pm.burstPoints(line(2), 1, 0xffffff, 'spark', undefined, 7);
    const colors = (pm as unknown as { geometry: BufferGeometry }).geometry.getAttribute('aColor');
    expect(colors.getX(0)).toBeCloseTo(7, 5);
  });
});

describe('dust colour', () => {
  it('is written once at construction and not by the per-frame seeding', () => {
    const pm = new ParticleManager(new Scene(), 4);
    const geo = (pm as unknown as { geometry: BufferGeometry }).geometry;
    const colors = geo.getAttribute('aColor');
    const dustSlot = 359;
    expect(colors.getZ(dustSlot)).toBeCloseTo(DUST_INTENSITY, 5);
    pm.setDust(10);
    pm.update(0.016);
    const flag = (pm as unknown as { colorDirty: boolean }).colorDirty;
    expect(flag).toBe(false);
  });

  it('uses dynamic draw buffers', () => {
    const pm = new ParticleManager(new Scene(), 4);
    const geo = (pm as unknown as { geometry: BufferGeometry }).geometry;
    for (const n of ['position', 'aColor', 'size', 'alpha']) {
      expect((geo.getAttribute(n) as BufferAttribute).usage).toBe(DynamicDrawUsage);
    }
  });
});
