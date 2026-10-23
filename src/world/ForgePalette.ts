import { Color, SRGBColorSpace } from 'three';

/** Single source for the forge-cavern colours. Hex values are sRGB. */
export const FORGE = {
  top: 0x060508,
  haze: 0x2a1209,
  glow: 0xff6a1f,
  crack: 0xffa040,
  crust: 0x140806,
  ember: 0xffb15a,
  under: 0xff6a2a,
  hemiGround: 0x4a1e0c,
} as const;

/** Mutable on purpose: tuned live from the console. */
export const CAVERN = {
  crackHdr: 3.0,
  glow: 0.8,
  flow: 0.06,
  fogDensity: 0.024,
  embers: true,
};

export const MENU_FOG_DENSITY = 0.045;

/** World Y of the molten abyss surface. */
export const ABYSS_Y = -9;

const rgbA = { r: 0, g: 0, b: 0 };
const rgbB = { r: 0, g: 0, b: 0 };

/** Lerps in sRGB space so dark mixes do not wash out the way linear mixes do. */
export function mixSrgb(a: number, b: number, t: number): Color {
  new Color(a).getRGB(rgbA, SRGBColorSpace);
  new Color(b).getRGB(rgbB, SRGBColorSpace);
  return new Color().setRGB(
    rgbA.r + (rgbB.r - rgbA.r) * t,
    rgbA.g + (rgbB.g - rgbA.g) * t,
    rgbA.b + (rgbB.b - rgbA.b) * t,
    SRGBColorSpace,
  );
}

export function cavernFog(): Color {
  return new Color(FORGE.haze);
}

/** Slow, never-flat flicker for the molten glow. */
export function moltenPulse(t: number): number {
  return 0.85 + 0.1 * Math.sin(1.3 * t) + 0.05 * Math.sin(3.7 * t + 1.1);
}

/** The level accent deliberately plays no part in the background or the fog. */
export function levelAtmosphere(id: number): { background: number; fog: number; density: number } {
  return { background: FORGE.top, fog: FORGE.haze, density: CAVERN.fogDensity * (id >= 8 ? 0.6 : 1) };
}
