# Forge Cavern Phase 3 (Mechanical Motion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Make the cavern feel like a working forge. It gets:
- a gantry rail with a trolley that ping-pongs along it
- swaying chains and hooks
- sparks falling from the trolley

All of these stay outside the play corridor. Long levels also get sun shadows along their whole length.

**Architecture:**
- **Motion maths and placement** live in pure, tested functions in `CavernLayout`: rail line, chain sites, `gantryX`, `swayAngle` and `sparkState`.
- **Static rail parts** (columns and rail beams) join the existing per-material structure bake.
- **Moving parts:**
  - Chains, hooks and the trolley are `InstancedMesh`es. Their matrices are written each frame with no allocations.
  - Sparks are a GPU `Points` system, with no per-frame uploads. The shader re-evaluates the trolley position at each spark's birth time, so every spark falls from wherever the trolley was when it spawned.

**Tech Stack:** TypeScript 5.6, three 0.170, Vite 6, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-10-23-forge-cavern-design.md` (Phase 3).

## Global Constraints
- Branch `feat/visual-upgrade`. One commit per task, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new npm dependencies. `npm test` and `npm run build` must stay green.
- Never add or remove lights.
- Cavern meshes: `castShadow = false`, `receiveShadow = false`.
- Camera safety:
  - Every new piece, and the whole swing envelope of every moving part, stays at `|z - midZ| >= halfDepth + CAMERA_BAND`. `CAMERA_BAND` and `corridor()` come from `src/world/CavernLayout.ts`.
  - Sparks also stay outside that band for their whole life.
  - Tests cover every level in `LEVELS`.
- Tiers:
  - **Low:** no motion layer.
  - **Medium:** rail, trolley, 6 chains, sparks = `round(profile.embers / 4)`.
  - **High:** rail, trolley, 10 chains, sparks = `profile.embers / 4`.
- No per-frame allocations in `update`. No canvas or `document` access at module load.
- `smoothstep` edges always ascend.
- Match the existing style: GLSL in template-literal consts, sparse comments, private fields.

## Review Focus
1. **Moving parts entering the camera band.** Envelope tests over every level and seed (Tasks 1 and 3).
2. **Shader/CPU parity of `sparkState` and `gantryX`.** The `% period` wrap must not pop (Task 3).
3. **Per-frame cost on a Medium phone.** At most about 20 instance matrices per frame, and the sparks need no uploads (Task 2).
4. **Rebuild and dispose.** Motion layers must rebuild on the existing keys without leaking (Task 2).
5. **Shadow re-centring keeps short levels identical** (Task 4).

---

### Task 1: Motion layout (pure) and layer-map tuning

**Files:** modify `src/world/CavernLayout.ts`, `src/world/ForgePalette.ts` (`CAVERN` booleans) and `src/world/ForgeCavern.ts` (tune refactor only). Tests: `tests/cavernLayout.test.ts`, `tests/cavern.test.ts`.

**Interfaces (produced):**
```ts
export const RAIL_Y = 7.5;               // rail beam height
export const RAIL_OFFSET = 11;           // rail z = midZ + (halfDepth + RAIL_OFFSET) (the +Z side)
export const GANTRY_SPEED = 0.8;         // m/s
export const GANTRY_PAUSE = 2;           // s at each end
export interface Rail { x0: number; x1: number; z: number; y: number }
export function railLine(bounds: CavernBounds, detail: CavernDetail): Rail | null; // null on low; x0..x1 = tower x range (towerSites) extended by 4 m each way
export function railPlacements(rail: Rail): Placement[]; // columns (SHF pillar, ABYSS_Y -> RAIL_Y) every 12 m incl. both ends, rail beams between them at RAIL_Y; role 'link' (columns 'tower')
export function gantryX(t: number, rail: Rail): number;  // ping-pong x0->x1->x0 at GANTRY_SPEED with GANTRY_PAUSE at ends; continuous; period = 2*(len/GANTRY_SPEED + GANTRY_PAUSE)
export function swayAngle(t: number, phase: number, amp: number, period: number): number; // amp*sin(2π t/period + phase)
export interface ChainSite { x: number; z: number; pivotY: number; length: number; phase: number; amp: number; period: number }
export function chainSites(bounds: CavernBounds, detail: CavernDetail, seed: number): ChainSite[];
```
`placeStructures` also emits `railPlacements(railLine(...))` when it isn't null. The static rail is baked with the structures.

**Chain rules:**
- Medium gets 6 chains, High 10, Low 0.
- Half hang from the rail: `pivotY = RAIL_Y`, `z = rail.z`, x spread evenly along the rail.
- The other half hang on the −Z side from `pivotY = 14` at `z = midZ - (halfDepth + 12)`. They have no anchor; it fades into the dark ceiling.
- `length` is 4–7 m, `amp` 0.05–0.09 rad, `period` 5–8 s and `phase` 0–2π, all seeded with mulberry32.

**Tune refactor:**
- `CAVERN` gains `chains: true`, `gantry: true` and `sparks: true`.
- `BOOLEAN_KEYS` includes all of them.
- `ForgeCavern.tune` applies visibility through a single `Map<boolean key, () => Object3D[]>`, so each new layer adds one line.

- [ ] **Step 1: Failing tests, run over every level in `LEVELS` with seeds 1–4:**
  - Rail placements satisfy `|z - midZ| ≥ halfDepth + CAMERA_BAND`.
  - Each chain's swing envelope satisfies the same rule: `|z ± length·sin(amp)| ≥` the band edge.
  - `railLine` is null on Low.
  - `gantryX` stays in `[x0, x1]`.
  - `gantryX` is continuous: sample t from 0 to 3 periods in 0.01 s steps; each step moves at most `GANTRY_SPEED·0.01 + 1e-6`.
  - `gantryX` holds exactly at the ends for `GANTRY_PAUSE`.
  - `swayAngle` stays within ±amp.
  - `chainSites` is deterministic and returns 6 or 10 sites.
  - `tune({ chains: false, gantry: false, sparks: false })` sets all three.
- [ ] **Step 2:** Implement. Run `npm test && npm run build`; expect PASS.
- [ ] **Step 3:** Commit `feat: cavern motion layout — gantry rail, chain sites, ping-pong and sway maths`.

---

### Task 2: Chains, hooks and the gantry trolley

**Files:** modify `src/world/ForgeCavern.ts`, plus new geometry helpers in `src/world/CavernMotion.ts`. Test: `tests/cavernMotion.test.ts`.

**Interfaces (produced):**
```ts
export function chainLinkGeometry(length: number): BufferGeometry; // merged TorusGeometry(0.09, 0.025, 3, 6) links, alternating 90°, 0.14 m pitch, hanging down from y=0 to y=-length
export function hookGeometry(): BufferGeometry;                    // TorusGeometry(0.25, 0.04, 4, 10, 1.5π), oriented as a hook below y=0
export class CavernMotion { readonly group: Group; build(rail: Rail | null, chains: ChainSite[], kit: ForgeKit | null): void; update(time: number): void; dispose(): void }
```

**Chains:**
- Build one chain geometry of unit length (1 m of links) and scale each instance to its `length` in Y. Link stretch on long chains is acceptable.
- Chains are one `InstancedMesh` with the Graphite-coloured material: the kit `SHF_MAT_Graphite` if present, otherwise a dark `MeshStandardMaterial` `0x2a2a2e`.
- Hooks are one `InstancedMesh` in Steel (kit `SHF_MAT_Steel` or `0x8a8f96`), placed at each chain's end.

**Trolley:**
- One extra chain-and-hook instance plus a small box carriage (`SHF_Prop_MaintenanceBox` if present, else a `BoxGeometry(0.8, 0.5, 0.8)` in DarkMetal).
- Its x comes from `gantryX`, at `rail.z`, hanging 3 m below `RAIL_Y`.

**`update(time)`:**
- Each chain's pivot gets a rotation of `swayAngle(...)` about X (swinging in Z), plus a quarter-amplitude sway about Z with a phase offset.
- Write each matrix with module-scratch `Matrix4`, `Quaternion` and `Vector3` objects: no allocations. Set `instanceMatrix.needsUpdate` once per mesh.

**Lifecycle:**
- `ForgeCavern` owns one `CavernMotion`.
- Rebuild on the key `detail | bounds | seed | kit`, the same as the structures.
- `dispose` frees only geometries this class created. Kit materials are never disposed; fallback materials created here are.
- Visibility follows `CAVERN.chains` and `CAVERN.gantry`.

- [ ] **Step 1: Failing tests (node):**
  - Link count equals `ceil(length / 0.14)`.
  - The geometry's bounding box spans y from about -length to 0.
  - `build` with Medium sites gives 6 chain instances + 1 trolley chain, and 7 hooks.
  - `update` changes the instance matrices.
  - Two `update` calls allocate no new `Matrix4`: spy on the constructor, or assert the scratch objects are reused.
  - `dispose` disposes the created geometries and not the kit materials (spy).
  - A Low/null rail builds nothing.
- [ ] **Step 2:** Implement and wire into `ForgeCavern.update`. Run `npm test && npm run build`; expect PASS.
- [ ] **Step 3:** Commit `feat: swaying chains, hooks and a gantry trolley in the forge`.

---

### Task 3: GPU falling sparks from the trolley

**Files:** create `src/effects/Sparks.ts`; modify `src/world/ForgeCavern.ts`. Test: `tests/sparks.test.ts`.

**Interfaces (produced):**
```ts
export interface SparkSeed { phase: number; speed: number; vx: number; vz: number; size: number }
export function seedSparks(count: number, seed: number): SparkSeed[];
export function sparkState(s: SparkSeed, time: number, rail: Rail): { x: number; y: number; z: number; alpha: number }; // mirrors the vertex shader exactly
export const SPARK_VERT: string; export const SPARK_FRAG: string;
export class Sparks { readonly points: Points; constructor(seeds: SparkSeed[], rail: Rail); setTime(t: number): void; setPixelRatio(dpr: number): void; dispose(): void }
```

**Maths (shader and TS identical):**
- **Lifetime:** `life = fract(time·speed + phase)`, `age = life / speed`, `birth = time - age`.
- **Origin:** `gantryX(birth)`, re-implemented in GLSL with the rail and constants as uniforms. The origin is at `rail.z`, `RAIL_Y - 3.2`, which is the trolley hook.
- **Position:**
  - `x = ox + vx·age`
  - `z = oz + vz·age`, with `|vz| ≤ 0.3` and the sign pointing away from the corridor, so sparks never drift toward the play area
  - `y = oy - 0.5·9.0·age²`
- **Alpha:** `smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.6, 1.0, life))`.
- **Lifespan:** `speed` is quantised to k/600 (as in Embers) with life of about 0.9–1.4 s, so sparks fade before reaching `ABYSS_Y`. Test it.
- **Look:**
  - Colour runs from `0xffd27a` to `FORGE.ember` over life, ×2.4 HDR. The short streaks bloom.
  - Size uses `min(8.0·uScale, size·uScale·50.0/-mv.z)`.
  - Additive blending, `depthWrite: false`, `fog: false`, `frustumCulled = false`.
- **Clock:** `setTime` passes `t % 600`.
- **Counts:** Medium `round(embers / 4)`, High `embers / 4`, Low none (no `Points`). `CAVERN.sparks` toggles visibility.

- [ ] **Step 1: Failing tests:**
  - `sparkState` equals the shader formula, using string checks on the key expressions.
  - Alpha is 0 at birth and at death.
  - `y` decreases with age.
  - Across every level and many sampled times, every spark stays at `|z - midZ| ≥ halfDepth + CAMERA_BAND`, and its y at alpha > 0 stays above `ABYSS_Y`.
  - Continuity across the 600 s wrap.
  - Determinism.
  - Count 0 builds no points.
  - The pixel ratio is re-applied after a rebuild.
- [ ] **Step 2:** Implement, wire into `ForgeCavern` (rebuild key as for the motion layer, pixel ratio as for embers), and add `SPARK_FRAG` to the shader include/order and smoothstep scans. Run `npm test && npm run build`; expect PASS.
- [ ] **Step 3:** Commit `feat: GPU sparks falling from the gantry trolley`.

---

### Task 4: Sun shadows along long levels

**Files:** modify `src/world/LevelWorld.ts` (`load` sun placement, `applyShadowSize`) and `src/world/CavernLayout.ts` (or a small helper). Test: `tests/cavernLayout.test.ts`.

**Interfaces (produced):** `export function sunShadowFrame(bounds: CavernBounds): { centreX: number; halfX: number }`. It returns `centreX = (minX + maxX) / 2` and `halfX = max(40, (maxX - minX) / 2 + 4)`. When `halfX = 40` and the centre is near 0, the result must match today's frame. Short levels keep `centreX = 0` when `(maxX - minX) / 2 + 4 <= 40` and `|midX| + (maxX - minX) / 2 <= 36`; otherwise the frame re-centres.

**Wiring:**
- The sun position becomes `(-12 + centreX, 22, 8)` and its target `(centreX, 0, 0)`.
- `applyShadowSize` uses `left/right = ±halfX`.
- `top`, `bottom`, `near` and `far` stay unchanged.

- [ ] **Step 1: Failing tests:**
  - L1 gives `{ 0, 40 }`, so it's unchanged.
  - L10, whose X runs from -12 to 62, gives centre 25 and `halfX ≥ 41`.
  - Every level's `[minX, maxX]` fits inside `centreX ± halfX`.
- [ ] **Step 2:** Implement. Run `npm test && npm run build`; expect PASS.
- [ ] **Step 3:** Commit `fix: sun shadow frame follows long levels`.

---

### Task 5: Browser verification and tuning (controller)
- [ ] Run `npm test && npm run build`.
- [ ] In `?debug`, check L1, L5 and L10 on High:
  - The rail and columns are visible on the +Z side.
  - The trolley ping-pongs with pauses at the ends.
  - Sparks fall from the trolley and fade before the lava.
  - Chains sway out of phase.
  - Nothing enters the play area during 60 s on L5 and L10.
- [ ] L10's far end (x > 40) now has floor shadows.
- [ ] Toggle `__SF.cavern({chains:false, gantry:false, sparks:false})`: the fps difference should be small.
- [ ] Mobile emulation, Medium, L10: `__SF.fps()` ≥ 55.
- [ ] Switch tiers at runtime: no errors, and Low has no motion layer.
- [ ] Tune live, bake values with a small Sonnet dispatch, then run a whole-phase Sonnet review.
