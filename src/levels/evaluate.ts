import { cellCenter, computeShadowMask, maskAscii, maskToBoxes, normalize } from '../shadows/math';
import type { CasterVolume, LightVolume, SolidBox, SurfaceDef } from '../shadows/types';
import type { CasterConfig, LevelConfig, LightConfig, SurfaceConfig } from './LevelData';

export interface Indexed {
  id: string;
  states: number;
  initial: number;
}

export function manipulables(config: LevelConfig): Indexed[] {
  const list: Indexed[] = [];
  for (const light of config.lights) {
    if (light.interaction !== 'none') list.push({ id: light.id, states: light.states.length, initial: light.initial });
  }
  for (const caster of config.casters) {
    if (caster.interaction !== 'none') list.push({ id: caster.id, states: caster.states.length, initial: caster.initial });
  }
  return list;
}

export function stateMap(config: LevelConfig, solution: boolean): Record<string, number> {
  const map: Record<string, number> = {};
  for (const light of config.lights) map[light.id] = light.initial;
  for (const caster of config.casters) map[caster.id] = caster.initial;
  if (solution) {
    for (const [id, index] of Object.entries(config.solution)) map[id] = index;
  }
  return map;
}

export function surfaceDef(cfg: SurfaceConfig): SurfaceDef {
  const axisU = normalize({ x: cfg.axisU[0], y: cfg.axisU[1], z: cfg.axisU[2] });
  const axisV = normalize({ x: cfg.axisV[0], y: cfg.axisV[1], z: cfg.axisV[2] });
  const cols = Math.max(1, Math.round(cfg.sizeU / cfg.cell));
  const rows = Math.max(1, Math.round(cfg.sizeV / cfg.cell));
  return {
    id: cfg.id,
    origin: { x: cfg.origin[0], y: cfg.origin[1], z: cfg.origin[2] },
    axisU,
    axisV,
    sizeU: cols * cfg.cell,
    sizeV: rows * cfg.cell,
    cell: cfg.cell,
    cols,
    rows,
    kind: cfg.kind,
    rise: cfg.rise ?? 0,
    unstable: cfg.unstable === true,
    decayTime: cfg.decayTime ?? 12,
  };
}

function spotDirection(yaw: number, pitch: number): { dx: number; dy: number; dz: number } {
  const cp = Math.cos(pitch);
  return {
    dx: Math.sin(yaw) * cp,
    dy: -Math.sin(pitch),
    dz: Math.cos(yaw) * cp,
  };
}

export function resolveLight(cfg: LightConfig, index: number): LightVolume {
  const state = cfg.states[Math.max(0, Math.min(cfg.states.length - 1, index))] ?? {};
  const position = state.position ?? cfg.position;
  const yaw = state.yaw ?? cfg.yaw;
  const pitch = state.pitch ?? cfg.pitch;
  const enabled = state.enabled ?? true;
  let spot: LightVolume['spot'] = null;
  if (cfg.type === 'spotlight') {
    const dir = spotDirection(yaw, pitch);
    const cone = ((cfg.cone ?? 18) * Math.PI) / 180;
    spot = { ...dir, cosLimit: Math.cos(cone) };
  }
  return {
    id: cfg.id,
    enabled,
    x: position[0],
    y: position[1],
    z: position[2],
    range: cfg.range,
    spot,
  };
}

export function resolveCaster(cfg: CasterConfig, index: number): CasterVolume {
  const state = cfg.states[Math.max(0, Math.min(cfg.states.length - 1, index))] ?? {};
  const position = state.position ?? cfg.position;
  const size = state.size ?? cfg.size;
  return {
    id: cfg.id,
    kind: state.shape ?? cfg.shape,
    cx: position[0],
    cy: position[1],
    cz: position[2],
    yaw: state.yaw ?? cfg.yaw,
    sx: size[0],
    sy: size[1],
    sz: size[2],
  };
}

export function volumesFor(config: LevelConfig, states: Record<string, number>): { lights: LightVolume[]; casters: CasterVolume[] } {
  return {
    lights: config.lights.map((light) => resolveLight(light, states[light.id] ?? light.initial)),
    casters: config.casters.map((caster) => resolveCaster(caster, states[caster.id] ?? caster.initial)),
  };
}

export function masksFor(config: LevelConfig, states: Record<string, number>): Map<string, { mask: Uint8Array; def: SurfaceDef }> {
  const { lights, casters } = volumesFor(config, states);
  const out = new Map<string, { mask: Uint8Array; def: SurfaceDef }>();
  for (const surface of config.surfaces) {
    const def = surfaceDef(surface);
    out.set(surface.id, { mask: computeShadowMask(def, lights, casters), def });
  }
  return out;
}

export function missingRequired(config: LevelConfig, states: Record<string, number>): string[] {
  const masks = masksFor(config, states);
  const missing: string[] = [];
  for (const req of config.required) {
    const found = masks.get(req.surfaceId);
    if (!found) {
      missing.push(`${req.surfaceId}:missing-surface`);
      continue;
    }
    for (const [col, row] of req.cells) {
      if (col < 0 || row < 0 || col >= found.def.cols || row >= found.def.rows || !found.mask[row * found.def.cols + col]) {
        missing.push(`${req.surfaceId}:${col},${row}`);
      }
    }
  }
  return missing;
}

export function staticBoxes(config: LevelConfig): SolidBox[] {
  return config.platforms.map((platform) => {
    const hx = platform.size[0] / 2;
    const hy = platform.size[1] / 2;
    const hz = platform.size[2] / 2;
    return {
      minX: platform.position[0] - hx,
      maxX: platform.position[0] + hx,
      minY: platform.position[1] - hy,
      maxY: platform.position[1] + hy,
      minZ: platform.position[2] - hz,
      maxZ: platform.position[2] + hz,
      climbable: false,
      nx: 0,
      ny: 1,
      nz: 0,
    };
  });
}

export function shadowBoxes(config: LevelConfig, states: Record<string, number>): SolidBox[] {
  const masks = masksFor(config, states);
  const boxes: SolidBox[] = [];
  for (const surface of config.surfaces) {
    const found = masks.get(surface.id);
    if (!found) continue;
    boxes.push(...maskToBoxes(found.def, found.mask));
  }
  return boxes;
}

export function solutionStates(config: LevelConfig): Record<string, number> {
  return stateMap(config, true);
}

export interface SolveHit {
  states: Record<string, number>;
  missing: number;
}

/** Brute-force search used by tests to prove a level has exactly one covering state. */
export function findCoveringStates(config: LevelConfig, limit = 8): { hits: SolveHit[]; best: SolveHit } {
  const knobs = manipulables(config);
  const hits: SolveHit[] = [];
  let best: SolveHit = { states: stateMap(config, false), missing: Number.POSITIVE_INFINITY };
  const current: Record<string, number> = {};
  const walk = (i: number) => {
    if (hits.length >= limit && best.missing === 0) return;
    if (i >= knobs.length) {
      const states = { ...stateMap(config, false), ...current };
      const missing = missingRequired(config, states).length;
      if (missing < best.missing) best = { states, missing };
      if (missing === 0) hits.push({ states: { ...states }, missing });
      return;
    }
    const knob = knobs[i];
    for (let s = 0; s < knob.states; s++) {
      current[knob.id] = s;
      walk(i + 1);
    }
  };
  walk(0);
  return { hits, best };
}

export function describeMasks(config: LevelConfig, states: Record<string, number>): string {
  const masks = masksFor(config, states);
  const parts: string[] = [];
  for (const [id, value] of masks) {
    parts.push(`${id} ${value.def.cols}x${value.def.rows}\n${maskAscii(value.mask, value.def.cols, value.def.rows)}`);
  }
  return parts.join('\n');
}

export function reachedSurfaces(config: LevelConfig, states: Record<string, number>): Record<string, string[]> {
  const { lights } = volumesFor(config, states);
  const result: Record<string, string[]> = {};
  for (const light of lights) {
    if (!light.enabled) {
      result[light.id] = [];
      continue;
    }
    const hit: string[] = [];
    for (const surface of config.surfaces) {
      const def = surfaceDef(surface);
      let any = false;
      for (let row = 0; row < def.rows && !any; row++) {
        for (let col = 0; col < def.cols; col++) {
          const p = cellCenter(def, col, row);
          const dist = Math.hypot(p.x - light.x, p.y - light.y, p.z - light.z);
          if (dist <= light.range) {
            any = true;
            break;
          }
        }
      }
      if (any) hit.push(surface.id);
    }
    result[light.id] = hit;
  }
  return result;
}

export function casterBoxes(config: LevelConfig, states: Record<string, number>): SolidBox[] {
  return config.casters.map((cfg) => {
    const volume = resolveCaster(cfg, states[cfg.id] ?? cfg.initial);
    const hy = volume.sy / 2;
    let hx = volume.sx / 2;
    let hz = volume.sz / 2;
    if (volume.kind === 'cylinder') {
      hx = Math.max(hx, hz);
      hz = hx;
    } else if (Math.abs(volume.yaw) > 0.001) {
      const c = Math.abs(Math.cos(volume.yaw));
      const s = Math.abs(Math.sin(volume.yaw));
      const sx = volume.sx;
      const sz = volume.sz;
      hx = (c * sx + s * sz) / 2;
      hz = (s * sx + c * sz) / 2;
    }
    return {
      minX: volume.cx - hx,
      maxX: volume.cx + hx,
      minY: volume.cy - hy,
      maxY: volume.cy + hy,
      minZ: volume.cz - hz,
      maxZ: volume.cz + hz,
      climbable: false,
      nx: 0,
      ny: 1,
      nz: 0,
    };
  });
}
