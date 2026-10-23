# SHADOWFORGE surroundings: underground forge cavern

## Context
Around the lab, the player sees a flat **teal void**. About half of every frame is surroundings, and almost all of it is one colour.

**Cause:** `LevelWorld.load` lerps the fog colour toward the level accent in linear space, which comes out far brighter than intended. The same colour then fills:
- the background
- the fog
- the sky below the horizon
- the abyss slab (accent × 0.15)

On top of that, the space sky is locked to the camera, so it has no parallax. Nothing exists outside the floor, and Kenney floor tiles have zero thickness, so slabs look like sheets of paper.

**Your decisions:**
- **Setting:** an underground forge. A dark rock cavern with a molten abyss below replaces the space sky, planet and nebula, in levels and on the menu.
- **Motion:** lively, as long as the play area stays clear.
- **Palette:** a shared molten palette on every level. The level accent tints only puzzle elements and a subtle rim.

**Constraints:**
- Phones on Medium stay smooth, and Low stays cheap.
- Lights are created once per tier and never added or removed at runtime.
- The recently tuned moody lab lighting stays as it is.
- Implementation runs on Sonnet 5.5 subagents at high effort. This session coordinates, reviews and tunes live.

After approval, this is saved as `docs/superpowers/specs/2026-10-23-forge-cavern-design.md`. Each phase then gets its own plan via writing-plans and is executed with subagent-driven development.

## Architecture
| File | Status | Job |
|---|---|---|
| `src/world/ForgePalette.ts` | new | `FORGE` sRGB constants, `mixSrgb`, `cavernFog()`, `moltenPulse(t)` (always in [0.7, 1]), a mutable `CAVERN` tuning object, and a pure `levelAtmosphere(id)` |
| `src/world/HeightFog.ts` | new | Idempotent `ShaderChunk` patch: fog is dark above the floor and warm toward the abyss. It throws if three's chunks change. |
| `src/world/CavernShaders.ts` | new | `DOME_*`, `MOLTEN_*` and `ROCK_*` GLSL |
| `src/world/CavernLayout.ts` | new, pure | `placeStructures`, `exposedRims`, `gantryX`, `swayAngle` |
| `src/world/ForgeCavern.ts` | new | Orchestrator with `setDetail`, `mount(bounds, slabs, seed)`, `setKit`, `follow`, `update(time)` and `tune` |
| `src/world/ForgeKit.ts` | new | Loads `SHADOWFORGE_EnvKit.glb`, which is currently unused, through a generalised `loadKit` extracted from `EnvKit.ts`. It retints the cyan emissives to molten. |
| `src/effects/Embers.ts` | new | GPU-animated `Points`: position is a function of (seed, time), so there are no per-frame uploads and one draw call. `emberState()` mirrors the maths in TypeScript for tests. |
| `src/world/SpaceBackdrop.ts` | delete | Replaced by the cavern |

The cavern's groups are direct children of the scene, outside `root`, so `clearLevel` never disposes them. Wiring:
- **LevelWorld:** `load`, `applyProfile`, `update`, `showMenu`, and the kit-loaded promise.
- **Game:** swap `backdrop.follow` for `cavern.follow`, and take the menu fog and background from the palette.

Reused pieces:
- `EnvKit` `standardOf`, with its `kitScale` and `baseColor` handling
- `LevelWorld.update` time
- `Lighting.ts` and `applyLighting`
- `LightBeams` (optional)
- the existing tier-gating pattern in `Settings.profileFor`

## Layers, near to far
1. **Palette and fog fix.** The background, fog and dome come from `FORGE` (top `0x060508`, haze `0x2a1209`) and no longer read the accent. Heights blend in sRGB. Fog density is 0.024, or ×0.6 on level 8 and later. The menu uses fog 0.045 so the cavern shows.
2. **Height fog** on every tier, at essentially no cost.
3. **Dome.** It follows the camera: a gradient from warm haze below to near-black above. Medium and High add faint rock banding on the ceiling.
4. **Molten abyss.** A plane at y = −9 that replaces the flat box.
   - Flowing value noise, with octaves by tier: 1 on Low, 2 on Medium, 3 plus domain warp on High.
   - Glowing halo around ridges. Only thin cracks go above bloom (`crackHdr` 2.2, threshold 1.2).
   - A slow molten pulse, and its own distance fade into the haze.
5. **Rock walls.**
   - 2 cards on Low and Medium, 4 on High.
   - Noise-displaced on the CPU at build time.
   - Unlit, with underglow from below and fading to dark above.
6. **Mid-ground structures** (Medium and High; in world space for parallax), using SHADOWFORGE kit parts:
   - supports and beams under slabs
   - side towers with industrial lamps, linked by beams and cable trays

   Pieces are merged into one mesh per material, about 7 draw calls in total; Medium places about 60% of what High does.

   Placement rules make it impossible for anything to block the camera, so `fadeOccluders` needs no changes. Tests enforce these rules:
   - Tall pieces sit at |z − midZ| ≥ halfDepth + 7.
   - Supports stay below their slab.
   - Nothing crosses over the corridor.
7. **Slab thickness.**
   - Phase 1, all tiers: keep the procedural box sides visible under the kit tile.
   - Phase 2, Medium and High: `SHF_Floor_Edge` lips on exposed rims, with an amber trim tinted toward the level accent. This marks gap edges.
8. **Lively motion.**
   - Embers rise from the abyss in the side bands and under gaps, never through the play area: 0 on Low, 120 on a Medium phone, 400 on High.
   - Sparks fall from a gantry trolley that ping-pongs along a rail.
   - Chains and hooks sway out of phase: 6 on Medium, 10 on High.
   - One `moltenPulse` drives the abyss, the walls and the underglow light, so they breathe together.
   - Smoke cards on High only, if they earn their cost.
9. **Lighting.**
   - One fixed warm underglow DirectionalLight from below, intensity 0.6 × pulse, created at load.
   - The hemisphere light's ground colour becomes warm `0x4a1e0c`.
   - The reflection environment trades its cyan ring for a warm molten emitter below, so reflections match.
   - New `LIGHTING` fields: `under`, `underColor`, `hemiGround`. They are tunable via `__SF.light`.

## Per-tier budget
| | Low | Medium (phone) | High |
|---|---|---|---|
| Added draw calls | ~4 | ~14 | ~20 |
| Abyss noise | 1 octave | 2 | 3 + warp |
| Embers / sparks | 0 / 0 | 120 / 30 | 400 / 100 |
| Structures, chains, gantry | — | 0.6 density, 6 chains | full, 10 chains |

`Settings.ts`:
- `sky` becomes `cavern: 'low' | 'medium' | 'high'`.
- Add `embers: number`.

## Phases (each ships on its own)
1. **Atmosphere.**
   - Palette, height fog, dome, molten abyss, underglow, warm hemisphere and env map.
   - Delete `SpaceBackdrop`; add the profile fields.
   - Rising embers, visible slab sides, the menu cavern.
   - Debug hook `__SF.cavern(partial)` that tunes values and toggles layers for fps A/B.
2. **Depth and structure.**
   - Kit loader generalisation and `ForgeKit`.
   - `CavernLayout` placements with merged meshes.
   - `Floor_Edge` rims with accent trim, rock walls.
3. **Mechanical motion.**
   - Chains and hooks, the gantry trolley and its falling sparks.
   - Optional smoke on High.
   - Optional: re-centre the sun's shadow camera on long levels; L10 currently has no shadows past x = 40.

## Tests (Vitest, node)
- **`palette.test.ts`**
  - The atmosphere is identical for levels 1–10.
  - The haze is warm and dark in sRGB.
  - `mixSrgb` is correct at the midpoint.
  - `moltenPulse` stays in [0.7, 1] and is smooth.
- **`heightfog.test.ts`**
  - The chunks contain `vFogWorldY`.
  - The patch is idempotent.
- **`cavernLayout.test.ts`**, over every level config:
  - Tall pieces sit outside the camera band.
  - Supports stay under their slab.
  - Nothing crosses the corridor overhead.
  - Placement is deterministic.
  - Medium places ≤ 60% of High; Low places nothing.
  - `exposedRims` skips shared edges.
  - `gantryX` stays on its rail.
  - `swayAngle` stays within ±amp.
- **`embers.test.ts`**
  - Embers spawn outside the corridor or below the floor.
  - The animation is periodic.
  - Alpha is 0 at birth and death.
  - Embers rise and sparks fall.
- **Updated:** `shaders.test.ts`, `quality.test.ts`, `lighting.test.ts`, `labenv.test.ts`.

## Verification (per phase, in the browser pane via `?debug`)
- `npm test` and `npm run build` both pass.
- **Look:**
  - `__SF.jump(1/8/10)`: no teal anywhere; dark crust with moving cracks.
  - Every level shares the cavern; only puzzle accents change.
  - Slab sides are visible, and the menu shows the cavern.
- **Glow:**
  - `__SF.post('off'/'full')`: the cracks bloom and the crust doesn't.
  - `__SF.cavern({crackHdr: 1})` removes the abyss bloom.
  - `__SF.light({under: 0})` vs the default shows the warm rim on the player and slab undersides.
- **Play area:**
  - Phase 2: drive the length of L10, and drag the camera pitch to its limits. Nothing may occlude the player, and parallax should be visible.
  - Phase 3: for 60 s on L5 and L10, nothing moving enters the corridor.
- **Performance:**
  - Switch Low → Medium → High: no console errors, and Low shows no embers.
  - In mobile emulation on Medium, `__SF.fps()` stays at 55 or above.
  - The `__SF.cavern({embers: false, structures: false})` deltas are small.
- **Review:** after each phase, a Sonnet reviewer goes over the diff.

## Risks
| Risk | Mitigation |
|---|---|
| Bloom haze from the abyss | Only cracks exceed 1.2; tune live. |
| Puzzles harder to read against a bright abyss | The abyss stays mostly dark (average luminance ≈ 0.15), and the warm-under / cool-over light separates silhouettes. |
| Fog darkening the far floor | Tune the density live. |
| A three upgrade breaking the fog chunk | The patch throws and a test catches it. |
| Phone fill rate | Points are capped at 10 px, there are no large additive surfaces, and smoke is High only. |
