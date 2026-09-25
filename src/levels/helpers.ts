import type {
  CasterConfig,
  CasterShape,
  ConsoleConfig,
  EntityState,
  GuideKind,
  LightConfig,
  LightType,
  PlatformConfig,
  SurfaceConfig,
  Vec3Tuple,
} from './LevelData';

export function slab(x: number, z: number, w: number, d: number, top = 0, thick = 0.5): PlatformConfig {
  return { position: [x, top - thick / 2, z], size: [w, thick, d] };
}

export function block(x: number, y: number, z: number, w: number, h: number, d: number): PlatformConfig {
  return { position: [x, y, z], size: [w, h, d] };
}

export function perimeter(minX: number, maxX: number, minZ: number, maxZ: number, height = 4.8): PlatformConfig[] {
  const t = 0.45;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const y = height / 2;
  return [
    block(midX, y, minZ - t / 2, w + t * 2, height, t),
    block(midX, y, maxZ + t / 2, w + t * 2, height, t),
    block(minX - t / 2, y, midZ, t, height, d),
    block(maxX + t / 2, y, midZ, t, height, d),
  ];
}

export function forgeFloor(
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  extra: Partial<SurfaceConfig> = {},
): SurfaceConfig {
  return {
    id,
    kind: 'floor',
    axisU: [1, 0, 0],
    axisV: [0, 0, 1],
    sizeU: w,
    sizeV: d,
    cell: 0.25,
    ...extra,
    origin: extra.origin ?? [x, 0, z],
  };
}

export function forgeWall(id: string, x: number, y: number, z: number, widthZ: number, height: number, zone?: string): SurfaceConfig {
  return {
    id,
    kind: 'wall',
    origin: [x, y, z],
    axisU: [0, 0, 1],
    axisV: [0, 1, 0],
    sizeU: widthZ,
    sizeV: height,
    cell: 0.25,
    zone,
  };
}

export function forgeRamp(
  id: string,
  x: number,
  z: number,
  width: number,
  run: number,
  rise: number,
  baseY = 0,
  zone?: string,
): SurfaceConfig {
  const length = Math.hypot(run, rise);
  return {
    id,
    kind: 'ramp',
    origin: [x, baseY + rise / 2, z],
    axisU: [1, 0, 0],
    axisV: [0, rise, run],
    sizeU: width,
    sizeV: length,
    cell: 0.25,
    rise,
    zone,
  };
}

interface LightOpts {
  id: string;
  type?: LightType;
  label: string;
  prompt?: string;
  interaction?: LightConfig['interaction'];
  guide?: GuideKind;
  position: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  color?: string;
  intensity?: number;
  range: number;
  cone?: number;
  states?: EntityState[];
  initial?: number;
  interactAt?: Vec3Tuple;
  zone?: string;
}

export function makeLight(opts: LightOpts): LightConfig {
  const states = opts.states ?? [{}];
  return {
    id: opts.id,
    type: opts.type ?? 'fixed',
    label: opts.label,
    prompt: opts.prompt ?? '',
    interaction: opts.interaction ?? 'none',
    guide: opts.guide ?? 'nodes',
    position: opts.position,
    yaw: opts.yaw ?? 0,
    pitch: opts.pitch ?? 0,
    color: opts.color ?? '#ffd2a1',
    intensity: opts.intensity ?? 12,
    range: opts.range,
    cone: opts.cone,
    states,
    initial: opts.initial ?? 0,
    interactAt: opts.interactAt,
    zone: opts.zone,
  };
}

interface CasterOpts {
  id: string;
  shape?: CasterShape;
  label: string;
  prompt?: string;
  interaction?: CasterConfig['interaction'];
  guide?: GuideKind;
  position: Vec3Tuple;
  yaw?: number;
  size: Vec3Tuple;
  states?: EntityState[];
  initial?: number;
  interactAt?: Vec3Tuple;
  zone?: string;
}

export function makeCaster(opts: CasterOpts): CasterConfig {
  return {
    id: opts.id,
    shape: opts.shape ?? 'box',
    label: opts.label,
    prompt: opts.prompt ?? 'MOVE OBJECT',
    interaction: opts.interaction ?? 'none',
    guide: opts.guide ?? 'nodes',
    position: opts.position,
    yaw: opts.yaw ?? 0,
    size: opts.size,
    states: opts.states ?? [{}],
    initial: opts.initial ?? 0,
    interactAt: opts.interactAt,
    zone: opts.zone,
  };
}

export function consoleAt(id: string, surfaceId: string, position: Vec3Tuple): ConsoleConfig {
  return { id, surfaceId, position };
}

/** Cells of a horizontal band across a floor forge. */
export function band(cols: number, rows: number[], colStart = 0, colEnd = cols): [number, number][] {
  const cells: [number, number][] = [];
  for (const row of rows) {
    for (let col = colStart; col < colEnd; col++) cells.push([col, row]);
  }
  return cells;
}

export function facingX(): number {
  return Math.PI / 2;
}

export function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export interface Course {
  platforms: PlatformConfig[];
  forge: SurfaceConfig;
  cols: number;
  rows: number;
}

/** Two floor slabs with a forge plate bridging the gap, plus perimeter walls. */
export function gapCourse(
  id: string,
  minX: number,
  gap0: number,
  gap1: number,
  maxX: number,
  zHalf = 5,
  forgeDepth = 3,
  walls = true,
  top = 0,
): Course {
  const startW = gap0 - minX;
  const endW = maxX - gap1;
  const forgeW = Math.round((gap1 - gap0 + 0.5) / 0.25) * 0.25;
  const forgeD = Math.round(forgeDepth / 0.25) * 0.25;
  const forge = forgeFloor(id, (gap0 + gap1) / 2, 0, forgeW, forgeD, { origin: [(gap0 + gap1) / 2, top, 0] });
  return {
    platforms: [
      slab(minX + startW / 2, 0, startW, zHalf * 2, top),
      slab(gap1 + endW / 2, 0, endW, zHalf * 2, top),
      ...(walls ? perimeter(minX, maxX, -zHalf, zHalf) : []),
    ],
    forge,
    cols: Math.round(forgeW / 0.25),
    rows: Math.round(forgeD / 0.25),
  };
}
