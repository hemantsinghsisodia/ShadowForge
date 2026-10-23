/// <reference types="vite/client" />

import type { LightingConfig } from './world/Lighting';

interface ShadowforgeDebug {
  jump: (level: number) => void;
  begin: () => void;
  use: () => void;
  solve: () => void;
  forge: () => void;
  pos: () => { x: number; y: number; z: number; grounded: boolean };
  drive: (x: number, z: number, ms: number) => Promise<unknown>;
  boxes: () => unknown;
  fps: () => number;
  post: (mode: 'off' | 'bloom' | 'grade' | 'full') => void;
  light: (p: Partial<LightingConfig>) => LightingConfig;
  bloom: (strength: number, radius: number, threshold: number) => void;
}

declare global {
  interface Window {
    __SF?: ShadowforgeDebug;
  }
}

export {};
