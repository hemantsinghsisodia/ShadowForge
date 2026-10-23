import { describe, expect, it, vi } from 'vitest';
import {
  CHARGE_END,
  FORGE_END,
  FORGE_SETTLE,
  RISE_TIME,
  COLLAPSE_TIME,
  easeOutCubic,
  easeOutBack,
  pulse,
  forgeTimeline,
  riseProgress,
  collapseProgress,
  collapseFlash,
  type ForgeFrame,
} from '../src/effects/ForgeTimeline';
import { prefersReducedMotion } from '../src/core/device';
import { PerspectiveCamera } from 'three';
import { BASE_FOV, CameraRig } from '../src/player/CameraRig';
import { FORGE_LIGHT_PEAK, ForgeSurface, forgeLightPoint } from '../src/shadows/ForgeSurface';
import type { SurfaceDef } from '../src/shadows/types';

function frame(): ForgeFrame {
  return { charge: 0, flash: 0, exposure: 0, bloom: 0, ca: 0, fovKick: 0, shake: 0, light: 0, impact: false };
}

describe('easing', () => {
  it('easeOutCubic maps 0 to 0 and 1 to 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('easeOutBack overshoots 1 inside (0, 1) and ends at 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    let max = 0;
    for (let t = 0.01; t < 1; t += 0.01) max = Math.max(max, easeOutBack(t));
    expect(max).toBeGreaterThan(1);
  });
});

describe('pulse', () => {
  it('is 0 before 0, peaks at the attack time and decays', () => {
    expect(pulse(-0.1, 0.04, 0.3)).toBe(0);
    expect(pulse(0.04, 0.04, 0.3)).toBeCloseTo(1, 10);
    expect(pulse(0.02, 0.04, 0.3)).toBeCloseTo(0.5, 10);
    expect(pulse(0.04 + 5 * 0.3, 0.04, 0.3)).toBeLessThan(0.05);
  });
});

describe('forgeTimeline', () => {
  it('returns the same out object it was given', () => {
    const out = frame();
    expect(forgeTimeline(0.1, 0.09, false, out)).toBe(out);
  });

  it('flags impact in exactly one frame of a 60 Hz sweep', () => {
    const out = frame();
    let hits = 0;
    let prev = -1 / 60;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      forgeTimeline(t, prev, false, out);
      if (out.impact) hits++;
      prev = t;
    }
    expect(hits).toBe(1);
  });

  it('charges up before impact and releases at impact', () => {
    const out = frame();
    forgeTimeline(CHARGE_END * 0.5, 0.4 * CHARGE_END, false, out);
    expect(out.charge).toBeGreaterThan(0.5);
    expect(out.shake).toBeCloseTo(0.25 * out.charge, 10);
    expect(out.flash).toBe(0);
    forgeTimeline(CHARGE_END + 0.04, CHARGE_END + 0.03, false, out);
    expect(out.charge).toBe(0);
    expect(out.flash).toBeCloseTo(0.9, 10);
    forgeTimeline(CHARGE_END + 0.05, CHARGE_END + 0.04, false, out);
    expect(out.light).toBeCloseTo(1, 10);
  });

  // FORGE_END (0.9 s) is only when input unlocks; the punch terms keep decaying and are fully gone by FORGE_SETTLE.
  it('has settled by FORGE_SETTLE', () => {
    const out = frame();
    forgeTimeline(FORGE_SETTLE, FORGE_SETTLE - 1 / 60, false, out);
    expect(out.flash).toBeLessThan(0.01);
    expect(out.exposure).toBeLessThan(0.01);
    expect(out.ca).toBeLessThan(0.01);
    expect(out.shake).toBeLessThan(0.01);
    expect(out.light).toBeLessThan(0.01);
    expect(out.bloom).toBeLessThan(0.02);
    expect(out.fovKick).toBe(0);
  });

  it('does not flag impact on the first frame', () => {
    const out = frame();
    forgeTimeline(1 / 60, 0, false, out);
    expect(out.impact).toBe(false);
  });

  it('flags impact exactly once on a coarse 0.3 s sweep', () => {
    const out = frame();
    let hits = 0;
    let prev = 0;
    for (let t = 0.3; t <= 1.2 + 1e-9; t += 0.3) {
      forgeTimeline(t, prev, false, out);
      if (out.impact) hits++;
      prev = t;
    }
    expect(hits).toBe(1);
    forgeTimeline(0.5, 0.2, false, out);
    expect(out.impact).toBe(true);
  });

  it('never rises again once past the peak', () => {
    const out = frame();
    let prevFlash = Infinity;
    let prevBloom = Infinity;
    let prev = 0.5;
    for (let t = CHARGE_END + 0.1; t <= FORGE_END; t += 1 / 60) {
      forgeTimeline(t, prev, false, out);
      expect(out.flash).toBeLessThanOrEqual(prevFlash);
      expect(out.bloom).toBeLessThanOrEqual(prevBloom);
      prevFlash = out.flash;
      prevBloom = out.bloom;
      prev = t;
    }
  });

  it('reduced motion zeroes shake and fov kick at every t and softens flash and ca', () => {
    const out = frame();
    const full = frame();
    let prev = -1 / 60;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      forgeTimeline(t, prev, true, out);
      forgeTimeline(t, prev, false, full);
      expect(out.shake).toBe(0);
      expect(out.fovKick).toBe(0);
      expect(out.flash).toBeCloseTo(full.flash * 0.4, 10);
      expect(out.ca).toBeCloseTo(full.ca * 0.4, 10);
      prev = t;
    }
  });
});

describe('rise and collapse', () => {
  it('riseProgress runs 0 to 1 over RISE_TIME', () => {
    expect(riseProgress(0)).toBe(0);
    expect(riseProgress(RISE_TIME)).toBe(1);
    expect(riseProgress(RISE_TIME * 3)).toBe(1);
    expect(riseProgress(-1)).toBe(0);
  });

  it('collapseProgress runs 1 to 0 over COLLAPSE_TIME', () => {
    expect(collapseProgress(0)).toBe(1);
    expect(collapseProgress(COLLAPSE_TIME)).toBe(0);
    expect(collapseProgress(COLLAPSE_TIME * 3)).toBe(0);
  });

  it('collapseFlash is a small pulse', () => {
    expect(collapseFlash(-1)).toBe(0);
    expect(collapseFlash(0.03)).toBeCloseTo(0.3, 10);
  });
});

describe('prefersReducedMotion', () => {
  it('is false where matchMedia is missing (node)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

function surface(axisU: [number, number, number], axisV: [number, number, number]): SurfaceDef {
  return {
    id: 's',
    origin: { x: 2, y: 1, z: -3 },
    axisU: { x: axisU[0], y: axisU[1], z: axisU[2] },
    axisV: { x: axisV[0], y: axisV[1], z: axisV[2] },
    sizeU: 4,
    sizeV: 4,
    cell: 1,
    cols: 4,
    rows: 4,
    kind: 'floor',
    rise: 0,
    unstable: false,
    decayTime: 12,
  };
}

describe('CameraRig.kick', () => {
  it('kicks the fov and returns to BASE_FOV', () => {
    const rig = new CameraRig();
    expect(rig.camera.fov).toBe(BASE_FOV);
    rig.kick(5);
    expect(rig.camera.fov).toBe(BASE_FOV + 5);
    rig.kick(0);
    expect(rig.camera.fov).toBe(BASE_FOV);
  });

  it('skips the projection update when the fov has not moved', () => {
    const rig = new CameraRig();
    const spy = vi.spyOn(rig.camera as PerspectiveCamera, 'updateProjectionMatrix');
    rig.kick(0);
    rig.kick(0);
    rig.kick(0.005);
    expect(spy).not.toHaveBeenCalled();
    rig.kick(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('ForgeSurface charge', () => {
  it('starts uncharged and writes the charge uniform', () => {
    const forge = new ForgeSurface(surface([1, 0, 0], [0, 0, 1]));
    expect(forge.material.uniforms.charge.value).toBe(0);
    forge.setCharge(0.7);
    expect(forge.material.uniforms.charge.value).toBe(0.7);
  });
});

describe('forgeLightPoint', () => {
  it('sits 0.6 along the plate normal (axisU x axisV) from the origin', () => {
    const out = { x: 0, y: 0, z: 0 };
    forgeLightPoint(surface([1, 0, 0], [0, 0, -1]), 0.6, out);
    expect(out.x).toBeCloseTo(2, 10);
    expect(out.y).toBeCloseTo(1.6, 10);
    expect(out.z).toBeCloseTo(-3, 10);
  });

  it('peaks at 120', () => {
    expect(FORGE_LIGHT_PEAK).toBe(120);
  });
});
