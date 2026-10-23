# Forge Cavern Phase 2 (Depth and Structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Give the cavern depth and parallax:
- industrial structures in world space, built from the unused `SHADOWFORGE_EnvKit.glb`: supports under slabs, and side towers with lamps linked by beams and cable trays
- `SHF_Floor_Edge` lips on exposed slab rims, with an accent-tinted trim
- noise-displaced rock walls

Structures must never sit between the camera and the player.

**Architecture:**
- **Placement:** a pure `CavernLayout` module decides placements, and tests enforce the play-area rules.
- **Kit loading:** a generic kit loader serves both GLBs. `ForgeKit` retints the SHF kit to the molten palette.
- **Structures:** `ForgeCavern` merges structure placements into one mesh per material and rebuilds them only when their inputs change.
- **Slab edges:** the rims are per-level dressing, because their trim follows the level accent.

**Tech Stack:** TypeScript 5.6, three 0.170, Vite 6, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-10-23-forge-cavern-design.md` (Phase 2).

## Global Constraints
- Branch `feat/visual-upgrade`. One commit per task, each ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new npm dependencies. `npm test` and `npm run build` must stay green.
- Never add or remove lights at runtime. Cavern meshes use `castShadow = false` and `receiveShadow = false`.
- Placement rules, which tests enforce for every level in `src/levels/index.ts` `LEVELS`:
  - (a) Any piece whose top is above `top - 0.6` must satisfy `|z - midZ| >= halfDepth + 7`.
  - (b) A support's top stays at or below its slab's bottom.
  - (c) Nothing spans over the corridor footprint above the floor.
- Tiers:
  - Low: no structures and no rims.
  - Medium: about 60% of High's structure density, plus rims.
  - High: full.
- No canvas or `document` access at module load. Match the existing style.
- The level accent tints only the rim trim, never the cavern.

## Review Focus
1. **Camera occlusion.** Covered by rule (a) tests over all levels, plus the controller's browser check at camera-pitch extremes on L10.
2. **Rebuild churn.** Structures must not rebuild on `showMenu`, or on tier switches that don't change their inputs. Covered by Task 1's mount early-out and the identity tests in Task 4.
3. **Disposal.** Kit-owned geometry and materials must never be disposed. Merged geometry and cloned trim materials must be disposed on rebuild and on `clearLevel`. Covered by tests in Tasks 2, 4 and 5.
4. **Draw calls on a Medium phone.** About 14 extra on Medium. Checked by the controller in the browser.
5. **`applyLighting` `kitScale` reaches the SHF kit materials** (Task 2 test).

---

### Task 1: Phase-1 review minors and cavern prep (single commit)

**Files:** modify `src/world/ForgeCavern.ts`, `src/world/CavernShaders.ts`, `src/world/HeightFog.ts`, `src/world/ForgePalette.ts`, `src/world/LevelWorld.ts`, `src/game/Game.ts` (if needed) and `src/vite-env.d.ts`. Tests: `tests/cavern.test.ts`, `tests/heightfog.test.ts` and `tests/palette.test.ts`.

**Changes:**
1. **Abyss time wrap.**
   - The abyss gets its own clock uniform, `uAbyssTime = time % 6000`.
   - Embers keep `% 600`. Their speeds are already quantised for that period.
   - The `MOLTEN_FRAG` noise uses `uAbyssTime`.
2. **Abyss draw order.** Set `abyssMesh.renderOrder = 1` so it draws after the opaque scene and early-z rejects the fragments the floor hides. The dome stays at `-1`.
3. **Reversed `smoothstep`.**
   - `HeightFog`: `smoothstep(2.0, -7.0, vFogWorldY)` becomes `1.0 - smoothstep(-7.0, 2.0, vFogWorldY)`.
   - Fix the same pattern in `src/effects/Embers.ts`, and anywhere else a grep for `smoothstep(` finds `edge0 > edge1`.
   - The tests assert the new strings.
4. **Mount signature and early-out.**
   - `mount(bounds: CavernBounds, slabs: PlatformConfig[] = [], seed = 0)` stores all three.
   - It returns early, doing nothing, when the bounds' four numbers, `seed`, and the slab list are equal to the previous call. Compare the slab list by `JSON.stringify` of positions and sizes.
   - `LevelWorld.load` passes `config.platforms` and `config.id`. The menu passes `[]` and `0`.
5. **Tuning keys.**
   - `CAVERN` gains `structures: true` and `walls: true`.
   - `tune()` accepts booleans for `embers`, `structures` and `walls` through a `BOOLEAN_KEYS` list, the same way `NUMERIC_KEYS` works.
   - Update the `__SF.cavern` type in `vite-env.d.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `uAbyssTime` wraps at 6000 and the ember clock at 600.
  - The abyss `renderOrder` is 1.
  - The HeightFog chunk contains `1.0 - smoothstep(-7.0, 2.0, vFogWorldY)`.
  - A second `mount` with equal args doesn't replace the abyss geometry (identity check).
  - `tune({ structures: false, walls: false })` sets both, and `tune({ structures: 3 as never })` is ignored.
- [ ] **Step 2: Implement.** Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `fix: cavern review minors (abyss clock, draw order, smoothstep) and mount/tune prep for structures`

---

### Task 2: Generic kit loader and ForgeKit

**Files:**
- Modify: `src/world/EnvKit.ts`, `src/world/LevelWorld.ts` (`disposeObject` owns check, `applyLighting` kit-scale traversal)
- Create: `src/world/ForgeKit.ts`
- Test: `tests/forgekit.test.ts`

**Interfaces (produced):**
```ts
// EnvKit.ts
export interface Kit<N extends string> { prototype(name: N): KitPart[] | null; merged(name: N): {...} | null; owns(r): boolean; allMaterials(): MeshStandardMaterial[] }
export type EnvKit = Kit<KitName>;
export function loadKit<N extends string>(url: string, names: readonly N[], retint?: (m: MeshStandardMaterial) => void): Promise<Kit<N> | null>;
// loadEnvKit()/envKit() keep their signatures and behaviour (wrappers over loadKit).
// ForgeKit.ts
export const FORGE_KIT = { edge: 'SHF_Floor_Edge', beam: 'SHF_Structure_Beam', tray: 'SHF_Structure_CableTray', lamp: 'SHF_Lamp_Industrial', pillar: 'SHF_Pillar_A' } as const;
export type ForgeKitName = (typeof FORGE_KIT)[keyof typeof FORGE_KIT];
export type ForgeKit = Kit<ForgeKitName>;
export function forgeRetint(m: MeshStandardMaterial): void; // by material name: 'CyanEmission' emissive -> FORGE.glow; 'WhiteEmission' emissive -> 0xffc890, emissiveIntensity 2.0
export function loadForgeKit(): Promise<ForgeKit | null>;
export function forgeKit(): ForgeKit | null;
```

**Retint ordering.** `standardOf` runs `retint` after creating the standard material. The `kitScale` and `userData.baseColor` handling stays exactly as it is today.

**Wiring:**
- `disposeObject` skips resources where `envKit()?.owns(r) || forgeKit()?.owns(r)`.
- `applyLighting` calls `setKitScale(forgeKit()?.allMaterials() ?? [], LIGHTING.kitScale)` alongside the existing kit materials.
- `loadForgeKit()` is kicked off where `loadEnvKit()` is called today. The result isn't used until Task 4.

**URL:** `${import.meta.env.BASE_URL}models/environment/SHADOWFORGE_EnvKit.glb`.

- [ ] **Step 1: Write the failing tests.**
  - `forgeRetint` on a material named `CyanEmission` sets the emissive hex to `FORGE.glow`.
  - `forgeRetint` on `WhiteEmission` sets `0xffc890` at intensity 2.0.
  - `forgeRetint` on other names leaves the material unchanged.
  - `FORGE_KIT` has the 5 names.
  - `setKitScale` on retinted materials still works from `baseColor`.
- [ ] **Step 2: Implement.** Refactor `fetchKit` into the generic `loadKit` with no behaviour change for the Kenney kit. Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `feat: generic kit loader and molten-retinted SHADOWFORGE kit`

---

### Task 3: CavernLayout (pure placement)

**Files:** create `src/world/CavernLayout.ts`. Test: `tests/cavernLayout.test.ts`.

**Interfaces (produced):**
```ts
export interface Placement { piece: ForgeKitName; position: [number, number, number]; rotationY: number; scale: [number, number, number]; top: number }
export interface Rim { x0: number; z0: number; x1: number; z1: number; y: number; thick: number; outward: [number, number] }
export function corridor(bounds: CavernBounds): { midZ: number; halfDepth: number };
export function placeStructures(bounds: CavernBounds, slabs: PlatformConfig[], detail: CavernDetail, seed: number): Placement[];
export function exposedRims(slabs: PlatformConfig[]): Rim[];
```

**Piece sizes** (from the GLB, with origins at the piece centre on X/Z and base at y = 0 unless noted):

| Piece | Size |
|---|---|
| Pillar | 0.56 wide, 3.08 tall |
| Beam | X ±1, 0.2 tall |
| Floor_Edge | X ±1, Y −0.5..0, Z ±0.14 |
| Lamp | 1.78 tall |

**Placement rules:**
1. **Under-slab supports**, for slabs with height ≤ 1.2:
   - A pillar at each slab corner, inset 0.6, plus one every 6 m along edges longer than 6 m.
   - `position.y = ABYSS_Y`, `scaleY = (slabBottom - ABYSS_Y) / 3.08`, `top = slabBottom`.
   - A cross beam at `slabBottom - 0.4` between adjacent corner pillars along X, with `scaleX = span / 2`.
2. **Side towers.**
   - Every 12 m along X from `minX - 10` to `maxX + 10`, alternating sides.
   - At `z = midZ ± (halfDepth + 9)`.
   - A pillar from `ABYSS_Y` up to y = +1 (scaled), with a lamp on top.
   - Neighbouring towers on the same side are linked by a beam at y = +0.6 and a tray at y = +0.3.
3. **Medium** keeps every other tower and drops the cross beams. Its count must be ≤ 60% of High's.
4. **Low** returns `[]`.
5. **Determinism:** the result is deterministic per seed. Use mulberry32 for any jitter, with yaw jitter only.

`exposedRims` returns the slab top-edge segments that no adjacent slab shares. Two edges count as shared when they are within 0.05 m on the same line, with overlapping spans; split partial overlaps.

- [ ] **Step 1: Write the failing tests** (iterate over `LEVELS`, using bounds computed the way `LevelWorld.load` does; reuse or extract that helper):
  - "above-floor pieces stay outside the camera band": every placement with `top > -0.6` satisfies rule (a).
  - "supports stay under their slab".
  - "nothing crosses the corridor overhead".
  - "deterministic per seed".
  - "medium places ≤ 60% of high".
  - "low places nothing".
  - `exposedRims` of two abutting 4×4 slabs totals 20 m.
  - `exposedRims` of a lone 4×4 slab totals 16 m.
- [ ] **Step 2: Implement.** Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `feat: cavern layout — supports, towers, beams and exposed rims, play-area safe`

---

### Task 4: Baked structures in ForgeCavern

**Files:** modify `src/world/ForgeCavern.ts` and `src/world/LevelWorld.ts` (call `cavern.setKit(kit)` when `loadForgeKit` resolves, and on load if already ready). Test: `tests/cavern.test.ts`.

**Interfaces (produced):**
```ts
export function bakeByMaterial(placements: Placement[], kit: Pick<ForgeKit, 'prototype'>): Mesh[]; // one Mesh per distinct material; merged geometry from transformed clones
ForgeCavern.setKit(kit: ForgeKit | null): void;
```

**Behaviour:**
- **Rebuilds.** Structures rebuild only when the key `detail | bounds | slabs | seed | kit present` changes. On rebuild, dispose the merged geometries. Never dispose kit materials.
- **Visibility.** `CAVERN.structures` toggles visibility, and the setting survives rebuilds.
- **Meshes.** Use `castShadow = false`, `receiveShadow = false`, and leave frustum culling on (merged bounds are valid).

- [ ] **Step 1: Write the failing tests** (use a fake kit in node built from `BoxGeometry` and named `MeshStandardMaterial`s):
  - `bakeByMaterial` returns one mesh per distinct material.
  - Merged vertex count = the sum over placements.
  - The same key twice doesn't rebuild (identity check).
  - A detail change rebuilds and disposes the old geometry (spy).
  - With no kit, no meshes.
  - `tune({ structures: false })` hides the meshes.
- [ ] **Step 2: Implement and wire.** Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `feat: baked forge structures in the cavern with parallax`

---

### Task 5: Floor_Edge rims with accent trim

**Files:** modify `src/world/LabDressing.ts` (new `buildForgeRims`) and `src/world/LevelWorld.ts` (`mountDressing` / `applyKit`: build when `dressingDetail === 'high'` and the forge kit is ready, add to the per-level dressing, dispose with the level). Test: `tests/rims.test.ts`.

**Interfaces (produced):**
```ts
export function rimPlacements(rims: Rim[]): Placement[]; // Floor_Edge: scaleX = len/2, scaleY = thick/0.5, rotated 90° on X-facing rims, centre inset 0.12 so the outer face sits 0.02 m beyond the slab side
export function rimTrimColor(accent: Color): Color;      // mixSrgb(0xd98a1c, accent, 0.35)
export function buildForgeRims(kit: ForgeKit, platforms: PlatformConfig[], accent: Color): Group | null;
```

**Material handling:**
- `buildForgeRims` bakes the edges with `bakeByMaterial`.
- The `WarningAmber` material is cloned per level: emissive `rimTrimColor(accent)` at intensity 0.8.
- The clone is disposed with the level. Kit materials are not.

- [ ] **Step 1: Write the failing tests:**
  - `rimPlacements` scale and rotation for X-facing and Z-facing rims.
  - Outer-face offset.
  - `rimTrimColor` differs for two accents and stays warm (r > b) for a cyan accent.
  - The rim count equals the number of `exposedRims` segments.
- [ ] **Step 2: Implement and wire.** Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `feat: forged slab rims with accent-tinted warning trim`

---

### Task 6: Rock walls (and drop invisible dome banding)

**Files:** modify `src/world/CavernShaders.ts` (`ROCK_VERT`, `ROCK_FRAG`; remove the dome `ROCK` banding define, which the Phase 1 review found invisible) and `src/world/ForgeCavern.ts`. Test: `tests/cavern.test.ts` and `tests/shaders.test.ts`.

**Interfaces (produced):** `export function rockCard(length: number, segX: number, segY: number, seed: number): BufferGeometry` (CPU fbm displacement plus an `aRock` attribute in [0, 1]).

**Geometry:**
- `PlaneGeometry(len + 120, 40)`, spanning y −14..+26, facing the corridor.
- Placed at `z = midZ ± (halfDepth + 22)`. On High, a second darker pair at `± (halfDepth + 34)`.
- Displaced along the normal by 2-octave fbm(x·0.08, y·0.12)·4.
- Segments: 48×8 on Low, 96×12 otherwise.

**Shader (unlit):**
- `rock = 0.03 * (0.5 + aRock)`.
- Underglow term: `glow * exp(-(y + 9.0) * 0.16) * uPulse * 0.5`.
- Top fade: `mix(col, top, smoothstep(2.0, 18.0, y))`.
- Far fade to haze, using the abyss's distance fade: `smoothstep(25, 70)`.
- Material flags: `fog: false`, `castShadow = false`.
- `CAVERN.walls` toggles visibility. Walls rebuild with the same keyed logic as Task 4.

- [ ] **Step 1: Write the failing tests:**
  - `rockCard` is deterministic per seed, and `aRock` stays in [0, 1].
  - Vertex count matches the segments.
  - Low gets 2 cards and High gets 4.
  - `ROCK_FRAG` is in the shader include/order checks.
  - `DOME_FRAG` no longer contains `ROCK`.
  - `tune({ walls: false })` hides the walls.
- [ ] **Step 2: Implement.** Run `npm test && npm run build` and expect PASS.
- [ ] **Step 3: Commit:** `feat: noise-displaced rock walls with molten underglow`

---

### Task 7: Browser verification and tuning (controller)
- [ ] Run `npm test && npm run build`.
- [ ] Use `?debug`. On L1, L5 and L10 (High), confirm visible parallax on the towers and walls, and confirm supports show through the gaps.
- [ ] Use `__SF.drive` along L10 and drag the camera pitch to its extremes. No structure may block the player.
- [ ] Check that the rim trim colour follows the level accent while the cavern stays the same.
- [ ] Compare `__SF.cavern({structures:false, walls:false})` against the defaults: the draw-call and fps difference should be small.
- [ ] In mobile emulation on Medium, L10 should hold `__SF.fps()` at 55 or above.
- [ ] Switch Low, Medium, High at runtime: no errors, and Low shows no structures or rims.
- [ ] Tune live, bake any value changes with a small Sonnet dispatch, then run a whole-phase Sonnet review.
