import { Color, Mesh, MeshBasicMaterial, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { LAB_ENV_PANELS, buildLabEnvScene } from '../src/world/LabEnvironment';
import { LIGHTING, hemiIntensity } from '../src/world/Lighting';

describe('lab environment', () => {
  it('balances fill light against the env map', () => {
    expect(hemiIntensity(true)).toBe(LIGHTING.hemiEnv);
    expect(hemiIntensity(false)).toBe(LIGHTING.hemiNoEnv);
    expect(LIGHTING.env).toBe(0.25);
  });

  it('has cool side strips and one warm key matching the sun', () => {
    expect(LAB_ENV_PANELS.filter((p) => p.color === 0x9fdcff)).toHaveLength(4);
    const key = LAB_ENV_PANELS.filter((p) => p.color === 0xffc890);
    expect(key).toHaveLength(1);
    expect(key[0].position[0]).toBeLessThan(0);
    expect(key[0].position[1]).toBeGreaterThan(0);
  });

  it('has a warm emitter below the origin and a molten floor in the gradient sphere', () => {
    const scene = buildLabEnvScene();
    const meshes = scene.children.filter((child): child is Mesh => (child as Mesh).isMesh);
    const emitters = meshes.filter((mesh) => mesh.position.y < 0 && mesh.material instanceof MeshBasicMaterial);
    expect(emitters.length).toBeGreaterThanOrEqual(1);
    for (const mesh of emitters) {
      const color = (mesh.material as MeshBasicMaterial).color;
      expect(color.r).toBeGreaterThan(color.b);
    }
    const sphere = meshes.find((mesh) => mesh.material instanceof ShaderMaterial);
    const floor = (sphere?.material as ShaderMaterial).uniforms.floorColor.value as Color;
    expect(floor.getHex()).toBe(0x2a0e06);
  });

  it('builds a scene without a renderer', () => {
    expect(buildLabEnvScene().children.length).toBeGreaterThanOrEqual(6);
  });
});
