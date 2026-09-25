import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.6, 0.8, 10, 5, 4);

function slider(id: string, x: number, parkedZ: number, seatedZ: number) {
  return makeCaster({
    id,
    label: id === 'left' ? 'Left block' : 'Right block',
    prompt: 'MOVE BLOCK',
    interaction: 'manipulate',
    guide: 'rail',
    position: [x, 1.2, parkedZ],
    size: [0.7, 2.4, 1.15],
    states: [
      { position: [x, 1.2, parkedZ] },
      { position: [x, 1.2, seatedZ] },
    ],
    initial: 0,
    interactAt: [x - 1.5, 0, 2.4],
  });
}

const level5: LevelConfig = {
  id: 5,
  name: 'Multiple Objects',
  objective: 'Slide both blocks until their shadows join into one bridge.',
  blurb: 'One block leaves a hole. The path appears only when the two shadows touch.',
  playerStart: { position: [-8.8, 0.05, 0], yaw: facingX() },
  exit: { position: [6, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    makeLight({
      id: 'lamp',
      label: 'Fixed lamp',
      position: [-9.5, 4.4, 0],
      range: 26,
      intensity: 16,
    }),
  ],
  casters: [slider('left', -4.7, -2.3, -0.62), slider('right', -4.15, 2.3, 0.62)],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-8, 0, -3])],
  solution: { left: 1, right: 1 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [4, 5, 6, 7, 8, 9, 10, 11], 6, course.cols - 1) }],
};

export default level5;
