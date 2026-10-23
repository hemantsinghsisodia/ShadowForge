import { mulberry32 } from '../core/random';

/*
 * Pure height-field generators and the height-to-normal conversion. No DOM, no three, so node can test them.
 * Every generator is tileable: noise lattices wrap, and distances are measured the short way round the tile.
 */

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Shortest distance between two coordinates on a ring of the given size. */
function wrapDist(a: number, b: number, size: number): number {
  const d = Math.abs(a - b) % size;
  return Math.min(d, size - d);
}

/** Value noise on a cells x cells lattice that wraps, so the field tiles with period 1. */
export function makeNoise(rng: () => number, cells: number): (u: number, v: number) => number {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const xa = ((x0 % cells) + cells) % cells;
    const ya = ((y0 % cells) + cells) % cells;
    const xb = (xa + 1) % cells;
    const yb = (ya + 1) % cells;
    const top = lattice[ya * cells + xa] * (1 - fx) + lattice[ya * cells + xb] * fx;
    const bottom = lattice[yb * cells + xa] * (1 - fx) + lattice[yb * cells + xb] * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

interface Dent {
  x: number;
  y: number;
  radius: number;
  depth: number;
}

function dents(rng: () => number, size: number, count: number, minRadius: number, maxRadius: number, minDepth: number, maxDepth: number): Dent[] {
  const out: Dent[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: rng() * size,
      y: rng() * size,
      radius: (minRadius + rng() * (maxRadius - minRadius)) * size,
      depth: minDepth + rng() * (maxDepth - minDepth),
    });
  }
  return out;
}

/** Soft circular bowl, deepest at the centre, zero at the radius. */
function dentDepth(list: Dent[], x: number, y: number, size: number): number {
  let total = 0;
  for (const dent of list) {
    const dx = wrapDist(x, dent.x, size);
    if (dx >= dent.radius) continue;
    const dy = wrapDist(y, dent.y, size);
    if (dy >= dent.radius) continue;
    const t = Math.hypot(dx, dy) / dent.radius;
    if (t < 1) total += dent.depth * smooth(1 - t);
  }
  return total;
}

/** Default relief strength for a texture of this size. Features span more texels at larger sizes, so strength scales with size. */
export function normalStrength(size: number, base = 2): number {
  return (base * size) / 256;
}

/**
 * Converts a height field to a tangent-space normal map (RGBA bytes) with central differences.
 * Edges wrap, so a tileable field gives a seamless map. A flat field encodes as (128, 128, 255, 255).
 */
export function heightToNormal(heights: Float32Array, w: number, h: number, strength = 2): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const down = ((y + 1) % h) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = (x - 1 + w) % w;
      const right = (x + 1) % w;
      let nx = -(heights[row + right] - heights[row + left]) * strength;
      let ny = -(heights[down + x] - heights[up + x]) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const o = (row + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Panel seams: grooves on a 4 x 4 grid plus fine noise. The groove is a gaussian whose sigma scales with size, a
 * few px wide at 256. A narrower profile is undersampled at 256 and would read stronger at 512 than at 256.
 */
export function floorHeights(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const fine = makeNoise(rng, 64);
  const heights = new Float32Array(size * size);
  const cell = size / 4;
  const sigma = (size / 256) * 1.75;
  for (let y = 0; y < size; y++) {
    const dy = wrapDist(y, Math.round(y / cell) * cell, size);
    for (let x = 0; x < size; x++) {
      const dx = wrapDist(x, Math.round(x / cell) * cell, size);
      const d = Math.min(dx, dy);
      const groove = Math.exp(-(d * d) / (2 * sigma * sigma));
      heights[y * size + x] = clamp01(0.6 - 0.35 * groove + fine(x / size, y / size) * 0.08);
    }
  }
  return heights;
}

/** About ten soft circular dents plus fine noise. */
export function metalHeights(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const list = dents(rng, size, 10, 0.05, 0.12, 0.18, 0.35);
  const fine = makeNoise(rng, 32);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      heights[y * size + x] = clamp01(0.7 - dentDepth(list, x, y, size) + fine(x / size, y / size) * 0.06);
    }
  }
  return heights;
}

/** Two octaves of noise plus a few small pits. */
export function stoneHeights(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const coarse = makeNoise(rng, 8);
  const detail = makeNoise(rng, 32);
  const pits = dents(rng, size, 14, 0.01, 0.03, 0.2, 0.4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const base = 0.25 + coarse(u, v) * 0.35 + detail(u, v) * 0.2;
      heights[y * size + x] = clamp01(base + 0.15 - dentDepth(pits, x, y, size));
    }
  }
  return heights;
}
