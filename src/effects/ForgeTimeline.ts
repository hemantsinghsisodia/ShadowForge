/** Pure curves for the 0.9 s forge moment: charge, impact punch, then obsidian rising. */
export const CHARGE_END = 0.45;
export const FORGE_END = 0.9;
export const RISE_TIME = 0.45;
export const COLLAPSE_TIME = 0.3;

export interface ForgeFrame {
  charge: number;
  flash: number;
  exposure: number;
  bloom: number;
  ca: number;
  fovKick: number;
  shake: number;
  light: number;
  impact: boolean;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeOutBack(t: number, s = 1.4): number {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/** 0 before t = 0, linear 0 to 1 over `attack`, then exponential decay. */
export function pulse(t: number, attack: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

/** Writes the frame for time `t` into `out` without allocating. `impact` is true only on the crossing frame. */
export function forgeTimeline(t: number, prevT: number, reducedMotion: boolean, out: ForgeFrame): ForgeFrame {
  const s = t - CHARGE_END;
  const charge = t < CHARGE_END ? easeOutCubic(Math.min(1, Math.max(0, t) / CHARGE_END)) : 0;
  const hit = s >= 0;
  out.charge = charge;
  out.impact = prevT < CHARGE_END && t >= CHARGE_END;
  out.flash = pulse(s, 0.04, 0.3) * 0.9;
  out.exposure = pulse(s, 0.03, 0.35) * 0.45;
  out.bloom = pulse(s, 0.03, 0.5) * 0.9;
  out.ca = pulse(s, 0.02, 0.25) * 0.005;
  out.light = pulse(s, 0.05, 0.8);
  out.shake = hit ? 0.5 * Math.exp(-s / 0.18) : 0.25 * charge;
  out.fovKick = hit ? Math.max(0, 5 * (1 - easeOutBack(Math.min(1, s / 0.6)))) : 0;
  if (reducedMotion) {
    out.shake = 0;
    out.fovKick = 0;
    out.flash *= 0.4;
    out.ca *= 0.4;
  }
  return out;
}

export function riseProgress(t: number): number {
  return easeOutCubic(clamp01(t / RISE_TIME));
}

export function collapseProgress(t: number): number {
  return 1 - easeOutCubic(clamp01(t / COLLAPSE_TIME));
}

export function collapseFlash(t: number): number {
  return pulse(t, 0.03, 0.12) * 0.3;
}
