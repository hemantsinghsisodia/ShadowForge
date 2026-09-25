export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SolidBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  climbable: boolean;
  /** Points from the climb face toward the side the player stands on. */
  nx: number;
  ny: number;
  nz: number;
}

export type CasterKind = 'box' | 'prism' | 'cylinder' | 'lshape';

export interface CasterVolume {
  id: string;
  kind: CasterKind;
  cx: number;
  cy: number;
  cz: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface SpotCone {
  dx: number;
  dy: number;
  dz: number;
  cosLimit: number;
}

export interface LightVolume {
  id: string;
  enabled: boolean;
  x: number;
  y: number;
  z: number;
  range: number;
  spot: SpotCone | null;
}

export type SurfaceKind = 'floor' | 'wall' | 'ramp' | 'stairs';

export interface SurfaceDef {
  id: string;
  origin: Vec3;
  axisU: Vec3;
  axisV: Vec3;
  sizeU: number;
  sizeV: number;
  cell: number;
  cols: number;
  rows: number;
  kind: SurfaceKind;
  rise: number;
  unstable: boolean;
  decayTime: number;
}

export interface Rect {
  c: number;
  r: number;
  w: number;
  h: number;
}
