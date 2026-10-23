import { InstancedMesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { KIT, type EnvKit } from '../src/world/EnvKit';
import { buildKitFloor } from '../src/world/LabDressing';
import { LEVELS, getLevel } from '../src/levels';
import { LAMP_SHADOW, disposeLightShadows, pickShadowLamp, releaseLampShadow } from '../src/world/LampShadow';

describe('pickShadowLamp', () => {
  it('picks the spotlight on level 6', () => {
    const level = getLevel(6);
    const spot = level.lights.find((l) => l.type === 'spotlight');
    expect(spot).toBeDefined();
    expect(pickShadowLamp(level)).toBe(spot!.id);
  });

  it('returns an existing lamp id on every level, or null when there are no lamps', () => {
    for (const level of LEVELS) {
      const id = pickShadowLamp(level);
      if (level.lights.length === 0) expect(id).toBeNull();
      else expect(level.lights.map((l) => l.id)).toContain(id);
    }
  });

  it('is deterministic', () => {
    for (const level of LEVELS) expect(pickShadowLamp(level)).toBe(pickShadowLamp(level));
  });

  it('picks the lamp nearest the first surface on XZ, ties to the earlier lamp', () => {
    const base = getLevel(1);
    const origin = base.surfaces[0].origin;
    const lamp = (id: string, dx: number, dy: number) => ({
      ...base.lights[0],
      id,
      type: 'fixed' as const,
      position: [origin[0] + dx, origin[1] + dy, origin[2]] as [number, number, number],
    });
    const config = { ...base, lights: [lamp('far', 5, 0), lamp('near', 1, 30), lamp('tie', -1, 0)] };
    expect(pickShadowLamp(config)).toBe('near');
    expect(pickShadowLamp({ ...base, lights: [] })).toBeNull();
  });

  it('exposes the shadow settings', () => {
    expect(LAMP_SHADOW).toEqual({ mapSize: 512, bias: -0.002, normalBias: 0.05, radius: 2 });
  });
});

describe('kit floor shadows', () => {
  it('builds tile instances that receive but never cast shadows', () => {
    const part = { geometry: new PlaneGeometry(4, 4), material: new MeshStandardMaterial() };
    const kit = {
      prototype: (name: string) => (name === KIT.tileA || name === KIT.tileB ? [part] : null),
      merged: () => null,
      owns: () => false,
      allMaterials: () => [part.material],
    } as unknown as EnvKit;
    const floor = buildKitFloor(kit, [{ position: [0, -0.25, 0], size: [8, 0.5, 8] }]);
    expect(floor).not.toBeNull();
    const meshes: InstancedMesh[] = [];
    floor!.group.traverse((child) => {
      if ((child as InstancedMesh).isInstancedMesh) meshes.push(child as InstancedMesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
    }
  });
});

describe('disposeLightShadows', () => {
  it('disposes each light shadow and skips missing ones', () => {
    const a = { shadow: { dispose: vi.fn() } };
    const b = { shadow: { dispose: vi.fn() } };
    disposeLightShadows([a, undefined, null, b, {}]);
    expect(a.shadow.dispose).toHaveBeenCalledTimes(1);
    expect(b.shadow.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('releaseLampShadow', () => {
  it('disposes the shadow map and clears it so three re-creates it later', () => {
    const dispose = vi.fn();
    const light = { shadow: { dispose, map: {} as unknown, mapPass: {} as unknown } };
    releaseLampShadow(light);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(light.shadow.map).toBeNull();
    expect(light.shadow.mapPass).toBeNull();
  });
});
