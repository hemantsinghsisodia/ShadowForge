# Forge Moment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Make forging a shadow the game's spectacular beat. The sequence runs:
1. **Charge:** the plate brightens and scans faster, and the camera tension builds.
2. **Impact:**
   - a flash and exposure punch, with a bloom spike
   - a short chromatic-aberration hit
   - a camera FOV kick
   - a swell of light at the plate
   - sparks racing along the forged shadow's edges
3. **Rise:** the obsidian rises out of the plate behind a glowing leading edge instead of popping in.

A collapse recedes with a red flash. Reduced-motion users get the sequence without the shake and FOV kick.

**Architecture:**
- A pure `ForgeTimeline` module turns seconds-since-interact into effect amounts. `Game.playTransition` feeds those amounts into hooks that already exist or that this plan adds:
  - `Renderer.punch` and `ZERO_PUNCH`, which already exist
  - `CameraRig.kick` (new)
  - `ForgeSurface` charge (new)
  - a fixed forge `PointLight` (new)
  - `ParticleManager.burstPoints`, which already exists
- Obsidian moves to one `InstancedMesh` per surface. Each mesh has `rise` and `hot` uniforms, and diffing is done per surface.
- Low tier has no composer, so a cheap DOM overlay draws its flash.

**Tech Stack:** TypeScript 5.6, three 0.170, Vite 6, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-10-23-visual-upgrade-design.md`, the "Phase 2: The forge moment" section.

## Global Constraints
- Branch `feat/forge-moment`. Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Make one commit per task.
- No new npm dependencies. `npm test` and `npm run build` must stay green.
- Never add or remove lights per frame. The forge light is created at level load, and only on tiers that have it. A runtime tier change may add or remove it once, which is the same accepted cost as other tier-change recompiles.
- No per-frame allocations in the transition and update paths.
- Every exit from the sequence must restore `renderer.punch(ZERO_PUNCH)`, the camera FOV and the forge light. That covers the normal end, pause, restart, level exit, a failed forge and quitting to the menu.
- Gameplay timing:
  - Input stays locked during `SHADOW_TRANSITION`.
  - `FORGE_END` is 0.9 s.
  - Collision boxes exist from the moment of impact.
- `smoothstep` edges always ascend. Custom shaders end with the tonemapping and colorspace includes.
- Match the existing style.

## Review Focus
1. **Stuck effects.** Punch, FOV or light must not stay stuck after an interrupted sequence such as pause, restart or exit. Task 5 adds a reset helper with a test.
2. **Obsidian lifecycle.** No leaked InstancedMeshes or materials across repeated forge and collapse cycles. Task 3 tests this with a spy.
3. **The rise animation must not change collision.** It is visual only. Task 3.
4. **Edge sparks respect the particle budget.** Task 2.
5. **Reduced motion is honoured.** Task 1 tests this, and Task 6 checks it in the browser.

---

### Task 1: ForgeTimeline (pure) + reduced-motion probe

**Files:** create `src/effects/ForgeTimeline.ts`. Modify `src/core/device.ts`. Test: `tests/forge.test.ts`.

**Interfaces (produced):**
```ts
export const CHARGE_END = 0.45;
export const FORGE_END = 0.9;
export const RISE_TIME = 0.45;
export const COLLAPSE_TIME = 0.3;
export function easeOutCubic(t: number): number;
export function easeOutBack(t: number, s?: number): number; // s = 1.4
export function pulse(t: number, attack: number, decay: number): number; // 0 for t<0; linear 0->1 over attack; then exp(-(t-attack)/decay)
export interface ForgeFrame { charge: number; flash: number; exposure: number; bloom: number; ca: number; fovKick: number; shake: number; light: number; impact: boolean }
export function forgeTimeline(t: number, prevT: number, reducedMotion: boolean, out: ForgeFrame): ForgeFrame; // writes into out (no alloc); impact true only when prevT < CHARGE_END <= t
export function riseProgress(t: number): number;     // easeOutCubic(clamp(t / RISE_TIME))
export function collapseProgress(t: number): number; // 1 - easeOutCubic(clamp(t / COLLAPSE_TIME))
export function collapseFlash(t: number): number;    // pulse(t, 0.03, 0.12) * 0.3
// device.ts
export function prefersReducedMotion(): boolean;     // matchMedia('(prefers-reduced-motion: reduce)'); false when matchMedia is missing
```

**Values.** Let `s = t - CHARGE_END`. Every term after impact is 0 when `s < 0`.

| Field | Formula |
|---|---|
| `charge` | `easeOutCubic(min(1, t / CHARGE_END))` while `t < CHARGE_END`, then 0 |
| `shake` (charge) | `0.25 * charge` |
| `shake` (after impact) | `0.5 * exp(-s / 0.18)` |
| `flash` | `pulse(s, 0.04, 0.30) * 0.9` |
| `exposure` | `pulse(s, 0.03, 0.35) * 0.45` |
| `bloom` | `pulse(s, 0.03, 0.5) * 0.9` |
| `ca` | `pulse(s, 0.02, 0.25) * 0.005` |
| `fovKick` | `5 * (1 - easeOutBack(min(1, s / 0.6)))` clamped to ≥ 0, and 0 when `s < 0` |
| `light` | `pulse(s, 0.05, 0.8)` |

Reduced motion forces `shake = 0` and `fovKick = 0`, and multiplies `flash` and `ca` by 0.4.

- [ ] **Step 1: Write the failing tests.**
  - Easing endpoints: 0 maps to 0 and 1 maps to 1.
  - `easeOutBack` exceeds 1 somewhere in (0, 1) and ends at 1.
  - `pulse` is 0 before 0, peaks at `attack`, and is < 0.05 at `attack + 5 * decay`.
  - Sweep 0..1 s at 60 Hz: `impact` is true in exactly one frame.
  - At `FORGE_END`, `flash`, `exposure`, `bloom` and `ca` are each < 0.06 and `fovKick` is < 0.3.
  - Reduced motion gives `shake = 0` and `fovKick = 0` at every t.
  - `riseProgress` and `collapseProgress` endpoints.
  - `forgeTimeline` returns the same `out` object it was given.
  - `prefersReducedMotion` returns false in node, where `matchMedia` is missing.
- [ ] **Step 2: Implement.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** with the message `feat: forge timeline — charge, impact punch, rise and collapse curves`.

---

### Task 2: Edge cells and HDR spark intensity

**Files:** modify `src/shadows/math.ts` (or the module that owns `maskToBoxes`) and `src/effects/ParticleManager.ts`. Tests: `tests/shadow.test.ts`, `tests/particles.test.ts`.

**Interfaces (produced):**
```ts
export function maskEdgeCells(mask: Uint8Array, cols: number, rows: number): number[]; // set cells with an unset (or out-of-grid) 4-neighbour
export function edgePoints(def: SurfaceDef, mask: Uint8Array, maxPoints: number, out?: Float32Array): Float32Array; // world xyz of edge-cell centres via cellCenter; stride-samples evenly when there are more than maxPoints
export function luminance(hex: number): number; // linear Rec709 luma of new Color(hex)
export const SPARK_TARGET_LUMA = 3.0;
export function kindIntensity(hex: number, kind: BurstKind): number; // spark/shard: SPARK_TARGET_LUMA / max(0.05, luminance(hex)), clamped to [1, 12]; ember keeps KIND_INTENSITY.ember
```

`burst` and `burstPoints` default their intensity to `kindIntensity(hex, kind)` instead of `KIND_INTENSITY[kind]`. Keep `KIND_INTENSITY` exported for compatibility.

- [ ] **Step 1: Write the failing tests.**
  - `maskEdgeCells` gives 8 for a 3×3 block, 1 for a single cell, 0 for an empty mask, and 12 for a full 4×4.
  - `edgePoints` returns `3 * min(edges, maxPoints)` floats, and its stride sampling covers both ends of the edge list.
  - `kindIntensity(0x5ce1ff, 'spark') * luminance(0x5ce1ff)` is ≈ 3, and the result is clamped.
  - Embers keep 2.0.
- [ ] **Step 2: Implement.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** with the message `feat: forge edge points and luminance-targeted spark intensity`.

---

### Task 3: Rising and collapsing obsidian

**Files:** modify `src/effects/Obsidian.ts` and `src/world/LevelWorld.ts` (`rebuildSolid`, `clearLevel`, `update`). Tests: `tests/obsidian.test.ts` (new) and `tests/shaders.test.ts`.

**Interfaces (produced):**
```ts
// Obsidian.ts
export function createObsidianMaterial(stability: number, color?: Color): ShaderMaterial; // now with uniforms stab, color, rise (1), hot (0); supports USE_INSTANCING
export function buildObsidianMesh(boxes: SolidBox[], material: ShaderMaterial): InstancedMesh; // shared module-level unit BoxGeometry; instance matrix = translate(centre) * scale(w,h,d); InstancedBufferAttribute aAxis = (nx,ny,nz) per box (default (0,1,0) when all zero)
export const OBSIDIAN_UNIT_BOX: BoxGeometry; // never disposed
// LevelWorld.ts
beginRise(surfaceId: string): void;
beginCollapse(surfaceId: string): void;
```

**Shader.**
- Vertex shader, inside `#ifdef USE_INSTANCING`:
  - `float k = dot(position, aAxis) + 0.5;`
  - `vec3 p = position - aAxis * k * (1.0 - rise);`
  - `vK = k;`
  - World position via `modelMatrix * instanceMatrix * vec4(p, 1)`.
  - Normal via `mat3(modelMatrix * instanceMatrix)`.
- Fragment shader adds `lead = smoothstep(0.75, 1.0, vK) * (1.0 - rise) * 3.0 + hot * 2.5;` and `col += mix(color, vec3(1.0, 0.85, 0.6), 0.5) * lead;` before `gl_FragColor`.

**Per-surface diffing.**
- `LevelWorld` keeps `solidMeshes: Map<string, { key: string; mesh: InstancedMesh; mode: 'rise' | 'idle' | 'collapse'; t: number }>` in place of the single `solidLayout` string.
- `rebuildSolid` handles three cases:
  - A surface whose frozen-mask key changed: replace its mesh. The new mesh starts with `mode = 'rise'` and `rise = 0` if `beginRise` was called for it this frame, and `idle` with `rise = 1` otherwise.
  - A surface that is no longer forged: if `beginCollapse` marked it, set `mode = 'collapse'`, `hot = 1`, and keep it until `COLLAPSE_TIME`. Otherwise dispose it immediately.
  - Unchanged surfaces only get their `stab` updated.
- `update(dt)` advances `t`:
  - rise mode: `rise = riseProgress(t)`
  - collapse mode: `rise = collapseProgress(t)`, then dispose when done
- Dispose the material per surface mesh. Never dispose `OBSIDIAN_UNIT_BOX`.
- Set `castShadow` and `receiveShadow` to true, as today.
- Collision comes from `ShadowManager.collisionBoxes()` and must not change.

- [ ] **Step 1: Write the failing tests** (node; construct material and mesh directly).
  - `buildObsidianMesh` instance count equals the box count, and the matrices carry the scale and centre.
  - `aAxis` matches the box normals.
  - `OBSIDIAN_UNIT_BOX` is shared across meshes (identity).
  - Material uniforms include `rise` and `hot`.
  - The `OBSIDIAN_FRAG` and vertex strings contain `aAxis`, `rise` and `hot`, and pass the include/order and smoothstep scans.
  - Extract the per-surface state machine as a pure helper `stepSolid(state, dt): { rise: number; hot: number; done: boolean }` and test it: rise reaches 1 by `RISE_TIME`; collapse reaches 0 and `done` by `COLLAPSE_TIME`.
- [ ] **Step 2: Implement.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** with the message `feat: obsidian rises from the plate and recedes on collapse`.

---

### Task 4: Forge light, plate charge and camera kick

**Files:** modify `src/world/LevelWorld.ts`, `src/shadows/ForgeSurface.ts` and `src/player/CameraRig.ts`. Tests: `tests/forge.test.ts` and `tests/shaders.test.ts`.

**Interfaces (produced):**
```ts
// ForgeSurface
setCharge(c: number): void; // uniform `charge`; FORGE_FRAG: preview brightness *= (1.0 + 1.5*charge); scan speed uses time * (4.0 + 8.0*charge)
// LevelWorld
setForgeCharge(surfaceId: string, c: number): void;
setForgeLight(surfaceId: string | null, k: number): void; // moves the single forge PointLight to the plate centre + normal*0.6, intensity = k * FORGE_LIGHT_PEAK (120)
// CameraRig
export const BASE_FOV = 58;
kick(deg: number): void; // fov = BASE_FOV + deg; updateProjectionMatrix only when |delta| > 0.01
```

**Forge light.**
- One `PointLight(accent, 0, 7, 2)`, created in `load` when the profile tier is medium or high, and added to `root`.
- `applyProfile` adds or removes it once on a tier change.
- `castShadow = false`.
- `setForgeLight(null, 0)` sets intensity to 0.

- [ ] **Step 1: Write the failing tests.**
  - `FORGE_FRAG` contains a `uniform float charge` and the charge terms.
  - `CameraRig.kick(5)` then `kick(0)` returns the FOV to `BASE_FOV`.
  - Calling `kick(0)` repeatedly doesn't call `updateProjectionMatrix` (spy).
- [ ] **Step 2: Implement.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** with the message `feat: forge light swell, plate charge-up and camera fov kick`.

---

### Task 5: Wire the sequence in Game (+ Low-tier flash overlay)

**Files:** modify `src/game/Game.ts`, `src/ui/Ui.ts` and `src/ui/styles.css` (overlay), plus `src/core/Renderer.ts` (expose `hasComposer()`). Test: `tests/forge.test.ts` (pure reset helper).

**Behaviour.**
- **`tryInteract` on a console with a preview:** as today, minus the immediate 36-spark burst. Keep the forge sound and haptic.
- **`playTransition(dt)`** each frame:
  - Call `forgeTimeline(this.transition, prev, reduced, scratch)`.
  - Call `renderer.punch(...)` with a reused, mutable punch object (`flash`, `exposure`, `bloom`, `ca`).
  - Call `camera.kick(fovKick)`.
  - Set `camera.shake = shake`.
  - Call `world.setForgeCharge(id, charge)` and `world.setForgeLight(id, light)`.
  - Set the overlay opacity to `flash` when `!renderer.hasComposer()`.
- **On `impact`:**
  - Run `shadows.forge(id)`.
  - Then `world.beginRise(id)`, `world.sync(shadows)` and `world.pulseForge(id)`.
  - Edge sparks: `particles.burstPoints(edgePoints(def, frozen, floor(budget / 3)), 2, accentHex, 'spark', normal)`.
  - `haptics.pulse(45)`.
  - If the forge failed: `deny` sound, reset, and back to `PLAYING` immediately.
- **At `transition >= FORGE_END`:** reset, then `PLAYING`.
- **Collapse** (in `playMove`, where shard bursts happen): call `world.beginCollapse(id)` before `sync`, and start a collapse flash. `Game` keeps `collapseT`, and each frame while `collapseT < 0.4` it punches `{ flash: collapseFlash(collapseT), flashColor: 0xff6a4a }`. When it finishes, it punches `ZERO_PUNCH`.
- **Reset helper.** `resetForgeEffects()` does all of the following:
  - `renderer.punch(ZERO_PUNCH)`
  - `camera.kick(0)`
  - `camera.shake = 0`
  - `world.setForgeLight(null, 0)`
  - `world.setForgeCharge(all, 0)`
  - overlay opacity 0

  Call it from: the transition end, a failed forge, `pause`, `restart`, `openLevel`/level exit, and `enterMenu`.
- **Reduced motion:** read `prefersReducedMotion()` once at startup, and again on its `change` event.

**Overlay.** A full-screen `div.flash-overlay` with `pointer-events: none`, `mix-blend-mode: screen` and a warm white background. Its opacity is driven per frame. Only Low uses it.

- [ ] **Step 1: Write the failing tests.** `Game` isn't constructible in node, so extract the punch-filling step as a pure `fillPunch(frame: ForgeFrame, out: Punch): Punch` in `ForgeTimeline.ts` and test it: it reuses `out`, and its values match the frame.
- [ ] **Step 2: Implement and wire it.** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** with the message `feat: the forge moment — charge, impact, edge sparks, rising obsidian, collapse flash`.

---

### Task 6: Browser verification and tuning (controller)
- [ ] Use `?debug` on L1 and L5 at High: interact at a console, or call `__SF.use()` near one.
  - The charge is visible.
  - The impact flash, bloom spike and FOV kick fire.
  - Sparks run along the shadow's edges.
  - The obsidian rises behind a glowing edge.
  - Control returns after about 0.9 s.
- [ ] Repeat on Medium and on Low. On Low the overlay flash shows and there's no FOV kick bloom.
- [ ] Trigger a collapse: the boxes recede red and the red flash shows.
- [ ] Pause mid-sequence, then restart. No punch or FOV is left stuck.
- [ ] Emulate reduced motion in DevTools: no shake and no FOV kick.
- [ ] Forge and collapse repeatedly. `renderer.info.memory.geometries` stays stable.
- [ ] Tune live, bake the values, then run a whole-feature Sonnet review.
