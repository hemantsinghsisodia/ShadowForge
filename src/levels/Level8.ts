import type { LevelConfig } from './LevelData';
import { band, consoleAt, facingX, gapCourse, makeCaster, makeLight, perimeter } from './helpers';

const approach = gapCourse('ramp', -14, -3.6, 0.8, 2, 4, 3, false);
const left = gapCourse('corner', 2, 12.2, 13.75, 20, 4, 3, false, 0);
const right = gapCourse('pad', 20, 30.4, 34.8, 40, 4, 3, false, 0);
approach.forge.zone = 'ramp';
approach.forge.kind = 'ramp';
approach.forge.rise = 0.55;

function seat(
  id: string,
  shape: 'box' | 'prism' | 'lshape' | 'cylinder',
  label: string,
  x: number,
  zone: string,
  size: [number, number, number],
) {
  const y = size[1] / 2;
  return makeCaster({
    id,
    shape,
    label,
    prompt: 'MOVE OBJECT',
    interaction: 'manipulate',
    guide: 'nodes',
    position: [x, y, 3.4],
    size,
    zone,
    states: [
      { position: [x, y, 3.4] },
      { position: [x, y, 0] },
    ],
    initial: 0,
    interactAt: [x - 1.6, 0, 2.2],
  });
}

const level8: LevelConfig = {
  id: 8,
  name: 'Shadow Sculptor',
  objective: 'The triangle is the wrong silhouette. Set the plate, the L-block, and the cylinder.',
  blurb: 'A triangle cannot span the ramp. The plate can. Then finish the corner and the round pad.',
  playerStart: { position: [-10, 0.05, 2], yaw: facingX() },
  exit: { position: [37, 0.05, 0], radius: 1.15 },
  platforms: [
    ...approach.platforms,
    ...left.platforms,
    ...right.platforms,
    ...perimeter(-14, 40, -5, 5, 5),
  ],
  lights: [
    makeLight({ id: 'lamp-a', label: 'Ramp lamp', position: [-9.2, 4.15, 0], range: 14, zone: 'ramp' }),
    makeLight({ id: 'lamp-b', label: 'Corner lamp', position: [9.4, 4.15, 0], range: 6.5, zone: 'corner' }),
    makeLight({ id: 'lamp-c', label: 'Pad lamp', position: [26.2, 4.15, 0], range: 11, zone: 'pad' }),
  ],
  casters: [
    makeCaster({
      id: 'wedge',
      shape: 'box',
      label: 'Silhouette pedestal',
      prompt: 'TAP SHAPE',
      interaction: 'manipulate',
      guide: 'nodes',
      position: [-4.55, 1.25, 3.4],
      size: [0.5, 2.5, 2.2],
      zone: 'ramp',
      states: [
        { shape: 'box', position: [-4.55, 1.25, 3.4], size: [0.5, 2.5, 2.2] },
        { shape: 'prism', position: [-4.55, 1.3, 0], size: [0.55, 2.5, 0.35] },
        { shape: 'box', position: [-4.55, 1.25, 0], size: [0.5, 2.5, 2.2] },
      ],
      initial: 0,
      interactAt: [-6.2, 0, 2.2],
    }),
    seat('elbow', 'lshape', 'L-block', 11.35, 'corner', [2.2, 2.6, 2.2]),
    seat('drum', 'cylinder', 'Cylinder', 29.45, 'pad', [1.7, 2.4, 1.7]),
  ],
  surfaces: [approach.forge, { ...left.forge, zone: 'corner' }, { ...right.forge, zone: 'pad' }],
  consoles: [
    consoleAt('forge-ramp', 'ramp', [-10, 0, -2.4]),
    consoleAt('forge-corner', 'corner', [6, 0, -2.4]),
    consoleAt('forge-pad', 'pad', [24, 0, -2.4]),
  ],
  solution: { wedge: 2, elbow: 1, drum: 1 },
  required: [
    { surfaceId: 'ramp', cells: band(approach.cols, [4, 5, 6, 7], 5, approach.cols - 2) },
    { surfaceId: 'corner', cells: band(left.cols, [2, 3, 4, 5, 6, 7, 8, 9], 0, 6) },
    { surfaceId: 'pad', cells: band(right.cols, [4, 5, 6, 7], 5, right.cols - 2) },
  ],
};

export default level8;
