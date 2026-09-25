import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight } from './helpers';

const course = gapCourse('bridge', -12, -3.6, 0.8, 12);

function toggle(
  id: string,
  label: string,
  position: [number, number, number],
  interactAt: [number, number, number],
  startsOn: boolean,
) {
  return makeLight({
    id,
    label,
    prompt: 'TOGGLE LIGHT',
    interaction: 'toggle',
    position,
    range: id === 'key' ? 22 : 16,
    intensity: 14,
    color: id === 'key' ? '#ffd2a1' : '#9ecbff',
    states: startsOn
      ? [{ enabled: true }, { enabled: false }]
      : [{ enabled: false }, { enabled: true }],
    initial: 0,
    interactAt,
  });
}

const level9: LevelConfig = {
  id: 9,
  name: 'Light Network',
  objective: 'Leave only the lamp that stands behind the monument.',
  blurb: 'A second light does not add a second path. It erases the shadow.',
  playerStart: { position: [-9, 0.05, 3], yaw: facingX() },
  exit: { position: [7, 0.05, 0], radius: 1.15 },
  platforms: course.platforms,
  lights: [
    toggle('key', 'Key lamp', [-9.2, 4.2, 0], [-8.4, 0, 1.6], false),
    toggle('wash-a', 'Wash lamp A', [8.5, 3.2, 2.4], [-8.4, 0, 3.1], true),
    toggle('wash-b', 'Wash lamp B', [8.5, 3.2, -2.4], [-6.6, 0, 3.1], true),
  ],
  casters: [
    makeCaster({
      id: 'monument',
      label: 'Monument',
      position: [-4.15, 1.3, 0],
      size: [1.35, 2.6, 1.3],
    }),
  ],
  surfaces: [course.forge],
  consoles: [consoleAt('forge', 'bridge', [-7.2, 0, -2.8])],
  solution: { key: 1, 'wash-a': 1, 'wash-b': 1 },
  required: [{ surfaceId: 'bridge', cells: band(course.cols, [4, 5, 6, 7], 5, course.cols - 2) }],
};

export default level9;
