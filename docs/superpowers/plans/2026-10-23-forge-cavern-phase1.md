# Forge Cavern Phase 1 (Atmosphere) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Replace the teal void and the space sky with a dark molten forge cavern. It has a warm height fog, a dark dome, a flowing molten abyss with blooming cracks, a warm underglow light and rising embers, and slab sides are visible. Every tier is covered, and phones stay smooth.

**Architecture:**
- A pure palette module drives the background and fog, independent of the level accent.
- A global fog-chunk patch adds height.
- A new `ForgeCavern` replaces `SpaceBackdrop`. It owns a camera-following dome and a world-space molten plane.
- Embers are a GPU-animated `Points` system with zero per-frame uploads.

**Tech Stack:** TypeScript 5.6, three 0.170 (WebGL2, stock EffectComposer, bloom threshold 1.2), Vite 6, Vitest 4 (node env).

**Spec:** `docs/superpowers/specs/2026-10-23-forge-cavern-design.md` (Phase 1).

## Global Constraints
- Branch `feat/visual-upgrade`. One commit per task. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new npm dependencies. `npm test` and `npm run build` stay green after every task.
- Never add or remove lights at runtime. Create them in `load` / `buildMenu`, then change only intensities.
- The level accent (`accentFor(id)`) must not affect the background, fog, dome or abyss.
- Low tier gets the cheapest versions: 1 noise octave, no rock banding, 0 embers.
- Custom `ShaderMaterial`s end with `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`, and keep `fog: false`.
- Don't create a canvas or `document` at module load; tests import these modules in node.
- Match the surrounding style: GLSL in template-literal consts, sparse comments, private fields.
- Keep the moody lab lighting values in `src/world/Lighting.ts` unchanged. Only add new fields.

## Review Focus
1. **Puzzle readability.** Dark casters over gaps must stay visible against the abyss, and only thin cracks may exceed the bloom threshold. Covered in Task 4 by the `crack * uCrackHdr` string test and the controller's browser check.
2. **Tier switching and level reload.** The cavern must not be disposed by `clearLevel`, and must not be duplicated across `applyProfile` calls (Task 4).
3. **Menu.** It must show the cavern and keep the monument readable (Task 4 wiring, browser check).
4. **The fog patch on a three upgrade.** It must fail loudly, not silently (Task 2 test).
5. **Embers never cross the play corridor** (Task 6 test).

---

### Task 1: Forge palette and the teal fix

**Files:** create `src/world/ForgePalette.ts`. Modify `src/world/LevelWorld.ts` (`load`, ~l.177-180) and `src/game/Game.ts` (initial background/fog ~l.96-97, `enterMenu` ~l.621-623). Test `tests/palette.test.ts`.

**Interfaces (produced):**
```ts
export const FORGE = { top: 0x060508, haze: 0x2a1209, glow: 0xff6a1f, crack: 0xffa040, crust: 0x140806, ember: 0xffb15a, under: 0xff6a2a, hemiGround: 0x4a1e0c } as const;
export function mixSrgb(a: number, b: number, t: number): Color;   // lerp in sRGB space (getRGB/setRGB with SRGBColorSpace)
export function cavernFog(): Color;                                // new Color(FORGE.haze)
export function moltenPulse(t: number): number;                    // 0.85 + 0.10*sin(1.3t) + 0.05*sin(3.7t + 1.1)
export const CAVERN: { crackHdr: number; glow: number; flow: number; fogDensity: number; embers: boolean } // { 2.2, 0.5, 0.04, 0.024, true }, mutable
export const MENU_FOG_DENSITY = 0.045;
export function levelAtmosphere(id: number): { background: number; fog: number; density: number }; // background FORGE.top, fog FORGE.haze, density CAVERN.fogDensity * (id >= 8 ? 0.6 : 1)
```

- [ ] **Step 1: Write `tests/palette.test.ts`:**
  - `levelAtmosphere` returns identical `background` and `fog` for ids 1 through 10.
  - Density is 0.024 for id 1 and 0.0144 for id 8.
  - `new Color(FORGE.haze).getRGB(target, SRGBColorSpace)` gives r > g > b and r < 0.25.
  - `mixSrgb(0x000000, 0xffffff, 0.5).getHex()` is within ±1 per channel of `0x808080`.
  - `moltenPulse` sampled over t from 0 to 120 in steps of 0.01 stays within [0.7, 1.0], and each step changes it by less than 0.01.

  Run it and confirm it fails.
- [ ] **Step 2: Implement `ForgePalette.ts`.**
- [ ] **Step 3: Use the atmosphere in `LevelWorld.load`.**
  - Replace the `new Color(0x07080e).lerp(this.accent, 0.16)` fog with `levelAtmosphere(config.id)`.
  - `scene.background = new Color(a.background)`.
  - `scene.fog = new FogExp2(a.fog, a.density)`.
  - Keep `backdrop.setTint` working for now, passing `cavernFog()` as the horizon. Task 4 removes the backdrop.
- [ ] **Step 4: Update `Game.ts`.**
  - Set the initial background and fog, and the `enterMenu` fog, from the palette: background `FORGE.top`, `FogExp2(cavernFog(), MENU_FOG_DENSITY)`.
  - Leave the menu `backdrop.setTint` call until Task 4.
- [ ] **Step 5:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 6:** Commit with `feat: forge palette, accent-independent dark warm fog (fixes teal void)`.

---

### Task 2: Height fog chunk patch

**Files:** create `src/world/HeightFog.ts`. Modify `src/world/LevelWorld.ts` to call `installHeightFog()` once at module top level, before any material compiles. Test `tests/heightfog.test.ts`.

**Interfaces (produced):** `export function installHeightFog(): void`. It is idempotent, and it throws `Error('height-fog: chunk changed')` if a replace target is missing.

**Patch details (three r170 `ShaderChunk`):**

| Chunk | Change |
|---|---|
| `fog_pars_vertex` | add `varying float vFogWorldY;` |
| `fog_pars_fragment` | add `varying float vFogWorldY;` |
| `fog_vertex` | append `vFogWorldY = (transpose(mat3(viewMatrix)) * mvPosition.xyz).y + cameraPosition.y;` |
| `fog_fragment` | replace the final `gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );` with `vec3 fogC = mix(fogColor * 0.18, fogColor, smoothstep(2.0, -7.0, vFogWorldY)); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);` |

- Guard everything with `#ifdef USE_FOG`, as the originals do.
- Use a module flag, or check whether the chunk already contains `vFogWorldY`, so a second call does nothing.

- [ ] **Step 1: Write the tests:**
  - After the call, `ShaderChunk.fog_vertex` contains `vFogWorldY` and `fog_fragment` contains `fogColor * 0.18`.
  - A second call leaves all four chunk strings byte-identical.

  Confirm they fail.
- [ ] **Step 2:** Implement the patch, then wire the call in LevelWorld.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: height fog — dark above the floor, warm toward the abyss`.

---

### Task 3: Profile fields `cavern` and `embers`

**Files:** modify `src/settings/Settings.ts` and `tests/quality.test.ts`.

**Interfaces (produced):**
- `QualityProfile.cavern: 'low' | 'medium' | 'high'` replaces `sky`, keeping the same per-tier values.
- `QualityProfile.embers: number`, set per tier:

| Tier | embers |
|---|---|
| low | 0 |
| medium | coarse ? 120 : 200 |
| high | 400 |

- [ ] **Step 1: Update the tests.**
  - Every `sky` assertion now asserts `cavern`, with the same values.
  - Add `low has no embers`.
  - Add `medium phone embers ≤ 150`, using `profileFor('medium', true).embers`.
  - Add `high embers 400`.

  Confirm the tests fail.
- [ ] **Step 2: Implement.**
  - Rename the field everywhere in `src`, including `LevelWorld.applyProfile`'s `backdrop.setDetail(profile.sky)` → `profile.cavern`.
  - Add `embers` to `QualityProfile`.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: cavern detail and ember budget in quality profiles`.

---

### Task 4: ForgeCavern replaces SpaceBackdrop (dome and molten abyss)

**Files:**
- Create `src/world/CavernShaders.ts` and `src/world/ForgeCavern.ts`.
- Delete `src/world/SpaceBackdrop.ts`.
- Modify:
  - `src/world/LevelWorld.ts`: field, constructor, `applyProfile`, `load`, `update`, `showMenu`
  - `src/world/LabDressing.ts`: remove the abyss box from `buildDressing`
  - `src/game/Game.ts`: `backdrop.follow` → `cavern.follow` at ~l.176 and l.198; remove the menu `setTint`; add the `__SF.cavern` hook
  - `src/vite-env.d.ts`
- Tests: `tests/shaders.test.ts` (extend); create `tests/cavern.test.ts`.

**Interfaces:**
- Consumed: `FORGE`, `CAVERN` and `moltenPulse` (Task 1), and `QualityProfile.cavern` (Task 3).
- Produced:
```ts
export type CavernDetail = 'low' | 'medium' | 'high';
export interface CavernBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export const MENU_BOUNDS: CavernBounds = { minX: -4.5, maxX: 4.5, minZ: -3, maxZ: 3 };
export const ABYSS_Y = -9;
export class ForgeCavern {
  readonly group: Group;   // world space: abyss (and later embers/structures); direct child of the scene
  readonly dome: Group;    // follows the camera; direct child of the scene
  setDetail(detail: CavernDetail, embers: number): void;   // rebuild only on change
  mount(bounds: CavernBounds): void;                        // re-size/position the abyss for the level or menu
  follow(camera: Vector3): void;
  update(time: number): void;                               // time and pulse uniforms
  tune(partial: Partial<typeof CAVERN>): typeof CAVERN;     // merges finite numbers/booleans into CAVERN, pushes uniforms
}
```
- `CavernShaders.ts` exports `DOME_VERT`, `DOME_FRAG`, `MOLTEN_VERT` and `MOLTEN_FRAG`.

**Dome:**
- Sphere radius 150; segments 24×12 on low, 32×16 otherwise.
- `BackSide`, `depthTest: false`, `depthWrite: false`, `renderOrder = -1`.
- Fragment: `mix(haze, top, smoothstep(-0.25, 0.15, dir.y))`.
- On medium and high, add rock banding behind `#define ROCK 1`: one octave of value noise on `dir.xz / max(dir.y, 0.05)`, amplitude 0.015, only where `dir.y > 0`.

**Molten abyss:**
- `PlaneGeometry(len + 120, depth + 100)`, rotated flat at `y = ABYSS_Y`, centred on the bounds.
- `fog: false`. The material fades to haze on its own: `mix(col, haze, smoothstep(25.0, 70.0, distance(cameraPosition, worldPos)))`.
- Noise is value noise using a Hoskins `hash12` (no `sin`).
  - `p = world.xz * 0.18 + uFlow * uTime`.
  - On high, warp the domain: `p += 0.6 * vec2(n(p + 3.1), n(p - 1.7))`.
  - `#define OCTAVES` is 1, 2 or 3 by tier.
- Colour:
  - `ridge = 1.0 - abs(2.0 * n - 1.0)`
  - `crack = smoothstep(0.88, 0.97, ridge)`
  - `halo = smoothstep(0.55, 0.92, ridge)`
  - `col = crust * (0.6 + n) + glow * halo * uGlow * uPulse + crackCol * crack * uCrackHdr * uPulse`
- `uTime` receives `time % 600`.
- `update` sets `uPulse` from `moltenPulse(time)`.

**Wiring:**
- `LevelWorld.cavern = new ForgeCavern()` replaces `backdrop`. Add `cavern.group` and `cavern.dome` to the scene in the constructor.
- `applyProfile` calls `cavern.setDetail(profile.cavern, profile.embers)`.
- `load` calls `cavern.mount(levelBounds)`, the same bounds `buildDressing` uses.
- `showMenu(true)` calls `cavern.mount(MENU_BOUNDS)`.
- `update` calls `cavern.update(this.time)`.
- `clearLevel` must not dispose the cavern.
- In `buildDressing`, remove the abyss box and its material.

**Debug hook:** `__SF.cavern: (p?: Partial<typeof CAVERN>) => this.world.cavern.tune(p ?? {})`. Type it in `ShadowforgeDebug`.

- [ ] **Step 1: Write the tests.**
  - `tests/shaders.test.ts`: add `DOME_FRAG` and `MOLTEN_FRAG` to the include and ordering checks.
  - `tests/shaders.test.ts`: assert `MOLTEN_FRAG` contains `crack * uCrackHdr`.
  - `tests/cavern.test.ts`, where `new ForgeCavern()` is constructible in node:
    - `setDetail('low', 0)` then `('high', 400)` changes the abyss material's `OCTAVES` define from 1 to 3.
    - Calling `setDetail` twice with the same args doesn't recreate the material (identity check).
    - `mount` centres the abyss on the bounds.
    - `tune({ crackHdr: 1 })` updates the uniform, and `tune({ crackHdr: NaN })` is ignored.

  Confirm the tests fail.
- [ ] **Step 2:** Implement the shaders and `ForgeCavern`, delete `SpaceBackdrop.ts`, and do the wiring. Remove every `backdrop` reference.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: forge cavern dome and molten abyss replace the space backdrop`.

---

### Task 5: Warm underglow lighting and molten env map

**Files:** modify:
- `src/world/Lighting.ts`
- `src/world/LevelWorld.ts`: `load`, `buildMenu`, `update`, `applyLighting`
- `src/world/LabEnvironment.ts`
- `tests/lighting.test.ts` and `tests/labenv.test.ts`

**Interfaces (produced):** new `LIGHTING` fields `under: 0.6`, `underColor: 0xff6a2a` and `hemiGround: 0x4a1e0c`. Existing values stay unchanged.

**Level lighting (`LevelWorld.load`):**
- Create `underLight = new DirectionalLight(LIGHTING.underColor, LIGHTING.under)` at `(midX + 3, -12, 4)`, targeting `(midX, 0, 0)`, with `castShadow = false`. Add it to `root`.
- The hemisphere light gets `groundColor = LIGHTING.hemiGround`.
- In `update`, set `underLight.intensity = LIGHTING.under * moltenPulse(this.time)`.
- `applyLighting` pushes `under`, `underColor` and `hemiGround`.

**Menu:** `buildMenu` gets its own static underglow `DirectionalLight` with the same colour and intensity, created once with the menu.

**Env map:**
- In `LabEnvironment`, replace the cyan floor ring with a warm `PlaneGeometry(14, 14)` facing up at y = -4, colour `0xff6a1f` × 1.2.
- Change the gradient sphere's floor colour to `0x2a0e06`.

- [ ] **Step 1: Update the tests.**
  - `lighting.test.ts`: assert the new fields and their values.
  - `labenv.test.ts`: the cyan-ring expectation becomes "a warm emitter below y < 0 whose colour has r > b". Keep the existing panel tests.

  Confirm they fail.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: molten underglow light, warm hemisphere ground, molten env reflections`.

---

### Task 6: GPU embers

**Files:**
- Create `src/effects/Embers.ts`.
- Modify `src/world/ForgeCavern.ts`: create the embers in `setDetail` and `mount`, add them to `group`, and drive time in `update`. The `CAVERN.embers` flag toggles visibility.
- Test `tests/embers.test.ts`.

**Interfaces (produced):**
```ts
export interface EmberSeed { x: number; z: number; phase: number; speed: number; sway: number; size: number; rise: number }
export function seedEmbers(count: number, bounds: CavernBounds, seed: number): EmberSeed[];  // deterministic (mulberry32)
export function emberState(s: EmberSeed, time: number): { x: number; y: number; z: number; alpha: number }; // mirrors the vertex shader exactly
export const EMBER_VERT: string; export const EMBER_FRAG: string;
export class Embers { readonly points: Points; constructor(seeds: EmberSeed[]); setTime(t: number): void; setPixelRatio(dpr: number): void; dispose(): void }
```

**Animation (shader and `emberState` identical):**
- `life = fract(time * speed + phase)`
- `y = ABYSS_Y + life * rise`
- `x += sin(life * 9.4 + phase * 40.0) * sway`
- `alpha = smoothstep(0., .12, life) * (1. - smoothstep(.65, 1., life))`
- `gl_PointSize = min(10.0 * uScale, size * uScale * 60.0 / -mv.z)`
- Colour goes from `FORGE.ember` toward red over life, at ×1.6 HDR. Blending is additive with `depthWrite: false`.

**Spawn rule in `seedEmbers`:**
- 80% go in the side bands, `|z - midZ| ∈ [halfDepth + 1.5, halfDepth + 16]`, with `rise = 14`.
- 20% go under the corridor footprint, with `rise` clamped so `ABYSS_Y + rise ≤ -1`.
- x is uniform over `[minX - 20, maxX + 20]`.

**Pixel ratio:** `ForgeCavern` takes the pixel ratio from `Game.applyTier`, the same way particles do, using `renderer.effectivePixelRatio()`.

- [ ] **Step 1: Write the tests.**
  - Every seed is either in a side band, or under the footprint with a max y ≤ -1.
  - `emberState` is periodic in `1 / speed`.
  - Alpha is 0 at life 0 and at life 1, and peaks in mid-life.
  - `y` increases with life.
  - `seedEmbers` is deterministic for the same seed.
  - Count 0 builds no points; the cavern hides the embers on low.

  Confirm the tests fail.
- [ ] **Step 2:** Implement, then wire into `ForgeCavern` and `Game.applyTier`.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: GPU-animated embers rising from the molten abyss`.

---

### Task 7: Visible slab sides and warm dust

**Files:** modify:
- `src/world/LevelWorld.ts`: `applyKit` stops hiding the procedural slab boxes. Instead it sets `scale.y = (h - 0.01) / h` and `position.y -= 0.005`, so the top sits just under the kit tile.
- `src/effects/ParticleManager.ts`: dust colour moves from cool `(0.75, 0.88, 1)` to warm ash `0xffd0a0`, still × `DUST_INTENSITY`.
- Tests: `tests/particles.test.ts`, plus a pure helper test for the slab tuck.

**Interfaces (produced):** `export function tuckUnderTile(height: number): { scaleY: number; offsetY: number }` in `LevelWorld.ts` or a small helper module. It returns `{ (h - 0.01) / h, -0.005 }`.

- [ ] **Step 1: Write the tests.**
  - `tuckUnderTile(0.5)` returns `{ scaleY: 0.98, offsetY: -0.005 }`.
  - A dust-colour test asserts r > b. Read the current dust test first and adapt it.

  Confirm they fail.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npm test && npm run build`. Expect PASS.
- [ ] **Step 4:** Commit with `feat: show slab thickness under kit tiles; warm ash dust`.

---

### Task 8: Browser tuning and verification (controller)
- [ ] Run `npm test && npm run build`.
- [ ] Open `?debug` and check levels 1, 8 and 10. Expect no teal anywhere, dark crust with moving cracks, and an identical cavern on every level. Slab sides should be visible.
- [ ] Toggle `__SF.post('off')` and `__SF.post('full')`: the cracks bloom and the crust doesn't. Then `__SF.cavern({crackHdr: 1})` should remove the abyss bloom.
- [ ] Compare `__SF.light({under: 0})` with the default: the default shows a warm rim on the player and slab undersides.
- [ ] Switch Low → Medium → High: no errors, and Low shows no embers. The menu shows the cavern.
- [ ] In mobile emulation on Medium, `__SF.fps()` stays at 55 or above.
- [ ] Tune `CAVERN` and `LIGHTING` live, then bake the final values with a small Sonnet dispatch.
- [ ] Run a whole-phase Sonnet review.
