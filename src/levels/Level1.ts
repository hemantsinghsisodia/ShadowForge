import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.6, 0.8, 10);

const level1: LevelConfig = {
  id: 1,
  name: 'First Shadow',
  objective: 'Forge the shadow across the gap, then cross.',
  blurb: 'A monument and a lamp already agree. The forge does not, until you tell it to.',
  playerStart: { position: [-9, 0.05, 1.8], yaw: facingX() },
  exit: { position: [6, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'lamp',
      label: 'Fixed lamp',
      position: [-9.2, 4.15, 0],
      range: 24,
      intensity: 14,
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
  consoles: [consoleAt('forge', 'bridge', [-8.2, 0, -2.4])],
  solution: {},
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [4, 5, 6, 7], 5, course.cols - 2) }],
};

export default level1;
