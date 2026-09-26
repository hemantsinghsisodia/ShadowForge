/// <reference types="vite/client" />

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
}

declare global {
  interface Window {
    __SF?: ShadowforgeDebug;
  }
}

export {};
