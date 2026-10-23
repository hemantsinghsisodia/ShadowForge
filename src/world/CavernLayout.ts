import { mulberry32 } from '../core/random';
import { CAMERA_DISTANCE } from '../player/CameraConstants';
import type { PlatformConfig } from '../levels/LevelData';
import { FORGE_KIT, type ForgeKitName } from './ForgeKit';
import type { CavernBounds, CavernDetail } from './ForgeCavern';
import { kitFloorable } from './LabDressing';
import { ABYSS_Y } from './ForgePalette';

/**
 * Pure placement of the cavern's industrial structures around a level. Nothing here touches three.js
 * render objects; a later task turns these records into instanced meshes.
 *
 * Piece assumptions (measured from public/models/environment/SHADOWFORGE_EnvKit.glb, every node at the
 * origin, centred on X/Z, base at local y = 0 unless noted):
 *  - Pillar (SHF_Pillar_A):     0.56 x 0.56 footprint, 3.08 tall.      top = position.y + 3.08 * scaleY
 *  - Beam (SHF_Structure_Beam): X -1..1, 0.22 deep, 0.2 tall.          top = position.y + 0.2 * scaleY
 *  - Tray (SHF_Structure_CableTray): X -1..1, 0.22 deep, 0.095 tall.   top = position.y + 0.1 * scaleY (rounded up)
 *  - Lamp (SHF_Lamp_Industrial): 0.34 footprint, 1.78 tall.            top = position.y + 1.78 * scaleY
 *  - Floor_Edge (SHF_Floor_Edge): X -1..1, Y -0.5..0, Z -0.12..0.14; its trim plate and amber stripe are on the -Z face
 *    (the outer face). Not placed here; see exposedRims and LabDressing.rimPlacements.
 * Beams and trays are placed with rotationY 0 so they always run along X; their scale Y and Z stay 1.
 *
 * Safety rules, enforced by construction and by tests/cavernLayout.test.ts:
 *  (a) every placement that is not a 'support' has |z - midZ| >= halfDepth + CAMERA_BAND (the tests check every non-support piece);
 *  (b) under-slab support tops are <= their slab's bottom;
 *  (c) nothing above the floor spans the corridor footprint [minZ, maxZ].
 * Rule (a) exists to keep pieces out from between the camera and the player. Pieces with role 'support'
 * lie entirely inside their own slab's XZ footprint (inset 0.6, wider than any piece), beneath the slab,
 * and the camera is always above the floor, so they cannot occlude and are exempt from (a). Rule (b)
 * and footprint containment govern them instead. Every other role ('tower', 'link') obeys (a).
 * Supports are visual only (no collision), so only slabs with bottom <= 0 get them, and any single piece whose
 * column from the abyss to its top would pass through another platform's footprint is dropped.
 */

export interface Placement {
  piece: ForgeKitName;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  /** World Y of the piece's highest point after scaling. */
  top: number;
  /** 'support' pieces sit under their own slab and are exempt from rule (a); see the file header. 'rim' marks slab-edge lips (see exposedRims), which placeStructures never returns. */
  role: 'support' | 'tower' | 'link' | 'rim';
}

export interface Rim {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** World Y of the slab top the rim sits on. */
  y: number;
  /** Slab height. */
  thick: number;
  /** Unit XZ normal pointing away from the slab. */
  outward: [number, number];
}

/** Camera distance in player/CameraRig. */
export const CAMERA_REACH = CAMERA_DISTANCE;
/** Half-width of the keep-clear band either side of the corridor edge. Must exceed CAMERA_REACH, or pieces can sit between the camera and the player. */
export const CAMERA_BAND = 7;

const PILLAR_H = 3.08;
const BEAM_H = 0.2;
const TRAY_H = 0.1;
const LAMP_H = 1.78;
const INSET = 0.6;
/** Closer than this, two 0.56 m pillars would overlap. */
const MIN_COLUMN_GAP = 0.6;
/** Half the diagonal of the 0.56 m pillar: its XZ reach at any yaw. */
const PILLAR_REACH = 0.4;
const BEAM_HALF_Z = 0.11;
const SUPPORT_SPACING = 6;
const TOWER_SPACING = 12;
const TOWER_OVERSHOOT = 10;
const TOWER_OFFSET = 9;
const TOWER_TOP = 1;
/** Height of the beams that link neighbouring towers. */
export const BEAM_Y = 0.6;
const TRAY_Y = 0.3;
const RIM_EPS = 0.05;
const MIN_SEGMENT = 0.01;

/** The XZ extent of a level, taken over every platform. Infinite (min > max) when there are no platforms. */
export function levelBounds(platforms: PlatformConfig[]): CavernBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const platform of platforms) {
    minX = Math.min(minX, platform.position[0] - platform.size[0] / 2);
    maxX = Math.max(maxX, platform.position[0] + platform.size[0] / 2);
    minZ = Math.min(minZ, platform.position[2] - platform.size[2] / 2);
    maxZ = Math.max(maxZ, platform.position[2] + platform.size[2] / 2);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Half extent of the sun's shadow box when the level fits around the origin. */
const SUN_FRAME_HALF = 40;
const SUN_FRAME_MARGIN = 4;

/**
 * The X range the sun's shadow camera covers. Levels that fit the original box around the origin keep it
 * exactly (centre 0, half 40); longer or off-centre levels re-centre on the level and widen to fit.
 */
export function sunShadowFrame(bounds: CavernBounds): { centreX: number; halfX: number } {
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) return { centreX: 0, halfX: SUN_FRAME_HALF };
  const half = (bounds.maxX - bounds.minX) / 2;
  const mid = (bounds.minX + bounds.maxX) / 2;
  if (Math.abs(mid) + half + SUN_FRAME_MARGIN <= SUN_FRAME_HALF) return { centreX: 0, halfX: SUN_FRAME_HALF };
  return { centreX: mid, halfX: Math.max(SUN_FRAME_HALF, half + SUN_FRAME_MARGIN) };
}

/** Centre line and half width of the play corridor along Z. */
export function corridor(bounds: CavernBounds): { midZ: number; halfDepth: number } {
  return { midZ: (bounds.minZ + bounds.maxZ) / 2, halfDepth: (bounds.maxZ - bounds.minZ) / 2 };
}

/** Evenly spaced points from a to b inclusive, no further apart than SUPPORT_SPACING (and at least minSegments apart-steps). */
function along(a: number, b: number, minSegments = 1): number[] {
  const segments = Math.max(minSegments, Math.ceil((b - a) / SUPPORT_SPACING - 1e-9));
  return Array.from({ length: segments + 1 }, (_, i) => a + ((b - a) * i) / segments);
}

/** True if a column with this XZ half-extent, from the abyss up to `top`, runs through another platform's footprint. */
function pierces(x: number, z: number, halfX: number, halfZ: number, top: number, others: PlatformConfig[]): boolean {
  return others.some(
    (o) =>
      o.position[1] - o.size[1] / 2 < top - 1e-9 &&
      x + halfX > o.position[0] - o.size[0] / 2 + 1e-9 &&
      x - halfX < o.position[0] + o.size[0] / 2 - 1e-9 &&
      z + halfZ > o.position[2] - o.size[2] / 2 + 1e-9 &&
      z - halfZ < o.position[2] + o.size[2] / 2 - 1e-9,
  );
}

function supports(slab: PlatformConfig, others: PlatformConfig[], rand: () => number, full: boolean): Placement[] {
  const [w, h, d] = slab.size;
  const bottom = slab.position[1] - h / 2;
  // Only floor-level slabs get supports. Under a raised slab a pillar would run up through the walkable floor.
  if (bottom > 0 || bottom <= ABYSS_Y + 1) return [];
  const x0 = slab.position[0] - w / 2 + INSET;
  const x1 = slab.position[0] + w / 2 - INSET;
  const z0 = slab.position[2] - d / 2 + INSET;
  const z1 = slab.position[2] + d / 2 - INSET;
  const scaleY = (bottom - ABYSS_Y) / PILLAR_H;
  const spots = new Map<string, [number, number]>();
  const add = (x: number, z: number) => spots.set(`${x.toFixed(3)},${z.toFixed(3)}`, [x, z]);
  // Edges longer than SUPPORT_SPACING get intermediate pillars, so no run exceeds that gap.
  // A slab only 1.2 m across has its two corner columns collapse into one; lengthen the other axis to keep 4 pillars.
  const narrowX = x1 - x0 < MIN_COLUMN_GAP;
  const narrowZ = z1 - z0 < MIN_COLUMN_GAP;
  const xs = full && (w > SUPPORT_SPACING || narrowZ) ? along(x0, x1, narrowZ ? 3 : 1) : [x0, x1];
  const zs = full && (d > SUPPORT_SPACING || narrowX) ? along(z0, z1, narrowX ? 3 : 1) : [z0, z1];
  for (const x of xs) {
    add(x, z0);
    add(x, z1);
  }
  for (const z of zs) {
    add(x0, z);
    add(x1, z);
  }
  const out: Placement[] = [];
  for (const [x, z] of spots.values()) {
    // Worst-case half-extent of a yawed pillar. Pieces that would pass through another platform are dropped.
    if (pierces(x, z, PILLAR_REACH, PILLAR_REACH, bottom, others)) continue;
    out.push({
      piece: FORGE_KIT.pillar,
      position: [x, ABYSS_Y, z],
      rotationY: rand() * Math.PI * 0.5,
      scale: [1, scaleY, 1],
      top: bottom,
      role: 'support',
    });
  }
  const span = x1 - x0;
  const y = bottom - 0.4;
  if (full && span >= 0.5) {
    // On a slab too narrow for two distinct beam lines, one beam at their midpoint replaces the pair.
    const beamZs = z1 - z0 < 0.3 ? [(z0 + z1) / 2] : [z0, z1];
    for (const z of beamZs) {
      if (pierces(slab.position[0], z, span / 2, BEAM_HALF_Z, y + BEAM_H, others)) continue;
      out.push({
        piece: FORGE_KIT.beam,
        position: [slab.position[0], y, z],
        rotationY: 0,
        scale: [span / 2, 1, 1],
        top: y + BEAM_H,
        role: 'support',
      });
    }
  }
  return out;
}

export interface TowerSite {
  x: number;
  z: number;
  /** +1 on the +Z side of the corridor, -1 on the -Z side. */
  side: 1 | -1;
}

/**
 * Where the lamp towers stand: alternating sides along X, TOWER_SPACING apart, TOWER_OFFSET beyond the corridor edge.
 * Empty on low. Medium drops every third site (index % 3 === 1), which keeps both sides and the whole X range covered.
 */
export function towerSites(bounds: CavernBounds, detail: CavernDetail): TowerSite[] {
  if (detail === 'low') return [];
  const { midZ, halfDepth } = corridor(bounds);
  const firstX = bounds.minX - TOWER_OVERSHOOT;
  const lastX = bounds.maxX + TOWER_OVERSHOOT;
  const out: TowerSite[] = [];
  for (let i = 0; firstX + i * TOWER_SPACING <= lastX; i++) {
    if (detail === 'medium' && i % 3 === 1) continue;
    const side = i % 2 === 0 ? 1 : -1;
    out.push({ x: firstX + i * TOWER_SPACING, z: midZ + side * (halfDepth + TOWER_OFFSET), side });
  }
  return out;
}

function towers(bounds: CavernBounds, detail: CavernDetail, rand: () => number): Placement[] {
  const scaleY = (TOWER_TOP - ABYSS_Y) / PILLAR_H;
  const bySide: [number, number][][] = [[], []];
  const out: Placement[] = [];
  for (const { x, z, side } of towerSites(bounds, detail)) {
    bySide[side === 1 ? 0 : 1].push([x, z]);
    out.push({
      piece: FORGE_KIT.pillar,
      position: [x, ABYSS_Y, z],
      rotationY: rand() * Math.PI * 0.5,
      scale: [1, scaleY, 1],
      top: ABYSS_Y + PILLAR_H * scaleY,
      role: 'tower',
    });
    out.push({
      piece: FORGE_KIT.lamp,
      position: [x, TOWER_TOP, z],
      rotationY: rand() * Math.PI * 2,
      scale: [1, 1, 1],
      top: TOWER_TOP + LAMP_H,
      role: 'tower',
    });
  }
  for (const side of bySide) {
    for (let i = 1; i < side.length; i++) {
      const [xa, z] = side[i - 1];
      const [xb] = side[i];
      const scale: [number, number, number] = [(xb - xa) / 2, 1, 1];
      const x = (xa + xb) / 2;
      out.push({ piece: FORGE_KIT.beam, position: [x, BEAM_Y, z], rotationY: 0, scale, top: BEAM_Y + BEAM_H, role: 'link' });
      out.push({ piece: FORGE_KIT.tray, position: [x, TRAY_Y, z], rotationY: 0, scale, top: TRAY_Y + TRAY_H, role: 'link' });
    }
  }
  return out;
}

/**
 * Support pillars and cross beams under the floor slabs, plus lamp-topped towers with linking beams and
 * trays along both sides of the corridor. Low returns nothing; medium halves the towers and keeps only corner
 * supports (no intermediate pillars, no cross beams).
 * Deterministic per seed (the seed only jitters yaw).
 */
export function placeStructures(bounds: CavernBounds, slabs: PlatformConfig[], detail: CavernDetail, seed: number): Placement[] {
  if (detail === 'low') return [];
  const rand = mulberry32(seed);
  const out: Placement[] = [];
  slabs.forEach((slab, i) => {
    if (kitFloorable(slab)) {
      out.push(...supports(slab, slabs.filter((_, j) => j !== i), rand, detail === 'high'));
    }
  });
  out.push(...towers(bounds, detail, rand));
  const rail = railLine(bounds, detail);
  if (rail) {
    const side = rail.z < corridor(bounds).midZ ? -1 : 1;
    out.push(...railPlacements(rail, detail === 'medium' ? MEDIUM_RAIL_COLUMN_SPACING : RAIL_COLUMN_SPACING, side));
  }
  return out;
}

/** Rail beam height (the gantry rides here). Low enough that the trolley and its sparks sit inside the camera frustum. */
export const RAIL_Y = 6;
/** The rail runs this far beyond the corridor edge on the +Z side. Not 9: that is where the +Z lamp towers stand. */
export const RAIL_OFFSET = 10;
/** Gantry trolley speed along the rail, m/s. */
export const GANTRY_SPEED = 0.8;
/** Seconds the trolley holds at each end of the rail. */
export const GANTRY_PAUSE = 2;
const RAIL_EXTEND = 4;
const RAIL_COLUMN_SPACING = 12;
/** Medium thins the rail columns (the rail line itself is shared with high) to stay within 60% of high's piece count. */
const MEDIUM_RAIL_COLUMN_SPACING = 24;
const CHAIN_CEILING_Y = 14;
const CHAIN_FAR_OFFSET = 12;
/** Rail columns stand this far back from the trolley line (away from the corridor), so the hanging chain, hook and sparks clear them. */
const RAIL_COLUMN_SETBACK = 0.6;
/** Rail-hung chains keep at least this much x clearance from every rail column and +Z tower. */
const CHAIN_CLEARANCE = 1.0;
/** Nudged chains land this much beyond the clearance, so rounding cannot undercut it. */
const CHAIN_CLEARANCE_MARGIN = 0.05;
const CHAIN_COUNT = { medium: 6, high: 10 } as const;

export interface Rail {
  x0: number;
  x1: number;
  z: number;
  y: number;
}

/**
 * The gantry rail along the +Z side: the tower x range (always taken from the high-detail sites, so medium and high share
 * one rail) extended by 4 m each way, RAIL_OFFSET beyond the corridor edge. Null on low.
 */
export function railLine(bounds: CavernBounds, detail: CavernDetail): Rail | null {
  if (detail === 'low') return null;
  const sites = towerSites(bounds, 'high');
  if (sites.length === 0) return null;
  const { midZ, halfDepth } = corridor(bounds);
  const xs = sites.map((s) => s.x);
  return { x0: Math.min(...xs) - RAIL_EXTEND, x1: Math.max(...xs) + RAIL_EXTEND, z: midZ + halfDepth + RAIL_OFFSET, y: RAIL_Y };
}

/** The x positions of the rail columns: every `spacing` m from x0, and always x1, so the last gap may be shorter. */
function railColumnXs(rail: Rail, spacing: number): number[] {
  const xs: number[] = [];
  for (let x = rail.x0; x < rail.x1 - 1e-9; x += spacing) xs.push(x);
  xs.push(rail.x1);
  return xs;
}

/**
 * Pillar columns from the abyss up to the rail every `spacing` m (12 by default). Both ends are always included, so the last gap
 * may be shorter. A beam links each neighbouring pair at rail height. The columns stand RAIL_COLUMN_SETBACK m back from the
 * trolley line, on `side` (+1 when the rail is on the +Z side of the corridor, -1 on the -Z side), so nothing hanging from the
 * rail passes through them; the beams stay on the line itself.
 */
export function railPlacements(rail: Rail, spacing = RAIL_COLUMN_SPACING, side: 1 | -1 = 1): Placement[] {
  const span = rail.x1 - rail.x0;
  const xs = railColumnXs(rail, spacing);
  const scaleY = (rail.y - ABYSS_Y) / PILLAR_H;
  const out: Placement[] = xs.map((x) => ({
    piece: FORGE_KIT.pillar,
    position: [x, ABYSS_Y, rail.z + RAIL_COLUMN_SETBACK * side],
    rotationY: 0,
    scale: [1, scaleY, 1],
    top: rail.y,
    role: 'tower',
  }));
  if (span <= 0) return out;
  for (let i = 1; i < xs.length; i++) {
    const length = xs[i] - xs[i - 1];
    out.push({
      piece: FORGE_KIT.beam,
      position: [(xs[i] + xs[i - 1]) / 2, rail.y, rail.z],
      rotationY: 0,
      scale: [length / 2, 1, 1],
      top: rail.y + BEAM_H,
      role: 'link',
    });
  }
  return out;
}

/** The part of the rail the trolley travels: its forward half, [(x0 + x1) / 2, x1]. The rail and its columns stay full length. */
export function trolleyRange(rail: Rail): { x0: number; x1: number } {
  return { x0: (rail.x0 + rail.x1) / 2, x1: rail.x1 };
}

/**
 * Trolley x at time t over trolleyRange(rail): start -> end at GANTRY_SPEED, hold GANTRY_PAUSE, back, hold. Closed form with a
 * positive modulo, so the GLSL mirror is a plain `mod` and four `if`s. Period = 2 * (len / GANTRY_SPEED + GANTRY_PAUSE), len being
 * the trolley range's length.
 */
export function gantryX(t: number, rail: Rail): number {
  const { x0, x1 } = trolleyRange(rail);
  const travel = (x1 - x0) / GANTRY_SPEED;
  const period = 2 * (travel + GANTRY_PAUSE);
  const u = ((t % period) + period) % period;
  if (u < travel) return x0 + GANTRY_SPEED * u;
  if (u < travel + GANTRY_PAUSE) return x1;
  if (u < 2 * travel + GANTRY_PAUSE) return x1 - GANTRY_SPEED * (u - travel - GANTRY_PAUSE);
  return x0;
}

/** Pendulum angle in radians. */
export function swayAngle(t: number, phase: number, amp: number, period: number): number {
  return amp * Math.sin((2 * Math.PI * t) / period + phase);
}

export interface ChainSite {
  x: number;
  z: number;
  pivotY: number;
  length: number;
  phase: number;
  amp: number;
  period: number;
}

/** x, or the nearest x in the rail range at least CHAIN_CLEARANCE from every obstacle when x starts too close to one. Deterministic. */
function clearOf(x: number, obstacles: number[], rail: Rail): number {
  const gap = CHAIN_CLEARANCE + CHAIN_CLEARANCE_MARGIN;
  const free = (c: number) => c >= rail.x0 && c <= rail.x1 && obstacles.every((o) => Math.abs(c - o) >= CHAIN_CLEARANCE);
  if (free(x)) return x;
  const candidates = obstacles.flatMap((o) => [o - gap, o + gap]).filter(free);
  if (candidates.length === 0) return x;
  return candidates.reduce((best, c) => (Math.abs(c - x) < Math.abs(best - x) ? c : best));
}

/**
 * Hanging chains. Medium 6, high 10, low 0. The first half hang from the rail; the rest hang from the dark ceiling on the -Z
 * side. x is spread evenly (cell centres) along the rail's range; a rail-hung chain that would hang within CHAIN_CLEARANCE of a
 * rail column or a +Z tower is nudged to the nearest free x. Length, amp, period and phase are seeded.
 */
export function chainSites(bounds: CavernBounds, detail: CavernDetail, seed: number): ChainSite[] {
  const rail = railLine(bounds, detail);
  if (!rail || detail === 'low') return [];
  const count = CHAIN_COUNT[detail];
  const half = count / 2;
  const { midZ, halfDepth } = corridor(bounds);
  const rand = mulberry32(seed);
  const spacing = detail === 'medium' ? MEDIUM_RAIL_COLUMN_SPACING : RAIL_COLUMN_SPACING;
  // Medium's tower sites are a subset of high's, so clearing the high set clears both.
  const obstacles = [...railColumnXs(rail, spacing), ...towerSites(bounds, 'high').filter((t) => t.side === 1).map((t) => t.x)];
  const out: ChainSite[] = [];
  for (let i = 0; i < count; i++) {
    const onRail = i < half;
    const k = onRail ? i : i - half;
    const cellX = rail.x0 + ((k + 0.5) / half) * (rail.x1 - rail.x0);
    const length = 4 + rand() * 3;
    const amp = 0.05 + rand() * 0.04;
    const period = 5 + rand() * 3;
    const phase = rand() * Math.PI * 2;
    out.push({
      x: onRail ? clearOf(cellX, obstacles, rail) : cellX,
      z: onRail ? rail.z : midZ - (halfDepth + CHAIN_FAR_OFFSET),
      pivotY: onRail ? RAIL_Y : CHAIN_CEILING_Y,
      length,
      phase,
      amp,
      period,
    });
  }
  return out;
}

interface Edge {
  /** Direction the edge runs: 'x' edges have a fixed z, 'z' edges a fixed x. */
  axis: 'x' | 'z';
  line: number;
  a: number;
  b: number;
  sign: 1 | -1;
  y: number;
  thick: number;
}

function edgesOf(slab: PlatformConfig): Edge[] {
  const [px, py, pz] = slab.position;
  const [w, h, d] = slab.size;
  const y = py + h / 2;
  return [
    { axis: 'x', line: pz - d / 2, a: px - w / 2, b: px + w / 2, sign: -1, y, thick: h },
    { axis: 'x', line: pz + d / 2, a: px - w / 2, b: px + w / 2, sign: 1, y, thick: h },
    { axis: 'z', line: px - w / 2, a: pz - d / 2, b: pz + d / 2, sign: -1, y, thick: h },
    { axis: 'z', line: px + w / 2, a: pz - d / 2, b: pz + d / 2, sign: 1, y, thick: h },
  ];
}

/**
 * The top-edge segments of floor slabs that no neighbouring slab covers. An edge is hidden where another
 * slab's edge lies on the same line (within 0.05 m), faces the opposite way and sits at the same top height.
 * Partial overlaps are split, so only the uncovered remainder is returned.
 */
export function exposedRims(slabs: PlatformConfig[]): Rim[] {
  const edges = slabs.filter(kitFloorable).map(edgesOf);
  const rims: Rim[] = [];
  edges.forEach((own, i) => {
    for (const edge of own) {
      const cuts: [number, number][] = [];
      edges.forEach((other, j) => {
        if (i === j) return;
        for (const o of other) {
          if (o.axis !== edge.axis || o.sign === edge.sign) continue;
          if (Math.abs(o.line - edge.line) > RIM_EPS || Math.abs(o.y - edge.y) > RIM_EPS) continue;
          const lo = Math.max(edge.a, o.a);
          const hi = Math.min(edge.b, o.b);
          if (hi > lo) cuts.push([lo, hi]);
        }
      });
      cuts.sort((p, q) => p[0] - q[0]);
      const outward: [number, number] = edge.axis === 'x' ? [0, edge.sign] : [edge.sign, 0];
      const keep = (from: number, to: number) => {
        if (to - from <= MIN_SEGMENT) return;
        rims.push(
          edge.axis === 'x'
            ? { x0: from, z0: edge.line, x1: to, z1: edge.line, y: edge.y, thick: edge.thick, outward }
            : { x0: edge.line, z0: from, x1: edge.line, z1: to, y: edge.y, thick: edge.thick, outward },
        );
      };
      let cursor = edge.a;
      for (const [lo, hi] of cuts) {
        keep(cursor, lo);
        cursor = Math.max(cursor, hi);
      }
      keep(cursor, edge.b);
    }
  });
  return rims;
}
