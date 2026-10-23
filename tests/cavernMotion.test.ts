import { InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RAIL_Y, chainSites, gantryX, railLine, swayAngle, trolleyRange } from '../src/world/CavernLayout';
import { CavernMotion, chainLinkGeometry, hookGeometry } from '../src/world/CavernMotion';
import { ForgeCavern } from '../src/world/ForgeCavern';
import type { ForgeKit } from '../src/world/ForgeKit';
import { CAVERN } from '../src/world/ForgePalette';

const BOUNDS = { minX: 0, maxX: 60, minZ: -5, maxZ: 5 };
const LINK_VERTS = 28; // TorusGeometry(_, _, 3, 6): (3 + 1) * (6 + 1)
const HOOK_VERTS = 55; // TorusGeometry(_, _, 4, 10, 1.5 pi): (4 + 1) * (10 + 1)

type FakeKit = Pick<ForgeKit, 'allMaterials' | 'prototype'>;
function kitWith(...names: string[]): FakeKit & { materials: MeshStandardMaterial[] } {
  const materials = names.map((name) => new MeshStandardMaterial({ name }));
  return { materials, allMaterials: () => materials, prototype: () => null };
}

const named = (motion: CavernMotion, name: string) => motion.group.getObjectByName(name) as InstancedMesh;
const matrixOf = (mesh: InstancedMesh, i: number) => new Matrix4().fromArray(mesh.instanceMatrix.array, i * 16);

function built(detail: 'medium' | 'high' = 'medium', kit: FakeKit | null = null) {
  const rail = railLine(BOUNDS, detail);
  const sites = chainSites(BOUNDS, detail, 5);
  const motion = new CavernMotion();
  motion.build(rail, sites, kit as ForgeKit | null);
  return { motion, rail: rail!, sites };
}

describe('chainLinkGeometry', () => {
  it('has ceil(length / 0.14) links', () => {
    for (const length of [1, 3, 4.5, 6.9]) {
      const geometry = chainLinkGeometry(length);
      expect(geometry.getAttribute('position').count).toBe(Math.ceil(length / 0.14) * LINK_VERTS);
    }
  });

  it('hangs from exactly y = 0 down to -length', () => {
    for (const length of [1, 3, 4, 6]) {
      const geometry = chainLinkGeometry(length);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(Math.abs(box.max.y)).toBeLessThan(0.02);
      expect(Math.abs(box.min.y + length)).toBeLessThan(0.02);
    }
  });

  it('alternates links by 90 degrees', () => {
    const geometry = chainLinkGeometry(0.28);
    const p = geometry.getAttribute('position');
    const depth = (from: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = from; i < from + LINK_VERTS; i++) {
        lo = Math.min(lo, p.getZ(i));
        hi = Math.max(hi, p.getZ(i));
      }
      return hi - lo;
    };
    expect(Math.abs(depth(0) - depth(LINK_VERTS))).toBeGreaterThan(0.1);
  });
});

describe('hookGeometry', () => {
  it('is an open 270 degree hook below y = 0', () => {
    const geometry = hookGeometry();
    expect(geometry.getAttribute('position').count).toBe(HOOK_VERTS);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeLessThan(0.1);
    expect(geometry.boundingBox!.min.y).toBeLessThan(-0.45);
  });

  it('leaves the quadrant above and to +X of the ring centre open', () => {
    const p = hookGeometry().getAttribute('position');
    let open = 0;
    let closed = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i) + 0.25; // relative to the ring centre
      if (x > 0.05 && y > 0.05) open++;
      if (x < -0.05 && y > 0.05) closed++; // the opposite upper quadrant is part of the ring
    }
    expect(open).toBe(0);
    expect(closed).toBeGreaterThan(0);
  });
});

describe('CavernMotion.build', () => {
  it('makes 6 chains and 6 hooks plus a trolley chain and hook on medium', () => {
    const { motion } = built('medium');
    expect(named(motion, 'chains').count).toBe(6);
    expect(named(motion, 'hooks').count).toBe(6);
    expect(named(motion, 'trolley-chain').count).toBe(1);
    expect(named(motion, 'trolley-hook').count).toBe(1);
    expect(motion.group.getObjectByName('carriage')).toBeInstanceOf(Mesh);
  });

  it('makes 10 chains on high', () => {
    expect(named(built('high').motion, 'chains').count).toBe(10);
  });

  it('builds nothing on a null rail or no sites', () => {
    const motion = new CavernMotion();
    motion.build(null, chainSites(BOUNDS, 'medium', 5), null);
    expect(motion.group.children).toHaveLength(0);
    motion.build(railLine(BOUNDS, 'low'), [], null);
    expect(motion.group.children).toHaveLength(0);
  });

  it('never casts or receives shadows and never frustum-culls the instanced meshes', () => {
    const { motion } = built('high');
    for (const child of motion.group.children) {
      expect(child.castShadow).toBe(false);
      expect(child.receiveShadow).toBe(false);
      if ((child as InstancedMesh).isInstancedMesh) expect(child.frustumCulled).toBe(false);
    }
  });

  it('uses the kit Graphite, Steel and WarningAmber materials when present', () => {
    const kit = kitWith('SHF_MAT_Graphite', 'SHF_MAT_Steel', 'SHF_MAT_DarkMetal', 'SHF_MAT_WarningAmber');
    const { motion } = built('medium', kit);
    const [graphite, steel, , amber] = kit.materials;
    expect(named(motion, 'chains').material).toBe(graphite);
    expect(named(motion, 'trolley-chain').material).toBe(graphite);
    expect(named(motion, 'hooks').material).toBe(steel);
    expect(named(motion, 'trolley-hook').material).toBe(steel);
    expect((motion.group.getObjectByName('carriage') as Mesh).material).toBe(amber);
  });

  it('falls back to the kit DarkMetal for the carriage when the kit has no WarningAmber', () => {
    const kit = kitWith('SHF_MAT_Graphite', 'SHF_MAT_Steel', 'SHF_MAT_DarkMetal');
    const { motion } = built('medium', kit);
    expect((motion.group.getObjectByName('carriage') as Mesh).material).toBe(kit.materials[2]);
  });

  it('builds the shared chain geometry at length 6 and scales instances by length / 6', () => {
    const { motion, sites } = built('medium');
    motion.update(0);
    const chains = named(motion, 'chains');
    chains.geometry.computeBoundingBox();
    expect(chains.geometry.boundingBox!.min.y).toBeCloseTo(-6, 1);
    sites.forEach((site, i) => {
      const scale = new Vector3().setFromMatrixScale(matrixOf(chains, i));
      expect(scale.y).toBeCloseTo(site.length / 6, 5);
      expect(scale.x).toBeCloseTo(1, 5);
    });
    const trolley = new Vector3().setFromMatrixScale(matrixOf(named(motion, 'trolley-chain'), 0));
    expect(trolley.y).toBeCloseTo(3 / 6, 5);
  });

  it('falls back to its own materials without a kit', () => {
    const { motion } = built('medium', null);
    const chain = named(motion, 'chains').material as MeshStandardMaterial;
    expect(chain.color.getHex()).toBe(0x2a2a2e);
    expect((named(motion, 'hooks').material as MeshStandardMaterial).color.getHex()).toBe(0x8a8f96);
  });

  it('places chain instances at their pivots and hooks at the chain ends', () => {
    const { motion, sites } = built('medium');
    motion.update(0);
    const chains = named(motion, 'chains');
    const hooks = named(motion, 'hooks');
    sites.forEach((site, i) => {
      const chain = new Vector3().setFromMatrixPosition(matrixOf(chains, i));
      expect(chain.distanceTo(new Vector3(site.x, site.pivotY, site.z))).toBeLessThan(1e-4);
      const hook = new Vector3().setFromMatrixPosition(matrixOf(hooks, i));
      expect(hook.distanceTo(chain)).toBeCloseTo(site.length, 3);
      expect(hook.y).toBeLessThan(site.pivotY - site.length * 0.99);
    });
  });
});

describe('CavernMotion.update', () => {
  it('sways the chains about X with swayAngle', () => {
    const { motion, sites } = built('medium');
    const t = 1.7;
    motion.update(t);
    const hook = new Vector3().setFromMatrixPosition(matrixOf(named(motion, 'hooks'), 0));
    const s = sites[0];
    // The hook swings in Z by length * sin(angle) (the quarter-amplitude Z sway mostly moves it in X).
    const angle = swayAngle(t, s.phase, s.amp, s.period);
    expect(Math.abs(angle)).toBeGreaterThan(0.01);
    expect(hook.z - s.z).toBeCloseTo(-s.length * Math.sin(angle) * Math.cos(swayAngle(t, s.phase + 1.3, s.amp * 0.25, s.period)), 2);
  });

  it('keeps each chain end on its hook', () => {
    const { motion } = built('high');
    const v = new Vector3();
    const lowest = (mesh: InstancedMesh, i: number) => {
      const m = matrixOf(mesh, i);
      const p = mesh.geometry.getAttribute('position');
      let y = Infinity;
      for (let k = 0; k < p.count; k++) y = Math.min(y, v.fromBufferAttribute(p, k).applyMatrix4(m).y);
      return y;
    };
    const hookTop = (hooks: InstancedMesh, i: number) => {
      hooks.geometry.computeBoundingBox();
      return new Vector3().setFromMatrixPosition(matrixOf(hooks, i)).y + hooks.geometry.boundingBox!.max.y;
    };
    for (const t of [0, 3.3, 9]) {
      motion.update(t);
      const pairs: [InstancedMesh, InstancedMesh, number][] = [[named(motion, 'trolley-chain'), named(motion, 'trolley-hook'), 0]];
      for (let i = 0; i < named(motion, 'chains').count; i++) pairs.push([named(motion, 'chains'), named(motion, 'hooks'), i]);
      for (const [chains, hooks, i] of pairs) expect(Math.abs(lowest(chains, i) - hookTop(hooks, i))).toBeLessThan(0.1);
    }
  });

  it('changes the instance matrices over time and flags them for upload', () => {
    const { motion } = built('medium');
    motion.update(0);
    const chains = named(motion, 'chains');
    const before = Array.from(chains.instanceMatrix.array);
    const version = chains.instanceMatrix.version;
    motion.update(1.3);
    expect(Array.from(chains.instanceMatrix.array)).not.toEqual(before);
    expect(chains.instanceMatrix.version).toBe(version + 1);
  });

  it('rides the trolley along the forward half of the rail with gantryX', () => {
    const { motion, rail } = built('medium');
    const range = trolleyRange(rail);
    for (const t of [0, 10, 40, 80]) {
      motion.update(t);
      const carriage = motion.group.getObjectByName('carriage')!;
      expect(carriage.position.x).toBeCloseTo(gantryX(t, rail), 6);
      expect(carriage.position.x).toBeGreaterThanOrEqual(range.x0 - 1e-9);
      expect(carriage.position.x).toBeLessThanOrEqual(range.x1 + 1e-9);
      expect(carriage.position.y).toBeCloseTo(RAIL_Y + 0.25, 6);
      expect(carriage.position.z).toBeCloseTo(rail.z, 6);
      const trolley = new Vector3().setFromMatrixPosition(matrixOf(named(motion, 'trolley-chain'), 0));
      expect(trolley.x).toBeCloseTo(gantryX(t, rail), 5);
      expect(trolley.y).toBeCloseTo(RAIL_Y, 5);
      const hook = new Vector3().setFromMatrixPosition(matrixOf(named(motion, 'trolley-hook'), 0));
      expect(trolley.y - hook.y).toBeGreaterThan(2.9);
      expect(trolley.y - hook.y).toBeLessThanOrEqual(3);
    }
  });

  it('allocates no Matrix4 per update', () => {
    const { motion } = built('high');
    motion.update(0);
    // Matrix4's constructor assigns this.elements, so an accessor on the prototype counts constructions.
    let made = 0;
    const key = Symbol('elements');
    Object.defineProperty(Matrix4.prototype, 'elements', {
      configurable: true,
      get() {
        return (this as Record<symbol, number[]>)[key];
      },
      set(value: number[]) {
        made++;
        (this as Record<symbol, number[]>)[key] = value;
      },
    });
    try {
      new Matrix4();
      expect(made).toBe(1); // the probe works
      made = 0;
      motion.update(1);
      motion.update(2);
      expect(made).toBe(0);
    } finally {
      delete (Matrix4.prototype as { elements?: unknown }).elements;
    }
  });
});

describe('CavernMotion.dispose', () => {
  const geometries = (motion: CavernMotion) => {
    const out = new Set<BufferGeometry>();
    motion.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) out.add(mesh.geometry);
    });
    return [...out];
  };

  it('disposes its geometries, never the kit materials', () => {
    const kit = kitWith('SHF_MAT_Graphite', 'SHF_MAT_Steel', 'SHF_MAT_DarkMetal');
    const kitSpies = kit.materials.map((m) => vi.spyOn(m, 'dispose'));
    const { motion } = built('medium', kit);
    const spies = geometries(motion).map((g) => vi.spyOn(g, 'dispose'));
    expect(spies.length).toBeGreaterThan(0);
    motion.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    for (const spy of kitSpies) expect(spy).not.toHaveBeenCalled();
    expect(motion.group.children).toHaveLength(0);
  });

  it('disposes the fallback materials it created', () => {
    const { motion } = built('medium', null);
    const materials = new Set<MeshStandardMaterial>();
    motion.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) materials.add(mesh.material as MeshStandardMaterial);
    });
    expect(materials.size).toBe(3);
    const spies = [...materials].map((m) => vi.spyOn(m, 'dispose'));
    motion.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });

  it('rebuilding clears the previous meshes', () => {
    const { motion, rail, sites } = built('medium');
    motion.build(rail, sites, null);
    expect(motion.group.children).toHaveLength(5);
  });
});

describe('ForgeCavern chains and gantry', () => {
  afterEach(() => {
    CAVERN.chains = true;
    CAVERN.gantry = true;
  });
  const motionGroup = (cavern: ForgeCavern) => cavern.group.getObjectByName('cavern-motion')!;
  const cavernWith = (detail: 'low' | 'medium' | 'high') => {
    const cavern = new ForgeCavern();
    cavern.setDetail(detail, 0);
    cavern.mount(BOUNDS, [], 5);
    cavern.setKit(kitWith('SHF_MAT_Graphite', 'SHF_MAT_Steel', 'SHF_MAT_DarkMetal') as unknown as ForgeKit);
    return cavern;
  };

  it('builds no chains, trolley or sparks without a kit, and builds them once a kit arrives', () => {
    const cavern = new ForgeCavern();
    cavern.setDetail('high', 400);
    cavern.mount(BOUNDS, [], 5);
    expect(motionGroup(cavern).children).toHaveLength(0);
    expect(cavern.group.getObjectByName('sparks')).toBeUndefined();
    cavern.setKit(kitWith('SHF_MAT_Graphite') as unknown as ForgeKit);
    expect(motionGroup(cavern).children).toHaveLength(5);
    expect(cavern.group.getObjectByName('sparks')).toBeDefined();
    cavern.setKit(null);
    expect(motionGroup(cavern).children).toHaveLength(0);
    expect(cavern.group.getObjectByName('sparks')).toBeUndefined();
  });

  it('builds on medium and high, nothing on low', () => {
    expect(motionGroup(cavernWith('medium')).children).toHaveLength(5);
    expect(motionGroup(cavernWith('high')).children).toHaveLength(5);
    expect(motionGroup(cavernWith('low')).children).toHaveLength(0);
  });

  it('tune hides the chains and the gantry separately', () => {
    const cavern = cavernWith('medium');
    const group = motionGroup(cavern);
    cavern.tune({ chains: false });
    expect(group.getObjectByName('chains')!.visible).toBe(false);
    expect(group.getObjectByName('hooks')!.visible).toBe(false);
    expect(group.getObjectByName('carriage')!.visible).toBe(true);
    cavern.tune({ chains: true, gantry: false });
    expect(group.getObjectByName('chains')!.visible).toBe(true);
    for (const name of ['carriage', 'trolley-chain', 'trolley-hook']) expect(group.getObjectByName(name)!.visible).toBe(false);
  });

  it('keeps visibility across a rebuild and moves with update', () => {
    const cavern = cavernWith('medium');
    cavern.tune({ gantry: false });
    cavern.setDetail('high', 0);
    expect(motionGroup(cavern).getObjectByName('carriage')!.visible).toBe(false);
    const chains = motionGroup(cavern).getObjectByName('chains') as InstancedMesh;
    cavern.update(0);
    const before = Array.from(chains.instanceMatrix.array);
    cavern.update(2);
    expect(Array.from(chains.instanceMatrix.array)).not.toEqual(before);
  });

  it('rebuilds only when the detail, bounds, seed or kit change', () => {
    const cavern = cavernWith('medium');
    const first = motionGroup(cavern).getObjectByName('chains');
    cavern.mount(BOUNDS, [], 5);
    cavern.setDetail('medium', 0);
    expect(motionGroup(cavern).getObjectByName('chains')).toBe(first);
    cavern.mount(BOUNDS, [], 6);
    expect(motionGroup(cavern).getObjectByName('chains')).not.toBe(first);
  });
});
