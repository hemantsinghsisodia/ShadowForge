export type Vec3Tuple = [number, number, number];
export type CasterShape = 'box' | 'prism' | 'cylinder' | 'lshape';
export type LightType = 'fixed' | 'movable' | 'spotlight' | 'sliding' | 'orb';
export type SurfaceKind = 'floor' | 'wall' | 'ramp' | 'stairs';
export type Interaction = 'none' | 'manipulate' | 'toggle';
export type GuideKind = 'nodes' | 'rail' | 'arc';

export interface PlatformConfig {
  position: Vec3Tuple;
  size: Vec3Tuple;
}

export interface EntityState {
  position?: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  enabled?: boolean;
  shape?: CasterShape;
  size?: Vec3Tuple;
}

export interface LightConfig {
  id: string;
  type: LightType;
  label: string;
  prompt: string;
  interaction: Interaction;
  guide: GuideKind;
  position: Vec3Tuple;
  yaw: number;
  pitch: number;
  color: string;
  intensity: number;
  range: number;
  /** Spotlight half-angle in degrees. */
  cone?: number;
  states: EntityState[];
  initial: number;
  /** Where the player stands to use this light, if not at the lamp itself. */
  interactAt?: Vec3Tuple;
  zone?: string;
}

export interface CasterConfig {
  id: string;
  shape: CasterShape;
  label: string;
  prompt: string;
  interaction: Interaction;
  guide: GuideKind;
  position: Vec3Tuple;
  yaw: number;
  size: Vec3Tuple;
  states: EntityState[];
  initial: number;
  interactAt?: Vec3Tuple;
  zone?: string;
}

export interface SurfaceConfig {
  id: string;
  kind: SurfaceKind;
  origin: Vec3Tuple;
  axisU: Vec3Tuple;
  axisV: Vec3Tuple;
  sizeU: number;
  sizeV: number;
  cell: number;
  rise?: number;
  unstable?: boolean;
  decayTime?: number;
  zone?: string;
}

export interface ConsoleConfig {
  id: string;
  surfaceId: string;
  position: Vec3Tuple;
}

export interface LevelConfig {
  id: number;
  name: string;
  objective: string;
  blurb: string;
  playerStart: { position: Vec3Tuple; yaw: number };
  exit: { position: Vec3Tuple; radius: number };
  platforms: PlatformConfig[];
  lights: LightConfig[];
  casters: CasterConfig[];
  surfaces: SurfaceConfig[];
  consoles: ConsoleConfig[];
  /** State index per manipulable id. Omitted ids stay at their initial index. */
  solution: Record<string, number>;
  required: { surfaceId: string; cells: [number, number][] }[];
}
