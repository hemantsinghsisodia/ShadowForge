import type { MeshStandardMaterial } from 'three';
import { loadKit, type Kit } from './EnvKit';
import { FORGE } from './ForgePalette';

/**
 * SHADOWFORGE sci-fi kit (public/models/environment/SHADOWFORGE_EnvKit.glb), retinted molten.
 * Every node sits at the origin, so prototypes are used as authored. Only the pieces the cavern
 * structures need are listed.
 */
export const FORGE_KIT = {
  edge: 'SHF_Floor_Edge',
  beam: 'SHF_Structure_Beam',
  tray: 'SHF_Structure_CableTray',
  lamp: 'SHF_Lamp_Industrial',
  pillar: 'SHF_Pillar_A',
} as const;

export type ForgeKitName = (typeof FORGE_KIT)[keyof typeof FORGE_KIT];
export type ForgeKit = Kit<ForgeKitName>;

const URL = `${import.meta.env.BASE_URL}models/environment/SHADOWFORGE_EnvKit.glb`;
let pending: Promise<ForgeKit | null> | null = null;
let ready: ForgeKit | null = null;

/** Swaps the kit's cold cyan and white emissives for molten ones. Matches the GLB material names (SHF_MAT_ prefix optional). */
export function forgeRetint(material: MeshStandardMaterial): void {
  switch (material.name.replace(/^SHF_MAT_/, '')) {
    case 'CyanEmission':
      material.emissive.setHex(FORGE.glow);
      material.emissiveIntensity = 1.6; // above the 1.2 bloom threshold
      break;
    case 'WhiteEmission':
      material.emissive.setHex(0xffc890);
      material.emissiveIntensity = 2.0;
      break;
  }
}

/** Loads the kit once; later calls share the same promise. Resolves null if the file is missing or unreadable. */
export function loadForgeKit(): Promise<ForgeKit | null> {
  pending ??= loadKit(URL, Object.values(FORGE_KIT), forgeRetint, 'ForgeKit').then((kit) => (ready = kit));
  return pending;
}

/** The kit if it has already finished loading. */
export function forgeKit(): ForgeKit | null {
  return ready;
}
