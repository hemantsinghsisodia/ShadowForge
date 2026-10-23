# SHADOWFORGE visual upgrade: phased, impact-first

## Context
Goal: make the game look more appealing and exciting through a balanced pass on the overall look plus a spectacular forge moment.

What you decided:
- **Mobile must stay smooth.** Heavy effects only on the Medium and High tiers.
- **Libraries are allowed**, but the approach keeps three's stock `EffectComposer`.
- **Ship in three phases**, with the highest-impact work first.

What the code survey found and why it matters:
1. **All particles are invisible today.** In `ParticleManager`, the vertex shader reads the built-in `color` attribute without `vertexColors: true`, so in r170 the shader fails to compile. I confirmed this at [ParticleManager.ts:20](src/effects/ParticleManager.ts:20).
2. **Bloom has almost no effect** (strength 0.12, threshold 0.94), so emissive parts don't glow.
3. **The forge moment is flat:** about 0.55 s of camera shake, then the obsidian boxes pop in instantly, one draw call per box.
4. **Lighting looks generic and flat:** a `RoomEnvironment` env map at 0.28 and a HemisphereLight at 2.1. There are no normal maps, and lamps don't cast shadows.
5. **The Low tier has no tone mapping in its custom shaders.** On Low there is no composer, so ForgeSurface, Obsidian, LightBeams and the particles write linear color with no ACES. They look darker and clipped compared with the lit scene.
6. **AUTO quality starts phones on High** and never steps back up after a drop.

After approval, this design is saved to `docs/superpowers/specs/2026-10-23-visual-upgrade-design.md` and committed. Each phase then gets its own implementation plan through writing-plans and ships on its own.

**Execution model (your instruction):** all implementation work, meaning code edits, tests and builds, runs in subagents with `model: "sonnet"` (Sonnet 5.5) and `effort: "high"`. This session only coordinates the work and reviews what comes back.

---

## Phase 1: Fix and tune (the biggest change in look per hour)

**1a. Particles** (`src/effects/ParticleManager.ts`)
- Rename the attribute to `aColor` and declare it in the vertex shader.
- Push particle colors into HDR by kind so they bloom: spark 3.0, shard 2.5, ember 2.0. Dust stays at 0.6 so it never blooms.
- Add `uScale` and `setPixelRatio(dpr)`. Points currently render at half size on screens with a device pixel ratio of 2.
- Re-upload only the live ranges of the buffers with `addUpdateRange`, upload colors only when they change, and skip uploads entirely when nothing is alive.
- Add `burstPoints(points, perPoint, hex, kind, dir?)`, which Phase 2 uses for edge sparks.

**1b. Bloom, exposure and lighting**
- **Settings** (`src/settings/Settings.ts`): add `bloomStrength`, `bloomRadius`, `bloomThreshold` and `chromatic` to `QualityProfile`.

  | Tier | Bloom strength / radius / threshold | Exposure |
  |---|---|---|
  | Medium | 0.45 / 0.35 / 0.90 | 1.0 |
  | High | 0.65 / 0.45 / 0.85 | 1.0 |
  | Low | no bloom | 1.05 |

  Remove the dead fields `lightCap` and `antialias`.
- **Renderer** (`src/core/Renderer.ts`):
  - Read the bloom values from the profile and keep a reference to the bloom pass.
  - Always add the grade pass when a composer exists, with `amount = 0` when post-FX is off. This keeps the MSAA buffer swaps even, so `post('bloom')` stops flickering.
  - Add `punch({flash, exposure, bloom, ca})` for Phase 2.
- **Emissive pushes:** get "only glowing things bloom" by making emissives brighter, not by lowering the threshold.

  | Part | Change |
  |---|---|
  | Lamp heads | ×4 |
  | ForgeSurface edges, ring and broken state | ~×2 |
  | Obsidian Fresnel rim | ×1.8 |
  | Player seams | 2.2 |
  | Exit ring | 2.6 |
  | Console icon | 3.0 |
  | Trim | unchanged |
- **Hemisphere light and env map** (`src/world/LevelWorld.ts`):
  - HemisphereLight: 0.9 with an env map, 1.6 without.
  - `environmentIntensity`: 0.65.
- **New `src/world/LabEnvironment.ts`:** a procedural lab scene that replaces `RoomEnvironment` in `Materials.buildEnvMap` via PMREM.
  - A gradient sphere.
  - Cool strip panels along the sides.
  - A warm key panel that matches the sun direction.
- **Debug hook:** add `__SF.bloom(s, r, t)` next to `post` in `Game.ts` (~l.134) for live tuning.

**1c. Low-tier color fix**
- Add `#include <tonemapping_fragment>` and `#include <colorspace_fragment>` to the fragment shaders in ForgeSurface, Obsidian, LightBeams and ParticleManager.
- This follows the pattern `SpaceBackdrop` already uses. It changes nothing on composer tiers.

**1d. Quality startup** (`Settings.ts`, `src/core/QualityMonitor.ts`)
- `initialAppliedQuality('auto', coarse)` returns `coarse ? 'medium' : 'high'`.
- Add `upgrade()` and a pure `nextTier(windows, tier, mode, dropped)`.
  - Step up after 3 windows in a row at 57 fps or more.
  - Never step up again in the same session after a drop.

**1e. Grade shader** (`src/effects/PostFX.ts`)
- Add uniforms `flash`, `flashColor` and `ca`.
- Chromatic aberration grows toward the screen edges, with the NaN clamp kept on every sample.
- Base aberration is 0.0012 on High and 0 on Medium.

---

## Phase 2: The forge moment

**New `src/effects/ForgeTimeline.ts`** (pure, no three.js imports)
- Easing helpers: `easeOutCubic`, `easeOutBack` and `pulse(t, attack, decay)`.
- `forgeTimeline(t, reducedMotion)` returns `{charge, flash, exposure, bloom, ca, fovKick, shake, light, impact}`:

  | Time (s) | What happens |
  |---|---|
  | 0 – 0.45 | Charge: the plate scan speeds up and brightens; shake ramps up |
  | 0.45 | Impact: flash, exposure punch, bloom spike, chromatic aberration burst, FOV kick of about 5° that settles back, and a light swell |
  | 0.9 | End (`FORGE_END`) |

  With reduced motion: no shake, no FOV kick, and flash and aberration ×0.4.
- `riseProgress` and `collapseProgress` drive the obsidian animation.

**Game** (`src/game/Game.ts`)
- `playTransition` drives everything from the timeline:
  - `renderer.punch`
  - `camera.kick`
  - `world.setForgeCharge`
  - `world.setForgeLight`
- On impact it does what currently happens at 0.55 s, plus:
  - `world.beginRise(id)`
  - edge sparks, with the edge points capped at `budget / 3`
  - `haptics.pulse(45)`
- Input stays locked until 0.9 s. Cut `FORGE_END` to 0.75 s if that feels slow.
- **Collapse:** `world.beginCollapse` plus a short red flash (`flash 0.3`, color 0xff6a4a, over 0.25 s).
- **Reduced motion:** read from the OS through a new `prefersReducedMotion()` in `src/core/device.ts`.

**Edge cells** (`src/shadows/math.ts`)
- Pure `maskEdgeCells(mask, cols, rows)`: set cells that have an unset neighbour.
- `cellWorld(def, index)` converts a cell index to a world position.

**Obsidian rise** (`src/effects/Obsidian.ts` and `LevelWorld.rebuildSolid`)
- One `InstancedMesh` per surface, all sharing one module-level unit box.
- **Per-instance attribute `aAxis`:** each box's face normal, from `SolidBox.nx/ny/nz`.
- **Vertex shader:** squashes each box toward its base face by `(1 - rise)`.
- **Fragment shader:** a hot leading edge, plus a `hot` uniform for collapse.
- **Per-surface diffing:** a `Map<surfaceId, {key, mesh, t, mode}>` replaces the `solidLayout` string.
  - A surface that is gone switches to collapse mode (receding, hot) instead of popping out.
- **Draw calls:** one per surface instead of one per box.

**Forge light**
- One `PointLight` per level, Medium and High only, created at load.
- Only its intensity changes, so adding or removing lights never forces a shader recompile.

**Camera** (`src/player/CameraRig.ts`)
- `kick(deg)` sets the FOV kick on top of a base FOV of 58°.
- `updateProjectionMatrix` runs only when the FOV changes.

---

## Phase 3: Atmosphere and materials

**Normal maps** (`src/world/Materials.ts`)
- Add a seeded RNG (mulberry32) and a pure `heightToNormal(heights, w, h, strength)`.
- Generate normal maps for floor seams, wall panels and metal dents.
  - Size: 256 on Medium, 512 on High, none on Low.
  - Apply them through `applyDetail(tier)`.
- The existing painters switch from `Math.random` to the seeded RNG, so textures are the same every load.

**Dust**
- Medium 60, High 110.
- About 40% of motes spawn inside lamp beams, using `world.lampPositions()` and `particles.setAttractors()`.

**Light beams** (`src/effects/LightBeams.ts`)
- A `time` uniform drives a scrolling noise shimmer.
- A soft fade at the end of the beam.
- Strength 0.34.

**Fog**
- Slightly denser and tinted toward the level accent.
- Obsidian and ForgeSurface get the fog shader includes, so they no longer float at a distance.

**Lamp shadows (High only)**
- New `profile.lampShadows` flag.
- The puzzle spotlight casts a 512px shadow, so the shaped shadow shows on the floor.
- Point lights at most one, and only when the level has no spotlight.

**SpaceBackdrop** (`src/world/SpaceBackdrop.ts`)
- Check the inverted star density: `paintSky(..., detail === 'low')` gives Low the dense stars.
- On Medium and High, add a faint nebula band tinted with the level accent.

**N8AO ambient occlusion:** not added. Its cost on High isn't worth the gain in these flat rooms. Revisit only if High still looks flat after Phase 3.

---

## Tests (Vitest, node env)
- **`tests/quality.test.ts`:**
  - AUTO starts coarse devices on Medium and fine-pointer devices on High.
  - Bloom thresholds per tier.
  - `nextTier`: drops, rises, sticky after a drop, ignored in manual mode.
  - `lampShadows` is on for High only.
- **New `tests/forge.test.ts`:**
  - Easing endpoints; `easeOutBack` overshoots then settles.
  - `pulse` shape.
  - `impact` fires in exactly one frame in a 60 Hz sweep.
  - Everything is back to 0 at `FORGE_END`.
  - Reduced motion gives zero shake and FOV kick.
- **`tests/shadow.test.ts`:** `maskEdgeCells` (3×3 block gives 8, a single cell gives 1, empty gives none).
- **New `tests/materials.test.ts`:**
  - `seeded` is deterministic and in [0, 1).
  - `heightToNormal` gives (128, 128, 255) for a flat field and tilts for a ramp.

## Verification (per phase)
- `npm test` and `npm run build` pass (type-check included).
- `npm run dev`, then open with `?debug` in the built-in browser.
  1. The console shows no shader errors.
  2. Sparks are visible when forging on Low, Medium and High.
  3. `post('off'|'bloom'|'grade'|'full')` doesn't flicker.
  4. Lamps, plate edges and obsidian rims glow, and the floor and trim don't haze.
  5. On Low, the plate and obsidian brightness match Medium.
- **Mobile emulation** (coarse pointer, fresh `localStorage`): starts on Medium, and `__SF.fps()` stays at 55 or more with 4× CPU throttle.
- **Phase 2:**
  - Forge on Level 1 on every tier.
  - A collapse recedes in red instead of popping.
  - Reduced motion (DevTools rendering) gives no shake or FOV kick.
  - `renderer.info.memory.geometries` stays stable over repeated forges.
- **Phase 3:**
  - High: the lamp shadow is visible and desktop holds 55 fps or more.
  - Normal maps don't shimmer at grazing angles.
  - The menu scene still looks right.

## Risks
- **Bloom haze** from trim or overlapping HDR particles. Tune with `__SF.bloom`.
- **Program recompiles.** Create lights and shadow casters once per tier and change only their intensity.
- **HalfFloat bloom on old Mali GPUs** may look blocky. Fall back to UnsignedByte on Medium phones if it does.
- **Collision exists at impact while the visuals are still rising.** Acceptable because input is locked during that window.
