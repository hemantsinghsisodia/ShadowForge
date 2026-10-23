import type { LevelConfig } from '../levels/LevelData';

/** Shadow-map settings for the one puzzle lamp that casts real shadows on High. */
export const LAMP_SHADOW = { mapSize: 512, bias: -0.002, normalBias: 0.05, radius: 2 } as const;

/**
 * The id of the lamp that casts real shadows: the first spotlight, else the lamp nearest (XZ) to the first surface's origin.
 * Ties go to the earlier lamp. Null when the level has no lamps.
 */
export function pickShadowLamp(config: LevelConfig): string | null {
  const lights = config.lights;
  if (lights.length === 0) return null;
  const spot = lights.find((light) => light.type === 'spotlight');
  if (spot) return spot.id;
  const origin = config.surfaces[0]?.origin;
  if (!origin) return lights[0].id;
  let best = lights[0];
  let bestDist = Infinity;
  for (const light of lights) {
    const dist = Math.hypot(light.position[0] - origin[0], light.position[2] - origin[2]);
    if (dist < bestDist) {
      best = light;
      bestDist = dist;
    }
  }
  return best.id;
}

/**
 * Frees the shadow render targets of lights that are about to be dropped. three never releases `light.shadow.map`
 * when a light leaves the scene, so a level reload would leak one per shadow-casting light.
 */
export function disposeLightShadows(lights: Iterable<{ shadow?: { dispose(): void } } | null | undefined>): void {
  for (const light of lights) light?.shadow?.dispose();
}
