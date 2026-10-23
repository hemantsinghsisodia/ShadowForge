import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
  OBSIDIAN_FRAG,
  OBSIDIAN_UNIT_BOX,
  OBSIDIAN_VERT,
  buildObsidianMesh,
  createObsidianMaterial,
  stepSolid,
  type SolidState,
} from '../src/effects/Obsidian';
import { COLLAPSE_TIME, RISE_TIME, collapseProgress, riseProgress } from '../src/effects/ForgeTimeline';
import { maskToBoxes } from '../src/shadows/math';
import type { SolidBox, SurfaceDef } from '../src/shadows/types';

function box(partial: Partial<SolidBox> = {}): SolidBox {
  return { minX: -1, minY: 0, minZ: -2, maxX: 1, maxY: 0.32, maxZ: 2, climbable: false, nx: 0, ny: 1, nz: 0, ...partial };
}

describe('buildObsidianMesh', () => {
  it('makes one instance per box carrying centre and scale', () => {
    const material = createObsidianMaterial(1);
    const mesh = buildObsidianMesh([box(), box({ minX: 4, maxX: 5, minY: 1, maxY: 3, minZ: 0, maxZ: 1 })], material);
    expect(mesh.count).toBe(2);
    const m = new Matrix4();
    const pos = new Vector3();
    const scale = new Vector3();
    mesh.getMatrixAt(0, m);
    pos.setFromMatrixPosition(m);
    scale.setFromMatrixScale(m);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0.16);
    expect(pos.z).toBeCloseTo(0);
    expect(scale.x).toBeCloseTo(2);
    expect(scale.y).toBeCloseTo(0.32);
    expect(scale.z).toBeCloseTo(4);
    mesh.getMatrixAt(1, m);
    pos.setFromMatrixPosition(m);
    scale.setFromMatrixScale(m);
    expect([pos.x, pos.y, pos.z]).toEqual([4.5, 2, 0.5]);
    expect(scale.x).toBeCloseTo(1);
    expect(scale.y).toBeCloseTo(2);
    expect(scale.z).toBeCloseTo(1);
  });

  it('clamps degenerate extents like the old per-box meshes', () => {
    const mesh = buildObsidianMesh([box({ minY: 1, maxY: 1, minX: 0, maxX: 0 })], createObsidianMaterial(1));
    const m = new Matrix4();
    const scale = new Vector3();
    mesh.getMatrixAt(0, m);
    scale.setFromMatrixScale(m);
    expect(scale.x).toBeCloseTo(0.05);
    expect(scale.y).toBeCloseTo(0.08);
  });

  it('feeds aAxis from the box normals, defaulting to up when a normal is zero', () => {
    const mesh = buildObsidianMesh([box({ nx: -1, ny: 0, nz: 0 }), box({ nx: 0, ny: 0, nz: 0 })], createObsidianMaterial(1));
    const axis = mesh.geometry.getAttribute('aAxis');
    expect(axis.itemSize).toBe(3);
    expect(axis.count).toBe(2);
    expect([axis.getX(0), axis.getY(0), axis.getZ(0)]).toEqual([-1, 0, 0]);
    expect([axis.getX(1), axis.getY(1), axis.getZ(1)]).toEqual([0, 1, 0]);
  });

  it('points aAxis from the plate toward the grown face for real floor and wall boxes', () => {
    const floor: SurfaceDef = {
      id: 'f',
      origin: { x: 0, y: 0, z: 0 },
      axisU: { x: 1, y: 0, z: 0 },
      axisV: { x: 0, y: 0, z: 1 },
      sizeU: 2,
      sizeV: 2,
      cell: 0.5,
      cols: 4,
      rows: 4,
      kind: 'floor',
      rise: 0,
      unstable: false,
      decayTime: 10,
    };
    const wall: SurfaceDef = { ...floor, kind: 'wall', origin: { x: 0, y: 1, z: 0 }, axisU: { x: 0, y: 0, z: 1 }, axisV: { x: 0, y: 1, z: 0 } };
    const solid = new Uint8Array(16).fill(1);
    const f = maskToBoxes(floor, solid)[0];
    const w = maskToBoxes(wall, solid)[0];
    // Floor slab hangs below the plane, so it grows upward to the plane.
    expect([f.nx, f.ny, f.nz]).toEqual([0, 1, 0]);
    // Wall box is extruded from its plane (x = 0) along n, so the base is the plane and the tip is at -x.
    expect(w.nx).toBeCloseTo(-1);
    expect(w.minX).toBeCloseTo(-0.46);
    expect(w.maxX).toBeCloseTo(0);
  });

  it('shares one unit box and never disposes it', () => {
    const a = buildObsidianMesh([box()], createObsidianMaterial(1));
    const b = buildObsidianMesh([box()], createObsidianMaterial(1));
    let disposed = false;
    OBSIDIAN_UNIT_BOX.addEventListener('dispose', () => (disposed = true));
    a.geometry.dispose();
    b.geometry.dispose();
    a.dispose();
    expect(disposed).toBe(false);
    expect(OBSIDIAN_UNIT_BOX.parameters.width).toBe(1);
    expect(a.geometry.getAttribute('position').count).toBe(OBSIDIAN_UNIT_BOX.getAttribute('position').count);
    expect(a.geometry).not.toBe(b.geometry);
    expect(a.castShadow).toBe(true);
    expect(a.receiveShadow).toBe(true);
  });
});

describe('createObsidianMaterial', () => {
  it('exposes stab, color, rise and hot, rising fully and cold by default', () => {
    const material = createObsidianMaterial(0.5);
    expect(material.uniforms.stab.value).toBe(0.5);
    expect(material.uniforms.rise.value).toBe(1);
    expect(material.uniforms.hot.value).toBe(0);
    expect(material.uniforms.color).toBeDefined();
  });
});

describe('obsidian shaders', () => {
  it('rise, hot and aAxis are wired through both stages', () => {
    for (const src of [OBSIDIAN_VERT, OBSIDIAN_FRAG]) expect(src).toContain('rise');
    expect(OBSIDIAN_VERT).toContain('aAxis');
    expect(OBSIDIAN_VERT).toContain('USE_INSTANCING');
    expect(OBSIDIAN_VERT).toContain('instanceMatrix');
    expect(OBSIDIAN_VERT).toContain('vK');
    expect(OBSIDIAN_FRAG).toContain('hot');
    expect(OBSIDIAN_FRAG).toContain('vK');
  });
});

describe('stepSolid', () => {
  it('rises monotonically and settles at 1 by RISE_TIME, then idles', () => {
    const state: SolidState = { mode: 'rise', t: 0 };
    let last = 0;
    let out = stepSolid(state, 0.05);
    expect(out.rise).toBeCloseTo(riseProgress(0.05));
    expect(out.hot).toBe(0);
    expect(out.done).toBe(false);
    for (let i = 0; i < 30 && state.mode === 'rise'; i++) {
      out = stepSolid(state, 0.05);
      expect(out.rise).toBeGreaterThanOrEqual(last);
      last = out.rise;
    }
    expect(state.t).toBeGreaterThanOrEqual(RISE_TIME);
    expect(out.rise).toBe(1);
    expect(state.mode).toBe('idle');
    expect(stepSolid(state, 0.1)).toMatchObject({ rise: 1, hot: 0, done: false });
  });

  it('collapses to 0 hot, and is done by COLLAPSE_TIME', () => {
    const state: SolidState = { mode: 'collapse', t: 0 };
    let out = stepSolid(state, 0.05);
    expect(out.rise).toBeCloseTo(collapseProgress(0.05));
    expect(out.hot).toBe(1);
    expect(out.done).toBe(false);
    out = stepSolid(state, COLLAPSE_TIME);
    expect(out.rise).toBe(0);
    expect(out.done).toBe(true);
  });

  it('reuses one result object so the frame loop does not allocate', () => {
    const a = stepSolid({ mode: 'idle', t: 0 }, 0.016);
    const b = stepSolid({ mode: 'rise', t: 0 }, 0.016);
    expect(a).toBe(b);
  });
});
