export type QualityMode = 'auto' | 'low' | 'medium' | 'high';
export type AppliedQuality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualityMode;
  sound: boolean;
  music: boolean;
  volume: number;
  haptics: boolean;
  cameraSensitivity: number;
  controlSensitivity: number;
  invertY: boolean;
}

export const defaultSettings = (): Settings => ({
  quality: 'auto',
  sound: true,
  music: true,
  volume: 0.8,
  haptics: true,
  cameraSensitivity: 1,
  controlSensitivity: 1,
  invertY: false,
});

export function clampSettings(input: Partial<Settings> | null | undefined): Settings {
  const base = defaultSettings();
  if (!input || typeof input !== 'object') return base;
  const quality: QualityMode = ['auto', 'low', 'medium', 'high'].includes(input.quality ?? '')
    ? (input.quality as QualityMode)
    : base.quality;
  return {
    quality,
    sound: input.sound !== false,
    music: input.music !== false,
    volume: clampNum(input.volume, 0, 1, base.volume),
    haptics: input.haptics !== false,
    cameraSensitivity: clampNum(input.cameraSensitivity, 0.4, 2, base.cameraSensitivity),
    controlSensitivity: clampNum(input.controlSensitivity, 0.6, 1.6, base.controlSensitivity),
    invertY: input.invertY === true,
  };
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function initialAppliedQuality(mode: QualityMode, coarse: boolean): AppliedQuality {
  if (mode === 'low' || mode === 'medium' || mode === 'high') return mode;
  return coarse ? 'medium' : 'high';
}

export function downgrade(tier: AppliedQuality): AppliedQuality | null {
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  return null;
}

export function upgrade(tier: AppliedQuality): AppliedQuality | null {
  if (tier === 'low') return 'medium';
  if (tier === 'medium') return 'high';
  return null;
}

/**
 * Decides an AUTO quality change from the 90-frame fps averages, newest last.
 * Drops when the newest window is poor; steps up only after three good windows
 * in a row and never once a drop has happened this session.
 */
export function nextTier(
  windows: number[],
  tier: AppliedQuality,
  mode: QualityMode,
  dropped: boolean,
): AppliedQuality | null {
  if (mode !== 'auto' || windows.length === 0) return null;
  if (windows[windows.length - 1] < 42) return downgrade(tier);
  if (!dropped && windows.length >= 3 && windows.slice(-3).every((fps) => fps >= 57)) return upgrade(tier);
  return null;
}

export interface QualityProfile {
  dprCap: number;
  shadowMapSize: number;
  particles: number;
  bloom: boolean;
  /** 1 is full resolution. Phones on MEDIUM use a half-resolution bloom buffer. */
  bloomScale: number;
  envMap: boolean;
  beams: boolean;
  dust: number;
  postFx: boolean;
  playerLight: boolean;
  dressingDetail: 'low' | 'high';
  /** Multisample count for the post-processing buffer. 0 on Low, which has no composer. */
  msaa: number;
  /** Space backdrop detail. High is the same on phones and desktops. */
  sky: 'low' | 'medium' | 'high';
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
  /** Chromatic aberration offset in UV units. 0 disables it. */
  chromatic: number;
}

export function profileFor(tier: AppliedQuality, coarse: boolean): QualityProfile {
  if (tier === 'low') {
    return {
      dprCap: coarse ? 1 : 1.25,
      shadowMapSize: 0,
      particles: 40,
      bloom: false,
      bloomScale: 1,
      envMap: false,
      beams: false,
      dust: 0,
      postFx: false,
      playerLight: false,
      dressingDetail: 'low',
      msaa: 0,
      sky: 'low',
      bloomStrength: 0,
      bloomRadius: 0,
      bloomThreshold: 1,
      exposure: 1.05,
      chromatic: 0,
    };
  }
  if (tier === 'medium') {
    return {
      dprCap: coarse ? 1.5 : 1.75,
      shadowMapSize: 1024,
      particles: 110,
      bloom: true,
      bloomScale: coarse ? 0.5 : 1,
      envMap: true,
      beams: true,
      dust: 40,
      postFx: true,
      playerLight: true,
      dressingDetail: 'high',
      msaa: coarse ? 2 : 4,
      sky: 'medium',
      bloomStrength: 0.45,
      bloomRadius: 0.35,
      bloomThreshold: 0.9,
      exposure: 1.0,
      chromatic: 0,
    };
  }
  return {
    dprCap: coarse ? 1.5 : 2,
    shadowMapSize: 2048,
    particles: 220,
    bloom: true,
    bloomScale: 1,
    envMap: true,
    beams: true,
    dust: 80,
    postFx: true,
    playerLight: true,
    dressingDetail: 'high',
    msaa: 4,
    sky: 'high',
    bloomStrength: 0.65,
    bloomRadius: 0.45,
    bloomThreshold: 0.85,
    exposure: 1.0,
    chromatic: 0.0012,
  };
}
