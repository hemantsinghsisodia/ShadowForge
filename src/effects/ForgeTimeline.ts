import type { Punch } from './PostFX';

/** Pure curves for the 0.9 s forge moment: charge, impact punch, then obsidian rising. */
export const CHARGE_END = 0.45;
export const FORGE_END = 0.9;
export const RISE_TIME = 0.45;
export const COLLAPSE_TIME = 0.3;
/** The obsidian waits this long after the impact so its first growth is not lost under the flash. */
export const RISE_DELAY = 0.12;
/** Time after the forge starts by which every post-impact term has decayed to (near) zero. */
export const FORGE_SETTLE = 2.5;

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
  out.flash = pulse(s, 0.04, 0.18) * 0.55;
  out.exposure = pulse(s, 0.03, 0.35) * 0.25;
  out.bloom = pulse(s, 0.03, 0.5) * 0.6;
  out.ca = pulse(s, 0.02, 0.25) * 0.005;
  out.light = pulse(s, 0.05, 0.4);
  out.shake = hit ? 0.5 * Math.exp(-s / 0.18) : 0.25 * charge;
  out.fovKick = hit ? Math.max(0, 5 * (1 - easeOutBack(Math.min(1, s / 0.6)))) : 0;
  if (reducedMotion) {
    out.shake = 0;
    out.fovKick = 0;
    out.flash *= 0.4;
    out.exposure *= 0.4;
    out.bloom *= 0.4;
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

/** Warm red the full-screen flash takes on while a shadow collapses. */
export const COLLAPSE_FLASH_COLOR = 0xff6a4a;

/** Copies the punch terms of `frame` into `out` (white flash) without allocating. */
export function fillPunch(frame: ForgeFrame, out: Punch): Punch {
  out.flash = frame.flash;
  out.exposure = frame.exposure;
  out.bloom = frame.bloom;
  out.ca = frame.ca;
  out.flashColor = undefined;
  return out;
}

/**
 * Merges a live collapse flash into the forge punch: the larger flash wins and turns collapse-red,
 * every other term is the forge's. `out` may be `base` itself. Allocation-free.
 */
export function mixPunch(base: Punch, collapse: number, out: Punch): Punch {
  out.flash = Math.max(base.flash, collapse);
  out.exposure = base.exposure;
  out.bloom = base.bloom;
  out.ca = base.ca;
  out.flashColor = COLLAPSE_FLASH_COLOR;
  return out;
}

/** The collapse clock `t` at which `collapseProgress(t)` equals `progress` (the exact inverse of the cubic ease). */
export function collapseTimeFor(progress: number): number {
  return COLLAPSE_TIME * (1 - Math.cbrt(clamp01(progress)));
}

/** Clock of one forge moment and its effect tail; `t` keeps running until FORGE_SETTLE, well past input unlocking at FORGE_END. */
export interface ForgeFx {
  active: boolean;
  t: number;
  prevT: number;
  surfaceId: string;
}

/** Arms `fx` for `surfaceId`. `prevT` sits before 0 so the first step cannot be mistaken for the impact crossing. */
export function startForgeFx(fx: ForgeFx, surfaceId: string): ForgeFx {
  fx.active = true;
  fx.t = 0;
  fx.prevT = -1;
  fx.surfaceId = surfaceId;
  return fx;
}

/**
 * Advances `fx` by `dt` and writes the frame into `out`. Returns true on the step that reaches FORGE_SETTLE,
 * which also deactivates `fx`; an inactive `fx` is left untouched. Impact fires on exactly one step.
 */
export function stepForgeFx(fx: ForgeFx, dt: number, reducedMotion: boolean, out: ForgeFrame): boolean {
  if (!fx.active) return false;
  fx.prevT = fx.t;
  fx.t += dt;
  forgeTimeline(fx.t, fx.prevT, reducedMotion, out);
  if (fx.t < FORGE_SETTLE) return false;
  fx.active = false;
  return true;
}
