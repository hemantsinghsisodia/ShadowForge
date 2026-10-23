import { describe, expect, it } from 'vitest';
import { applyPunch, gradeShader, ZERO_PUNCH } from '../src/effects/PostFX';

describe('postfx punch', () => {
  it('adds a punch on top of the tier base', () => {
    const out = applyPunch({ exposure: 1, bloom: 0.65, ca: 0.0012 }, { flash: 0.9, exposure: 0.45, bloom: 0.9, ca: 0.005 });
    expect(out.exposure).toBeCloseTo(1.45, 10);
    expect(out.bloom).toBeCloseTo(1.55, 10);
    expect(out.ca).toBeCloseTo(0.0062, 10);
    expect(out.flash).toBe(0.9);
  });

  it('ZERO_PUNCH returns the base unchanged', () =>
    expect(applyPunch({ exposure: 1.05, bloom: 0, ca: 0 }, ZERO_PUNCH)).toEqual({ exposure: 1.05, bloom: 0, ca: 0, flash: 0 }));

  it('exposes flash and CA uniforms and keeps the NaN clamp', () => {
    expect(gradeShader.uniforms).toHaveProperty('flash');
    expect(gradeShader.uniforms).toHaveProperty('ca');
    expect(gradeShader.uniforms).toHaveProperty('flashColor');
    expect(gradeShader.fragmentShader.match(/== .* \? .* : 0\.0/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('freezes ZERO_PUNCH', () => expect(Object.isFrozen(ZERO_PUNCH)).toBe(true));

  it('writes into a supplied out object and returns it', () => {
    const out = { exposure: 9, bloom: 9, ca: 9, flash: 9 };
    const res = applyPunch({ exposure: 1, bloom: 2, ca: 3 }, { flash: 4, exposure: 1, bloom: 1, ca: 1 }, out);
    expect(res).toBe(out);
    expect(out).toEqual({ exposure: 2, bloom: 3, ca: 4, flash: 4 });
  });
});
