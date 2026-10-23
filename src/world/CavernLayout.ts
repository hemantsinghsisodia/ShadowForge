import { mulberry32 } from '../core/random';
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
 *  - Floor_Edge (SHF_Floor_Edge): X -1..1, Y -0.5..0, Z -0.12..0.14. Not placed here; see exposedRims.
 * Beams and trays are placed with rotationY 0 so they always run along X; their scale Y and Z stay 1.
 *
 * Safety rules, enforced by construction and by tests/cavernLayout.test.ts:
 *  (a) every placement that is not a 'support' has |z - midZ| >= halfDepth + 7 (tests also check top > -0.6 pieces);
 *  (b) under-slab support tops are <= their slab's bottom;
 *  (c) nothing above the floor spans the corridor footprint [minZ, maxZ].
 * Rule (a) exists to keep pieces out from between the camera and the player. Pieces with role 'support'
 * lie entirely inside their own slab's XZ footprint (inset 0.6, wider than any piece), beneath the slab,
 * and the camera is always above the floor, so they cannot occlude and are exempt from (a). Rule (b)
 * and footprint containment govern them instead. Every other role ('tower', 'link') obeys (a).
 */

export interface Placement {
  piece: ForgeKitName;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  /** World Y of the piece's highest point after scaling. */
  top: number;
  /** 'support' pieces sit under their own slab and are exempt from rule (a); see the file header. */
  role: 'support' | 'tower' | 'link';
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

const PILLAR_H = 3.08;
const BEAM_H = 0.2;
const TRAY_H = 0.1;
const LAMP_H = 1.78;
const INSET = 0.6;
/** Closer than this, two 0.56 m pillars would overlap. */
const MIN_COLUMN_GAP = 0.6;
const SUPPORT_SPACING = 6;
const TOWER_SPACING = 12;
const TOWER_OVERSHOOT = 10;
const TOWER_OFFSET = 9;
const TOWER_TOP = 1;
const BEAM_Y = 0.6;
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

/** Centre line and half width of the play corridor along Z. */
export function corridor(bounds: CavernBounds): { midZ: number; halfDepth: number } {
  return { midZ: (bounds.minZ + bounds.maxZ) / 2, halfDepth: (bounds.maxZ - bounds.minZ) / 2 };
}

/** Evenly spaced points from a to b inclusive, no further apart than SUPPORT_SPACING (and at least minSegments apart-steps). */
function along(a: number, b: number, minSegments = 1): number[] {
  const segments = Math.max(minSegments, Math.ceil((b - a) / SUPPORT_SPACING - 1e-9));
  return Array.from({ length: segments + 1 }, (_, i) => a + ((b - a) * i) / segments);
}

function supports(slab: PlatformConfig, rand: () => number, full: boolean): Placement[] {
  const [w, h, d] = slab.size;
  const bottom = slab.position[1] - h / 2;
  if (bottom <= ABYSS_Y + 1) return [];
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
    for (const z of [z0, z1]) {
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

function towers(bounds: CavernBounds, detail: CavernDetail, rand: () => number): Placement[] {
  const { midZ, halfDepth } = corridor(bounds);
  const scaleY = (TOWER_TOP - ABYSS_Y) / PILLAR_H;
  const firstX = bounds.minX - TOWER_OVERSHOOT;
  const lastX = bounds.maxX + TOWER_OVERSHOOT;
  const bySide: [number, number][][] = [[], []];
  const out: Placement[] = [];
  for (let i = 0; firstX + i * TOWER_SPACING <= lastX; i++) {
    const side = i % 2;
    // Medium keeps every other tower on each side.
    if (detail === 'medium' && Math.floor(i / 2) % 2 === 1) continue;
    const x = firstX + i * TOWER_SPACING;
    const z = midZ + (side === 0 ? 1 : -1) * (halfDepth + TOWER_OFFSET);
    bySide[side].push([x, z]);
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
  for (const slab of slabs) {
    if (kitFloorable(slab)) out.push(...supports(slab, rand, detail === 'high'));
  }
  out.push(...towers(bounds, detail, rand));
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
