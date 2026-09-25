import type { LevelConfig } from './LevelData';
import { band, consoleAt, deg, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -4, 3.2, 7.4, 14, 6, 2.5);
const yaws = [0, 30, 60, 90, 120, 150];

const level6: LevelConfig = {
  id: 6,
  name: 'Rotating Light',
  objective: 'Rotate the spotlight until the statue’s shadow crosses the gap.',
  blurb: 'The lamp does not move. Its aim does. Snap it until the beam finds the statue.',
  playerStart: { position: [-1.2, 0.05, -3.2], yaw: facingX() },
  exit: { position: [11, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'spot',
      type: 'spotlight',
      label: 'Spotlight',
      prompt: 'SWIPE TO ROTATE',
      interaction: 'manipulate',
      guide: 'arc',
      position: [-1.5, 3.8, 0],
      yaw: 0,
      pitch: 0.58,
      range: 18,
      cone: 14,
      intensity: 22,
      color: '#d7e6ff',
      states: yaws.map((yaw) => ({ yaw: deg(yaw) })),
      initial: 0,
      interactAt: [-1.5, 0, -2.4],
    }),
  ],
  casters: [
    makeCaster({
      id: 'statue',
      label: 'Statue',
      position: [2.35, 1.35, 0],
      size: [1.15, 2.7, 1.15],
    }),
  ],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-1.6, 0, 2.4])],
  solution: { spot: 3 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [3, 4, 5, 6], 2, course.cols - 2) }],
};

export default level6;
