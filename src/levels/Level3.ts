import type { LevelConfig } from './LevelData';
import { consoleAt, facingX, forgeWall, makeCaster, makeLight, perimeter, slab } from './helpers';

const cells: [number, number][] = [];
for (let row = 0; row < 12; row++) {
  for (const col of [8, 9, 10, 11]) cells.push([col, row]);
}

const level3: LevelConfig = {
  id: 3,
  name: 'Shadow Wall',
  objective: 'Forge the shadow on the wall, then climb it.',
  blurb: 'Not every shadow lies on the floor. This one is a wall you can hold.',
  playerStart: { position: [-7.2, 0.05, 0], yaw: facingX() },
  exit: { position: [4.6, 3.05, 0], radius: 1.1 },
  platforms: [
    slab(-5.1, 0, 11.8, 10, 0),
    slab(4.8, 0, 8, 10, 3),
    ...perimeter(-12, 10, -5, 5, 6),
  ],
  lights: [
    makeLight({
      id: 'lamp',
      label: 'Fixed lamp',
      position: [-8, 3.1, -2.2],
      range: 18,
      intensity: 16,
    }),
  ],
  casters: [
    makeCaster({
      id: 'pillar',
      label: 'Pillar',
      position: [-2.4, 1.5, 0.2],
      size: [1.1, 3, 1.1],
    }),
  ],
  surfaces: [forgeWall('wall', 0.8, 1.5, 0, 3, 3)],
  consoles: [consoleAt('forge', 'wall', [-6.5, 0, 2.6])],
  solution: {},
  required: [{ surfaceId: 'wall', cells }],
};

export default level3;
