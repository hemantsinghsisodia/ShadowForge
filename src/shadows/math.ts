import type { CasterVolume, LightVolume, Rect, SolidBox, SurfaceDef, Vec3 } from './types';

const EPS = 1e-8;

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < EPS) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Inverse of a yaw rotation about Y (object rotated by +yaw). */
export function worldOffsetToLocal(dx: number, dy: number, dz: number, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dz * s, y: dy, z: dx * s + dz * c };
}

export function cellCenter(surface: SurfaceDef, col: number, row: number): Vec3 {
  const u = (col + 0.5) * surface.cell - surface.sizeU / 2;
  const v = (row + 0.5) * surface.cell - surface.sizeV / 2;
  const p = {
    x: surface.origin.x + surface.axisU.x * u + surface.axisV.x * v,
    y: surface.origin.y + surface.axisU.y * u + surface.axisV.y * v,
    z: surface.origin.z + surface.axisU.z * u + surface.axisV.z * v,
  };
  if (surface.kind === 'stairs') {
    p.y = surface.origin.y + ((row + 1) / surface.rows) * surface.rise;
  }
  return p;
}

export function segmentHitsAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  tMin = 0,
  tMax = 1,
): boolean {
  let t0 = tMin;
  let t1 = tMax;
  const slabs: [number, number, number, number][] = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [origin, delta, mn, mx] of slabs) {
    if (Math.abs(delta) < EPS) {
      if (origin < mn || origin > mx) return false;
      continue;
    }
    let a = (mn - origin) / delta;
    let b = (mx - origin) / delta;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

function intervalHitsY(
  oy: number,
  dy: number,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  seg0: number,
  seg1: number,
): boolean {
  let a = t0;
  let b = t1;
  if (Math.abs(dy) < EPS) {
    if (oy < y0 || oy > y1) return false;
  } else {
    let ya = (y0 - oy) / dy;
    let yb = (y1 - oy) / dy;
    if (ya > yb) {
      const swap = ya;
      ya = yb;
      yb = swap;
    }
    a = Math.max(a, ya);
    b = Math.min(b, yb);
  }
  a = Math.max(a, seg0);
  b = Math.min(b, seg1);
  return a <= b;
}

function hitsCylinder(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  radius: number,
  sy: number,
  tMin: number,
  tMax: number,
): boolean {
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radius * radius;
  let enter = tMin;
  let exit = tMax;
  if (a < EPS) {
    if (c > 0) return false;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const s = Math.sqrt(disc);
    enter = (-b - s) / (2 * a);
    exit = (-b + s) / (2 * a);
  }
  return intervalHitsY(oy, dy, enter, exit, -sy / 2, sy / 2, tMin, tMax);
}

function prismVerts(sx: number, sz: number): [number, number][] {
  return [
    [-sx / 2, -sz / 2],
    [sx / 2, -sz / 2],
    [0, sz / 2],
  ];
}

function clipHalfPlane(t0: number, t1: number, c0: number, c1: number): [number, number] | null {
  if (Math.abs(c0 - c1) < 1e-10) {
    return c0 < -1e-5 ? null : [t0, t1];
  }
  const t = c0 / (c0 - c1);
  if (c0 < 0 && c1 < 0) return null;
  if (c0 >= 0 && c1 >= 0) return [t0, t1];
  if (c0 < 0) {
    const nt0 = Math.max(t0, t);
    return nt0 > t1 ? null : [nt0, t1];
  }
  const nt1 = Math.min(t1, t);
  return t0 > nt1 ? null : [t0, nt1];
}

function hitsPrism(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  sx: number,
  sy: number,
  sz: number,
  tMin: number,
  tMax: number,
): boolean {
  const verts = prismVerts(sx, sz);
  const x1 = ox + dx;
  const z1 = oz + dz;
  let span: [number, number] | null = [0, 1];
  for (let i = 0; i < 3; i++) {
    if (!span) return false;
    const ax = verts[i][0];
    const az = verts[i][1];
    const bx = verts[(i + 1) % 3][0];
    const bz = verts[(i + 1) % 3][1];
    const ex = bx - ax;
    const ez = bz - az;
    const c0 = ex * (oz - az) - ez * (ox - ax);
    const c1 = ex * (z1 - az) - ez * (x1 - ax);
    span = clipHalfPlane(span[0], span[1], c0, c1);
  }
  if (!span) return false;
  return intervalHitsY(oy, dy, span[0], span[1], -sy / 2, sy / 2, tMin, tMax);
}

export function segmentHitsCaster(
  lx: number,
  ly: number,
  lz: number,
  px: number,
  py: number,
  pz: number,
  caster: CasterVolume,
  tMin = 0.015,
  tMax = 0.985,
): boolean {
  const dx = px - lx;
  const dy = py - ly;
  const dz = pz - lz;
  const o = worldOffsetToLocal(lx - caster.cx, ly - caster.cy, lz - caster.cz, caster.yaw);
  const d = worldOffsetToLocal(dx, dy, dz, caster.yaw);
  const hx = caster.sx / 2;
  const hy = caster.sy / 2;
  const hz = caster.sz / 2;
  if (caster.kind === 'box') {
    return segmentHitsAabb(o.x, o.y, o.z, d.x, d.y, d.z, -hx, -hy, -hz, hx, hy, hz, tMin, tMax);
  }
  if (caster.kind === 'lshape') {
    const t = Math.min(caster.sx, caster.sz) * 0.42;
    const stem = segmentHitsAabb(o.x, o.y, o.z, d.x, d.y, d.z, -hx, -hy, -hz, -hx + t, hy, hz, tMin, tMax);
    const foot = segmentHitsAabb(o.x, o.y, o.z, d.x, d.y, d.z, -hx, -hy, -hz, hx, hy, -hz + t, tMin, tMax);
    return stem || foot;
  }
  if (caster.kind === 'cylinder') {
    return hitsCylinder(o.x, o.y, o.z, d.x, d.y, d.z, Math.max(hx, hz), caster.sy, tMin, tMax);
  }
  return hitsPrism(o.x, o.y, o.z, d.x, d.y, d.z, caster.sx, caster.sy, caster.sz, tMin, tMax);
}

function lightReaches(light: LightVolume, p: Vec3): boolean {
  const dx = p.x - light.x;
  const dy = p.y - light.y;
  const dz = p.z - light.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > light.range || dist < 1e-4) return false;
  if (!light.spot) return true;
  const inv = 1 / dist;
  const facing = dx * inv * light.spot.dx + dy * inv * light.spot.dy + dz * inv * light.spot.dz;
  return facing >= light.spot.cosLimit;
}

/** 1 where a cell is in forgeable shadow. Dark and washed-out cells stay 0. */
export function computeShadowMask(surface: SurfaceDef, lights: LightVolume[], casters: CasterVolume[]): Uint8Array {
  const mask = new Uint8Array(surface.cols * surface.rows);
  const active = lights.filter((light) => light.enabled);
  for (let row = 0; row < surface.rows; row++) {
    for (let col = 0; col < surface.cols; col++) {
      const p = cellCenter(surface, col, row);
      let reached = 0;
      let blocked = 0;
      for (const light of active) {
        if (!lightReaches(light, p)) continue;
        reached++;
        for (const caster of casters) {
          if (segmentHitsCaster(light.x, light.y, light.z, p.x, p.y, p.z, caster)) {
            blocked++;
            break;
          }
        }
      }
      if (reached > 0 && blocked === reached) mask[row * surface.cols + col] = 1;
    }
  }
  return mask;
}

export function maskAscii(mask: Uint8Array, cols: number, rows: number): string {
  const lines: string[] = [];
  for (let row = rows - 1; row >= 0; row--) {
    let line = '';
    for (let col = 0; col < cols; col++) line += mask[row * cols + col] ? '#' : '.';
    lines.push(line);
  }
  return lines.join('\n');
}

export function greedyRects(mask: Uint8Array, cols: number, rows: number): Rect[] {
  const used = new Uint8Array(mask.length);
  const rects: Rect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const start = row * cols + col;
      if (!mask[start] || used[start]) continue;
      let w = 1;
      while (col + w < cols && mask[start + w] && !used[start + w]) w++;
      let h = 1;
      let blocked = false;
      while (row + h < rows && !blocked) {
        for (let k = 0; k < w; k++) {
          const index = (row + h) * cols + col + k;
          if (!mask[index] || used[index]) {
            blocked = true;
            break;
          }
        }
        if (!blocked) h++;
      }
      for (let rr = 0; rr < h; rr++) {
        for (let cc = 0; cc < w; cc++) used[(row + rr) * cols + col + cc] = 1;
      }
      rects.push({ c: col, r: row, w, h });
    }
  }
  return rects;
}

function uAt(surface: SurfaceDef, col: number): number {
  return col * surface.cell - surface.sizeU / 2;
}

function vAt(surface: SurfaceDef, row: number): number {
  return row * surface.cell - surface.sizeV / 2;
}

function pointAt(surface: SurfaceDef, u: number, v: number, y?: number): Vec3 {
  const p = {
    x: surface.origin.x + surface.axisU.x * u + surface.axisV.x * v,
    y: surface.origin.y + surface.axisU.y * u + surface.axisV.y * v,
    z: surface.origin.z + surface.axisU.z * u + surface.axisV.z * v,
  };
  if (y !== undefined) p.y = y;
  return p;
}

function boundsOf(points: Vec3[]): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function rectCorners(surface: SurfaceDef, col: number, row: number, w: number, h: number): Vec3[] {
  const u0 = uAt(surface, col);
  const u1 = uAt(surface, col + w);
  const v0 = vAt(surface, row);
  const v1 = vAt(surface, row + h);
  return [pointAt(surface, u0, v0), pointAt(surface, u1, v0), pointAt(surface, u0, v1), pointAt(surface, u1, v1)];
}

const EXTRUDE = 0.46;

export function maskToBoxes(surface: SurfaceDef, solid: Uint8Array): SolidBox[] {
  if (surface.kind === 'ramp' || surface.kind === 'stairs') return rowBoxes(surface, solid);
  const boxes: SolidBox[] = [];
  for (const rect of greedyRects(solid, surface.cols, surface.rows)) {
    boxes.push(rectToBox(surface, rect.c, rect.r, rect.w, rect.h));
  }
  return boxes;
}

function rectToBox(surface: SurfaceDef, col: number, row: number, w: number, h: number): SolidBox {
  const corners = rectCorners(surface, col, row, w, h);
  if (surface.kind === 'wall') {
    const normal = normalize(cross(surface.axisU, surface.axisV));
    const extruded = corners.map((p) => ({
      x: p.x + normal.x * EXTRUDE,
      y: p.y + normal.y * EXTRUDE,
      z: p.z + normal.z * EXTRUDE,
    }));
    const b = boundsOf([...corners, ...extruded]);
    return { ...b, climbable: true, nx: normal.x, ny: normal.y, nz: normal.z };
  }
  const b = boundsOf(corners);
  return {
    minX: b.minX,
    maxX: b.maxX,
    minY: b.maxY - 0.32,
    maxY: b.maxY,
    minZ: b.minZ,
    maxZ: b.maxZ,
    climbable: false,
    nx: 0,
    ny: 1,
    nz: 0,
  };
}

function rowBoxes(surface: SurfaceDef, solid: Uint8Array): SolidBox[] {
  const boxes: SolidBox[] = [];
  for (let row = 0; row < surface.rows; row++) {
    let col = 0;
    while (col < surface.cols) {
      while (col < surface.cols && !solid[row * surface.cols + col]) col++;
      if (col >= surface.cols) break;
      const start = col;
      while (col < surface.cols && solid[row * surface.cols + col]) col++;
      boxes.push(stepBox(surface, start, row, col - start));
    }
  }
  return boxes;
}

function stepBox(surface: SurfaceDef, col: number, row: number, w: number): SolidBox {
  const u0 = uAt(surface, col);
  const u1 = uAt(surface, col + w);
  const v0 = vAt(surface, row);
  const v1 = vAt(surface, row + 1);
  let top = 0;
  if (surface.kind === 'stairs') {
    top = surface.origin.y + ((row + 1) / surface.rows) * surface.rise;
  } else {
    const corners = [pointAt(surface, u0, v0), pointAt(surface, u1, v0), pointAt(surface, u0, v1), pointAt(surface, u1, v1)];
    top = Math.max(...corners.map((p) => p.y));
  }
  const flat = [
    pointAt(surface, u0, v0, top),
    pointAt(surface, u1, v0, top),
    pointAt(surface, u0, v1, top),
    pointAt(surface, u1, v1, top),
  ];
  const b = boundsOf(flat);
  return {
    minX: b.minX,
    maxX: b.maxX,
    minY: top - 0.36,
    maxY: top,
    minZ: b.minZ,
    maxZ: b.maxZ,
    climbable: false,
    nx: 0,
    ny: 1,
    nz: 0,
  };
}

/** First hit distance along a normalized direction, or maxDist if nothing is hit. */
export function raycastBoxes(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  boxes: SolidBox[],
): number {
  let best = maxDist;
  for (const box of boxes) {
    let t0 = 0;
    let t1 = best;
    const slabs: [number, number, number, number][] = [
      [ox, dx, box.minX, box.maxX],
      [oy, dy, box.minY, box.maxY],
      [oz, dz, box.minZ, box.maxZ],
    ];
    let miss = false;
    for (const [origin, delta, mn, mx] of slabs) {
      if (Math.abs(delta) < EPS) {
        if (origin < mn || origin > mx) {
          miss = true;
          break;
        }
        continue;
      }
      let a = (mn - origin) / delta;
      let b = (mx - origin) / delta;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) {
        miss = true;
        break;
      }
    }
    if (!miss && t1 >= 0 && t0 < best) best = Math.max(0, t0);
  }
  return best;
}
