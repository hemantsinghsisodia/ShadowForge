import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.4, 1.2, 10);
course.forge.unstable = true;
course.forge.decayTime = 12;

const rail: [number, number, number][] = [
  [-5.6, 8.6, 0],
  [-6.8, 6.8, 0],
  [-11.2, 3.3, 0],
];

const level7: LevelConfig = {
  id: 7,
  name: 'Unstable Shadows',
  objective: 'Forge the bridge and cross before the stability bar empties.',
  blurb: 'This forge will not hold. The path is real only for a few seconds, and you can forge it again.',
  playerStart: { position: [-8.2, 0.05, 2.3], yaw: facingX() },
  exit: { position: [6.2, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'lamp',
      type: 'sliding',
      label: 'Sliding lamp',
      prompt: 'MOVE LAMP',
      interaction: 'manipulate',
      guide: 'rail',
      position: rail[0],
      range: 26,
      states: rail.map((position) => ({ position })),
      initial: 0,
      interactAt: [-7, 0, 2.2],
    }),
  ],
  casters: [
    makeCaster({
      id: 'monument',
      label: 'Monument',
      position: [-4.3, 1.25, 0],
      size: [0.5, 2.5, 2.2],
    }),
  ],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-7.4, 0, -2.6])],
  solution: { lamp: 2 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [4, 5, 6, 7], 16, course.cols) }],
};

export default level7;
