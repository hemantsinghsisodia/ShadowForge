# Atmosphere and Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Finish the original visual-upgrade plan's last phase:
- **Lamp shadows (High tier).** The puzzle lamp casts a real shadow onto the floor, so the shadow you shape shows up in the world.
- **Normal maps.** Floors, metal and stone get surface relief.
- **Beam shimmer.** The lamp beams shimmer.
- **Fog on obsidian and forge plates.** Obsidian and forge plates take the cavern fog, so they stop floating at a distance.

**Architecture:**
- Pure helpers carry the logic so it can be tested: `pickShadowLamp`, `heightToNormal`, seeded painters, and the beam noise expression.
- `LevelWorld` and `Materials` apply the results per quality tier.
- Custom `ShaderMaterial`s opt into fog by including three's fog chunks. These are already patched with height fog by `src/world/HeightFog.ts`.

**Tech Stack:** TypeScript 5.6, three 0.170, Vite 6, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-10-23-visual-upgrade-design.md`, "Phase 3: Atmosphere and materials". It is adapted to the current code. The SpaceBackdrop and dust items were superseded by the forge cavern.

## Global Constraints
- **Branch and commits:** branch `feat/atmosphere-materials`. One commit per task, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests and dependencies:** no new npm dependencies. `npm test` and `npm run build` must stay green.
- **Lights:** never add or remove lights at runtime. Shadow casting may toggle on a tier change, which costs one accepted recompile.
- **Tiers:**
  - Low gets nothing new: no normal maps, no lamp shadows, no shimmer cost.
  - Lamp shadows are High only.
  - Normal maps are 256 px on Medium and 512 px on High.
- **Determinism:** no `Math.random` in texture painting. Use `mulberry32` from `src/core/random.ts`, so textures are deterministic.
- **Module load:** no canvas or `document` access at module load.
- **Style:** match the existing style. Shaders use ascending `smoothstep` edges and end with the tonemapping and colorspace includes.

## Review Focus
1. **Self-shadowing lamp.** A point light inside its own lamp head would black out. The shadow-casting lamp's head and pole must not cast shadows (Task 1).
2. **Shadow acne and peter-panning** on the floor and casters. Bias values need tuning in the browser (Task 1 and Task 4).
3. **Fog on additive and transparent materials.** Obsidian is transparent, and forge plates use `depthWrite: false`. Fog must fade them toward the fog colour without breaking alpha (Task 3).
4. **Normal map seams** at tile repeats. `RepeatWrapping` must tile seamlessly (Task 2).
5. **High-tier cost of a point-light shadow,** which renders 6 cube faces per frame (Task 4, fps check).

---

### Task 1: Lamp shadows on High

**Files:** modify `src/settings/Settings.ts` (profile flag), `src/world/LevelWorld.ts` (`makeLamp`, `applyProfile`) and `src/world/CavernLayout.ts` (or a small helper module) for `pickShadowLamp`. Tests: `tests/quality.test.ts`, `tests/lampShadow.test.ts` (new).

**Interfaces (produced):**
```ts
// Settings.ts
QualityProfile.lampShadows: boolean // true on high only
// helper
export function pickShadowLamp(config: LevelConfig): string | null; // id of the lamp to cast shadows: the first 'spotlight' lamp; else the lamp whose position is nearest (XZ) to the first surface's origin; null when there are no lamps
export const LAMP_SHADOW = { mapSize: 512, bias: -0.0005, normalBias: 0.02, radius: 2 } as const;
```

**Behaviour:**
- `LevelWorld` remembers the shadow lamp's id at `load`.
- When `profile.lampShadows` is true, that lamp gets the following. Use `light.shadow.camera.near = 0.1` and `far = cfg.range`. For a `SpotLight`, the shadow camera follows the cone.
  - `castShadow = true`
  - `shadow.mapSize` from `LAMP_SHADOW.mapSize`
  - `shadow.bias` from `LAMP_SHADOW.bias`
  - `shadow.normalBias` from `LAMP_SHADOW.normalBias`
  - `shadow.radius` from `LAMP_SHADOW.radius`
- The shadow lamp's head and pole are set to `castShadow = false` on every tier, so the light is never inside its own occluder.
- `applyProfile` toggles `castShadow` when the tier changes.
- All other lamps keep `castShadow = false`.

**Steps:**
- [ ] **Step 1: Failing tests.**
  - `lampShadows` is true only on high, for both coarse and fine pointers.
  - `pickShadowLamp` returns Level 6's spotlight id.
  - For every level in `LEVELS`, `pickShadowLamp` returns a lamp id that exists, or null when the level has no lamps.
  - The result is deterministic.
- [ ] **Step 2:** Implement. Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3:** Commit `feat: puzzle lamp casts real shadows on high`.

---

### Task 2: Normal maps and seeded textures

**Files:** modify `src/world/Materials.ts`, and add the helper functions there or in a new `src/world/NormalMaps.ts`. Modify `src/world/LevelWorld.ts` (`applyProfile` calls the detail). Test: `tests/normalMaps.test.ts` (new).

**Interfaces (produced):**
```ts
export function heightToNormal(heights: Float32Array, w: number, h: number, strength: number): Uint8Array; // RGBA; tangent-space; wraps at edges (seamless); flat -> (128,128,255,255)
export function floorHeights(size: number, seed: number): Float32Array;  // panel seams (grooves on a 4x4 grid inside the tile) + fine noise; tileable
export function metalHeights(size: number, seed: number): Float32Array;  // soft dents; tileable
export function stoneHeights(size: number, seed: number): Float32Array;  // chips/pits; tileable
LabMaterials.applyDetail(tier: 'low' | 'medium' | 'high'): void;          // low: normalMap = null; medium 256; high 512; normalScale (0.6, 0.6); needsUpdate; caches textures per size
```

**Behaviour:**
- The textures are `DataTexture`s with `NoColorSpace`, `RepeatWrapping` and mipmaps, and anisotropy matching the existing textures.
- Apply them to `floor`, `lamp` (metal) and `stone`. Skip `wall`: it is unused.
- Every existing painter switches from `Math.random()` to the seeded `mulberry32` stream.
- Build the textures lazily on the first `applyDetail` call, so nothing touches `document` at module load.

**Steps:**
- [ ] **Step 1: Failing tests.**
  - A flat field gives (128, 128, 255) everywhere.
  - An x-ramp tilts R away from 128 and leaves G at 128.
  - Edge wrap: a periodic field gives identical normals on the left and right edges.
  - The height generators are deterministic per seed, stay in [0, 1], and tile (left column ≈ right-neighbour continuity).
  - `strength = 0` gives a flat normal map.
- [ ] **Step 2:** Implement. Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3:** Commit `feat: seeded normal maps for floor, metal and stone`.

---

### Task 3: Beam shimmer and fog on obsidian and forge plates

**Files:** modify `src/effects/LightBeams.ts`, `src/effects/Obsidian.ts` and `src/shadows/ForgeSurface.ts`, and `src/world/LevelWorld.ts` (drive the beam time). Tests: `tests/shaders.test.ts`, `tests/beams.test.ts` (new).

**Interfaces (produced):**
```ts
// LightBeams.ts
setBeamTime(view: BeamView, time: number): void; // writes uniform `time`
// BEAM_FRAG: value noise along the cone (vUv.y*6.0 - time*0.35) and around it (atan of normal), shimmer = mix(0.75, 1.15, noise); alpha *= shimmer; strength factor 0.28 -> 0.34
```
- **Beam time:** `LevelWorld.update` calls `setBeamTime` for each lamp's glow. It is cheap: one uniform per lamp.
- **Obsidian and ForgeSurface fog:**
  - Set `fog: true` on the materials.
  - Merge `UniformsLib.fog` into their uniforms.
  - Add `#include <fog_pars_vertex>` and `#include <fog_vertex>` to the vertex shaders, after the `mvPosition` they need. Compute `vec4 mvPosition = viewMatrix * world;` if it isn't present.
  - Add `#include <fog_pars_fragment>`, and `#include <fog_fragment>` before the tonemapping include.
  - Alpha is unchanged. `fog_fragment` only mixes rgb.
- **Beams stay unfogged.** They are additive, so fogging them toward a warm fog colour would add light.

**Steps:**
- [ ] **Step 1: Failing tests.**
  - `BEAM_FRAG` declares `uniform float time` and uses `0.34`.
  - Both the Obsidian and FORGE shaders contain the four fog includes, in the right order (fog after `gl_FragColor`, before tonemapping).
  - The materials have `fog === true` and a `fogColor` uniform.
  - The include and smoothstep scans pass.
- [ ] **Step 2:** Implement. Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3:** Commit `feat: shimmering lamp beams; obsidian and forge plates take the cavern fog`.

---

### Task 4: Browser verification and tuning (controller)
- [ ] **High:**
  - L1, L5 and L6: the puzzle lamp's shadow of the monument falls on the floor, matching the forge-plate preview.
  - No acne and no peter-panning. Tune the bias if needed.
  - The lamp head doesn't black out its own light.
- [ ] **Medium:** no lamp shadows, and the normal maps are visible at grazing angles.
- [ ] **Low:** unchanged.
- [ ] **Beams:** they shimmer slowly with no flicker.
- [ ] **Fog:** obsidian and plates fade with distance on L10.
- [ ] **Frame rate:**
  - High desktop: `__SF.fps()` ≥ 55.
  - Medium phone emulation: ≥ 55.
- [ ] **Wrap-up:** tune, bake the values, then a whole-phase Sonnet review.
