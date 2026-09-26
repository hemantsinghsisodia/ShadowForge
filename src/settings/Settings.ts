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

export function initialAppliedQuality(mode: QualityMode, _coarse: boolean): AppliedQuality {
  if (mode === 'low' || mode === 'medium' || mode === 'high') return mode;
  return 'high';
}

export function downgrade(tier: AppliedQuality): AppliedQuality | null {
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  return null;
}

export interface QualityProfile {
  dprCap: number;
  antialias: boolean;
  shadowMapSize: number;
  particles: number;
  bloom: boolean;
  /** 1 is full resolution. Phones on MEDIUM use a half-resolution bloom buffer. */
  bloomScale: number;
  lightCap: number;
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
}

export function profileFor(tier: AppliedQuality, coarse: boolean): QualityProfile {
  if (tier === 'low') {
    return {
      dprCap: coarse ? 1 : 1.25,
      antialias: false,
      shadowMapSize: 0,
      particles: 40,
      bloom: false,
      bloomScale: 1,
      lightCap: 4,
      envMap: false,
      beams: false,
      dust: 0,
      postFx: false,
      playerLight: false,
      dressingDetail: 'low',
      msaa: 0,
      sky: 'low',
    };
  }
  if (tier === 'medium') {
    return {
      dprCap: coarse ? 1.5 : 1.75,
      antialias: !coarse,
      shadowMapSize: 1024,
      particles: 110,
      bloom: true,
      bloomScale: coarse ? 0.5 : 1,
      lightCap: 6,
      envMap: true,
      beams: true,
      dust: 40,
      postFx: true,
      playerLight: true,
      dressingDetail: 'high',
      msaa: coarse ? 2 : 4,
      sky: 'medium',
    };
  }
  return {
    dprCap: coarse ? 1.5 : 2,
    antialias: true,
    shadowMapSize: 2048,
    particles: 220,
    bloom: true,
    bloomScale: 1,
    lightCap: 8,
    envMap: true,
    beams: true,
    dust: 80,
    postFx: true,
    playerLight: true,
    dressingDetail: 'high',
    msaa: 4,
    sky: 'high',
  };
}
