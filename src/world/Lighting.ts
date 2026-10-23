/** Single source for the base lab lighting. Mutable on purpose: LevelWorld.applyLighting tunes it live. */
export interface LightingConfig {
  /** Key directional light intensity. */
  sun: number;
  sunColor: number;
  /** Hemisphere fill when the env map supplies ambient light. */
  hemiEnv: number;
  /** Hemisphere fill when it does not. */
  hemiNoEnv: number;
  /** Env reflection strength (material envMapIntensity and scene.environmentIntensity). */
  env: number;
  /** Colour multiplied into the floor texture. */
  floorTint: number;
  /** Colour multiplied into the wall texture. */
  wallTint: number;
  /** Multiplier on the Kenney kit base colours; emissives are untouched. */
  kitScale: number;
}

export const LIGHTING: LightingConfig = {
  sun: 1.6,
  sunColor: 0xc8d6ee,
  hemiEnv: 0.35,
  hemiNoEnv: 0.7,
  env: 0.4,
  floorTint: 0x6a7584,
  wallTint: 0x5a6472,
  kitScale: 0.55,
};

/** The hemisphere fill steps down when the env map supplies ambient reflection and light. */
export function hemiIntensity(envMap: boolean): number {
  return envMap ? LIGHTING.hemiEnv : LIGHTING.hemiNoEnv;
}
