import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.6, 0.8, 10);

const rail: [number, number, number][] = [
  [-5.4, 8.8, 0],
  [-5.7, 8.0, 0],
  [-6.1, 7.2, 0],
  [-6.6, 6.5, 0],
  [-7.4, 5.8, 0],
  [-11.4, 3.35, 0],
];

const level2: LevelConfig = {
  id: 2,
  name: 'Move the Light',
  objective: 'Move the lamp until the shadow reaches the far side, then forge it.',
  blurb: 'The same monument casts a short shadow or a long one. Only the length is the puzzle.',
  playerStart: { position: [-8.5, 0.05, 2.4], yaw: facingX() },
  exit: { position: [6, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'lamp',
      type: 'movable',
      label: 'Movable lamp',
      prompt: 'MOVE LAMP',
      interaction: 'manipulate',
      guide: 'rail',
      position: rail[0],
      range: 26,
      intensity: 16,
      states: rail.map((position) => ({ position })),
      initial: 0,
      interactAt: [-7.2, 0, 2.2],
    }),
  ],
  casters: [
    makeCaster({
      id: 'monument',
      label: 'Monument',
      position: [-4.55, 1.25, 0],
      size: [0.5, 2.5, 2.2],
    }),
  ],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-8.4, 0, -2.4])],
  solution: { lamp: 5 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [4, 5, 6, 7], 15, course.cols) }],
};

export default level2;
