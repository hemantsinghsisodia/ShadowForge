import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.6, 0.8, 10);
const x = -4.35;

const level4: LevelConfig = {
  id: 4,
  name: 'Shape Matters',
  objective: 'Choose the object whose shadow spans the gap, then forge it.',
  blurb: 'Three shapes share one pedestal. Only one of them is long enough, and wide enough.',
  playerStart: { position: [-8.6, 0.05, 2.4], yaw: facingX() },
  exit: { position: [6, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'lamp',
      label: 'Fixed lamp',
      position: [-9.4, 4.3, 0],
      range: 24,
      intensity: 14,
    }),
  ],
  casters: [
    makeCaster({
      id: 'pedestal',
      label: 'Shape pedestal',
      prompt: 'TAP SHAPE',
      interaction: 'manipulate',
      guide: 'nodes',
      position: [x, 0.75, 0],
      size: [1.5, 1.5, 1.5],
      states: [
        { shape: 'box', size: [1.5, 1.5, 1.5], position: [x, 0.75, 0] },
        { shape: 'box', size: [0.45, 2.9, 0.45], position: [x, 1.45, 0] },
        { shape: 'box', size: [0.4, 2.5, 2.4], position: [x, 1.25, 0] },
      ],
      initial: 0,
      interactAt: [-6.2, 0, 2.3],
    }),
  ],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-8.2, 0, -2.4])],
  solution: { pedestal: 2 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [3, 4, 5, 6, 7, 8], 6, course.cols - 1) }],
};

export default level4;
