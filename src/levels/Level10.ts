import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, forgeWall, gapCourse, makeCaster, makeLight, perimeter, slab } from './helpers';

const bridge = gapCourse('bridge', -12, -3.6, 0.8, 10, 5, 3, false);
const fade = gapCourse('fade', 40, 48.6, 53.2, 62, 5, 3, false);
fade.forge.unstable = true;
fade.forge.decayTime = 14;

const wallCells: [number, number][] = [];
for (let row = 0; row < 12; row++) for (const col of [8, 9, 10, 11]) wallCells.push([col, row]);

const level10: LevelConfig = {
  id: 10,
  name: 'The Forge',
  objective: 'Build every span, climb the wall, and cross the fading bridge before it fails.',
  blurb: 'A moving lamp, a wall to climb, and a shadow that will not wait.',
  playerStart: { position: [-8.6, 0.05, 2.2], yaw: facingX() },
  exit: { position: [58, 0.05, 0], radius: 1.15 },
  platforms: [
    ...bridge.platforms,
    slab(14.9, 0, 11.8, 10, 0),
    slab(24.8, 0, 8, 10, 3),
    ...fade.platforms,
    slab(29.2, 0, 3.2, 4, 1.5),
    slab(36, 0, 14, 8, 0),
    ...perimeter(-14, 66, -6, 6, 6),
  ],
  lights: [
    makeLight({
      id: 'lamp',
      type: 'movable',
      label: 'Movable lamp',
      prompt: 'MOVE LAMP',
      interaction: 'manipulate',
      guide: 'rail',
      position: [-5.4, 8.8, 0],
      range: 16,
      zone: 'bridge',
      states: [
        { position: [-5.4, 8.8, 0] },
        { position: [-11.4, 3.35, 0] },
      ],
      initial: 0,
      interactAt: [-7.2, 0, 2.4],
    }),
    makeLight({
      id: 'wall-lamp',
      type: 'fixed',
      label: 'Wall lamp',
      position: [12, 3.1, -2.2],
      range: 10.6,
      zone: 'wall',
    }),
    makeLight({
      id: 'fade-lamp',
      type: 'sliding',
      label: 'Sliding lamp',
      prompt: 'MOVE LAMP',
      interaction: 'manipulate',
      guide: 'rail',
      position: [46.4, 8.6, 0],
      range: 14,
      zone: 'fade',
      states: [
        { position: [46.4, 8.6, 0] },
        { position: [40.8, 3.3, 0] },
      ],
      initial: 0,
      interactAt: [34, 0, 2.4],
    }),
  ],
  casters: [
    makeCaster({
      id: 'monument',
      label: 'Monument',
      position: [-4.55, 1.25, 0],
      size: [0.5, 2.5, 2.2],
      zone: 'bridge',
    }),
    makeCaster({
      id: 'pillar',
      label: 'Pillar',
      position: [17.6, 1.5, 0.2],
      size: [1.1, 3, 1.1],
      zone: 'wall',
    }),
    makeCaster({
      id: 'keystone',
      label: 'Keystone',
      position: [47.7, 1.25, 0],
      size: [0.5, 2.5, 2.2],
      zone: 'fade',
    }),
  ],
  surfaces: [
    { ...bridge.forge, zone: 'bridge' },
    { ...forgeWall('wall', 20.8, 1.5, 0, 3, 3), zone: 'wall' },
    { ...fade.forge, zone: 'fade' },
  ],
  consoles: [
    consoleAt('forge-bridge', 'bridge', [-8, 0, -2.6]),
    consoleAt('forge-wall', 'wall', [13, 0, 2.8]),
    consoleAt('forge-fade', 'fade', [44.5, 0, -2.6]),
  ],
  solution: { lamp: 1, 'fade-lamp': 1 },
  required: [
    { surfaceId: 'bridge', cells: band(bridge.cols, [4, 5, 6, 7], 14, bridge.cols - 2) },
    { surfaceId: 'wall', cells: wallCells },
    { surfaceId: 'fade', cells: band(fade.cols, [4, 5, 6, 7], 16, fade.cols) },
  ],
};

export default level10;
